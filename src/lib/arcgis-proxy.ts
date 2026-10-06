import 'server-only';
import { corsHeaders } from '@/lib/security';

/**
 * Shared plumbing for the server-side proxies to official ArcGIS services
 * (CIREN suelos, CONAF vegetacional, CIREN propiedades rurales) and for the
 * NDVI export's parameter parsing.
 *
 * Every proxy follows the same contract: an exact parameter allowlist, numeric
 * validation before anything reaches the upstream, a hard timeout, a byte cap
 * on the upstream body, and an English error body
 * `{ error: { code, message, service, operation } }` that the UI uses to name
 * the exact service that failed.
 */

const REQUEST_TIMEOUT_MS = 8_000;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function proxyErrorResponse(
  req: Request,
  status: number,
  error: { code: string; message: string; service: string; operation: string },
): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        ...corsHeaders(req),
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
    },
  );
}

/**
 * Returns the query parameters only when they are EXACTLY `required`: no
 * missing key, no extra key, no repeated key. Anything else is null.
 */
export function readExactParams(
  searchParams: URLSearchParams,
  required: readonly string[],
): Record<string, string> | null {
  const allowed = new Set(required);
  const seen = new Set<string>();

  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  if (required.some((key) => !seen.has(key))) return null;

  return Object.fromEntries(required.map((key) => [key, searchParams.get(key) ?? '']));
}

export function parseNumberTuple(value: string, length: number): number[] | null {
  const parts = value.split(',').map((part) => part.trim());
  if (parts.length !== length || parts.some((part) => part === '')) return null;
  const values = parts.map(Number);
  return values.every(Number.isFinite) ? values : null;
}

export function validGeographicExtent(values: number[]): boolean {
  if (values.length !== 4) return false;
  const [west, south, east, north] = values;
  return (
    west >= -180 && west <= 180 && east >= -180 && east <= 180 &&
    south >= -90 && south <= 90 && north >= -90 && north <= 90 &&
    west < east && south < north
  );
}

export function validGeographicPoint(values: number[]): boolean {
  if (values.length !== 2) return false;
  const [lng, lat] = values;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

export function validIntegerTuple(
  values: number[],
  length: number,
  min: number,
  max: number,
): boolean {
  return (
    values.length === length &&
    values.every((value) => Number.isInteger(value) && value >= min && value <= max)
  );
}

/** `?bbox=west,south,east,north&size=width,height`, parsed but not range-checked. */
export function readExportParams(
  searchParams: URLSearchParams,
): { bbox: number[]; size: number[] } | null {
  const input = readExactParams(searchParams, ['bbox', 'size']);
  const bbox = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  return bbox && size ? { bbox, size } : null;
}

export interface IdentifyParams {
  geometry: number[];
  mapExtent: number[];
  imageDisplay: number[];
  tolerance: number;
}

/**
 * Parses and validates an ArcGIS `identify` request: a geographic point, a map
 * extent accepted by `validExtent`, an `imageDisplay` of width,height,dpi
 * (1..2048 px, 72..192 dpi) and an integer pixel tolerance of 0..10.
 */
export function readIdentifyParams(
  searchParams: URLSearchParams,
  validExtent: (values: number[]) => boolean = validGeographicExtent,
): IdentifyParams | null {
  const input = readExactParams(searchParams, ['geometry', 'mapExtent', 'imageDisplay', 'tolerance']);
  if (!input) return null;
  const geometry = parseNumberTuple(input.geometry, 2);
  const mapExtent = parseNumberTuple(input.mapExtent, 4);
  const imageDisplay = parseNumberTuple(input.imageDisplay, 3);
  const tolerance = Number(input.tolerance);
  if (
    !geometry || !mapExtent || !imageDisplay ||
    !validGeographicPoint(geometry) || !validExtent(mapExtent) ||
    !validIntegerTuple(imageDisplay.slice(0, 2), 2, 1, 2048) ||
    !validIntegerTuple(imageDisplay.slice(2), 1, 72, 192) ||
    !validIntegerTuple([tolerance], 1, 0, 10)
  ) {
    return null;
  }
  return { geometry, mapExtent, imageDisplay, tolerance };
}

/** Upstream `identify` query string shared by every proxy. */
export function identifySearch(params: IdentifyParams, layers: string): string {
  return new URLSearchParams({
    geometry: params.geometry.join(','),
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers,
    tolerance: String(params.tolerance),
    mapExtent: params.mapExtent.join(','),
    imageDisplay: params.imageDisplay.join(','),
    returnGeometry: 'false',
    f: 'json',
  }).toString();
}

export function isPngBody(body: Uint8Array | null): body is Uint8Array {
  return (
    body !== null &&
    body.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => body[index] === byte)
  );
}

/** Media type of a response, lower-cased and without parameters. */
export function mediaType(response: Response): string | undefined {
  return response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
}

/** A PNG body ready to hand to `new Response`, cacheable at the CDN for 5 min. */
export function pngResponse(req: Request, body: Uint8Array): Response {
  const png = new ArrayBuffer(body.byteLength);
  new Uint8Array(png).set(body);
  return new Response(png, {
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'image/png',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      Vary: 'Origin',
    },
  });
}

/**
 * Fetches an upstream ArcGIS resource with an 8 s timeout and a byte cap,
 * never following redirects. `response` is null when the request never got
 * an answer; `bodyError` flags a body that was too large or broke mid-stream.
 */
export async function fetchArcGis(
  url: URL,
  accept: string,
  maxBytes: number,
): Promise<{
  response: Response | null;
  body: Uint8Array | null;
  timedOut: boolean;
  bodyError: boolean;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response | null = null;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: accept },
    });
    if (!response.ok) {
      return { response, body: null, timedOut: false, bodyError: false };
    }

    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      await response.body?.cancel();
      return { response, body: null, timedOut: false, bodyError: true };
    }

    if (!response.body) {
      return { response, body: new Uint8Array(), timedOut: false, bodyError: false };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { response, body: null, timedOut: false, bodyError: true };
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { response, body, timedOut: false, bodyError: false };
  } catch {
    return {
      response,
      body: null,
      timedOut: controller.signal.aborted,
      bodyError: response !== null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Parses a JSON body, or null when it is not valid JSON. */
export function parseJsonBody<T>(body: Uint8Array): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as T;
  } catch {
    return null;
  }
}
