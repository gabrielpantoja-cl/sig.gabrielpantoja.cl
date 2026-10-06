import { enforce, corsHeaders } from '@/lib/security';
import {
  fetchArcGis,
  identifySearch,
  mediaType,
  parseJsonBody,
  readIdentifyParams,
} from '@/lib/arcgis-proxy';
import { SUELOS_UPSTREAM_SERVICE, suelosProxyError } from '@/lib/suelos-proxy';

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

  const input = readIdentifyParams(new URL(req.url).searchParams);
  if (!input) {
    return suelosProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${SUELOS_UPSTREAM_SERVICE}/identify`);
  upstream.search = identifySearch(input, 'all');

  const { response, body, timedOut, bodyError } = await fetchArcGis(
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
  if (mediaType(response) !== 'application/json') {
    console.error('CIREN soils identify returned an invalid content type.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (timedOut) {
    return suelosProxyError(req, 504, 'UPSTREAM_TIMEOUT', OPERATION);
  }
  if (bodyError || !body) {
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

  const data = parseJsonBody<ArcGisIdentifyResponse>(body);
  if (!data) {
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
