import 'server-only';
import { corsHeaders } from '@/lib/security';

export const SUELOS_UPSTREAM_SERVICE =
  'https://esri.ciren.cl/server/rest/services/ESTUDIO_AGROLOGICO_SUELOS/MapServer';

export const SUELOS_PROXY_SERVICE_NAME =
  'CIREN · ESTUDIO_AGROLOGICO_SUELOS · ArcGIS MapServer';

export type SuelosProxyOperation = 'export' | 'identify';

const REQUEST_TIMEOUT_MS = 8_000;

export function suelosProxyError(
  req: Request,
  status: number,
  code: string,
  operation: SuelosProxyOperation,
) {
  const message = code === 'INVALID_REQUEST'
    ? 'Los parámetros de la consulta de suelos no son válidos.'
    : 'El servicio oficial de suelos CIREN no está disponible temporalmente.';
  return Response.json(
    {
      error: {
        code,
        message,
        service: SUELOS_PROXY_SERVICE_NAME,
        operation,
      },
    },
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

export async function fetchCiren(
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
