import { enforce, corsHeaders } from '@/lib/security';
import {
  SUELOS_UPSTREAM_SERVICE,
  fetchCiren,
  parseNumberTuple,
  readExactParams,
  suelosProxyError,
  validGeographicExtent,
  validGeographicPoint,
  validIntegerTuple,
} from '@/lib/suelos-proxy';

const OPERATION = 'identify' as const;
const SOIL_CLASS = /^(I|II|III|IV|V|VI|VII|VIII|N\.C\.)$/;
const MAX_JSON_BYTES = 512 * 1024;

interface ArcGisIdentifyResult {
  layerName?: unknown;
  attributes?: unknown;
}

interface ArcGisIdentifyResponse {
  results?: unknown;
  error?: unknown;
}

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(req), Vary: 'Origin' },
  });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readExactParams(new URL(req.url).searchParams, [
    'geometry',
    'mapExtent',
    'imageDisplay',
    'tolerance',
  ]);
  const geometry = input ? parseNumberTuple(input.geometry, 2) : null;
  const extent = input ? parseNumberTuple(input.mapExtent, 4) : null;
  const display = input ? parseNumberTuple(input.imageDisplay, 3) : null;
  const tolerance = input ? Number(input.tolerance) : Number.NaN;
  if (
    !geometry || !extent || !display ||
    !validGeographicPoint(geometry) || !validGeographicExtent(extent) ||
    !validIntegerTuple(display.slice(0, 2), 2, 1, 2048) ||
    !Number.isInteger(display[2]) || display[2] < 72 || display[2] > 192 ||
    !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10
  ) {
    return suelosProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${SUELOS_UPSTREAM_SERVICE}/identify`);
  upstream.search = new URLSearchParams({
    geometry: geometry.join(','),
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'all',
    tolerance: String(tolerance),
    mapExtent: extent.join(','),
    imageDisplay: display.join(','),
    returnGeometry: 'false',
    f: 'json',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchCiren(
    upstream,
    'application/json',
    MAX_JSON_BYTES,
  );
  if (!response) {
    return suelosProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok) {
    console.error('CIREN soils identify returned an upstream error:', response.status);
    return suelosProxyError(req, 502, 'UPSTREAM_HTTP_ERROR', OPERATION);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    console.error('CIREN soils identify returned an invalid content type.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (timedOut) {
    return suelosProxyError(req, 504, 'UPSTREAM_TIMEOUT', OPERATION);
  }
  if (bodyError || !body) {
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

  let data: ArcGisIdentifyResponse;
  try {
    data = JSON.parse(new TextDecoder().decode(body)) as ArcGisIdentifyResponse;
  } catch {
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (data.error || !Array.isArray(data.results)) {
    return suelosProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', OPERATION);
  }

  const results = (data.results as ArcGisIdentifyResult[]).slice(0, 20).map((result) => {
    const attributes =
      result.attributes && typeof result.attributes === 'object'
        ? Object.values(result.attributes as Record<string, unknown>)
        : [];
    const soilClass = attributes
      .map((value) => String(value).trim())
      .find((value) => SOIL_CLASS.test(value)) ?? null;
    return {
      layerName: typeof result.layerName === 'string' ? result.layerName.slice(0, 120) : '',
      soilClass,
    };
  });

  return Response.json(
    { results },
    {
      headers: {
        ...corsHeaders(req),
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
    },
  );
}
