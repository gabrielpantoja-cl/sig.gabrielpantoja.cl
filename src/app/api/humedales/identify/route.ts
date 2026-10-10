import { enforce, corsHeaders } from '@/lib/security';
import { fetchArcGis, identifySearch, parseJsonBody, readIdentifyParams } from '@/lib/arcgis-proxy';
import {
  HUMEDALES_LAYER_IDS,
  HUMEDALES_UPSTREAM_SERVICE,
  canonicalHumedal,
  humedalesProxyError,
} from '@/lib/humedales-proxy';
import type { HumedalIdentifyResult } from '@/lib/humedales';

const OPERATION = 'identify' as const;
const MAX_JSON_BYTES = 512 * 1024;

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readIdentifyParams(new URL(req.url).searchParams);
  if (!input) {
    return humedalesProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${HUMEDALES_UPSTREAM_SERVICE}/identify`);
  upstream.search = identifySearch(input, `all:${HUMEDALES_LAYER_IDS}`);

  const { response, body, timedOut, bodyError } = await fetchArcGis(upstream, 'application/json', MAX_JSON_BYTES);
  if (!response) {
    return humedalesProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok || timedOut || bodyError || !body) {
    return humedalesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  const data = parseJsonBody<{ results?: unknown; error?: unknown }>(body);
  if (!data) {
    return humedalesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (data.error || !Array.isArray(data.results)) {
    return humedalesProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', OPERATION);
  }

  // Un humedal urbano declarado es también un polígono del inventario: se
  // devuelven ambos, primero la declaración (es la que tiene efecto legal).
  const results = (data.results as Array<{ layerId?: unknown; attributes?: unknown }>)
    .slice(0, 20)
    .map(canonicalHumedal)
    .filter((result): result is HumedalIdentifyResult => result !== null)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'urbano' ? -1 : 1));

  return Response.json(
    { results },
    { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } },
  );
}
