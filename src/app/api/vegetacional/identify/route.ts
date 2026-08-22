import { enforce, corsHeaders } from '@/lib/security';
import { vegetacionalLayerIds } from '@/lib/vegetacional';
import { fetchCiren, parseNumberTuple, readExactParams, validGeographicExtent, validGeographicPoint, validIntegerTuple } from '@/lib/suelos-proxy';
import { VEGETACIONAL_UPSTREAM_SERVICE, vegetacionalProxyError } from '@/lib/vegetacional-proxy';

const OPERATION = 'identify' as const;
const ALLOWED_FIELDS = new Set(['uso', 'uso_tierra', 'subuso', 'estructura', 'cobertura', 'tipo_fores', 'nom_reg', 'nom_prov', 'nom_com', 'codreg', 'codprov', 'codcom', 'superf_ha', ...[1, 2, 3, 4, 5, 6].flatMap((n) => [`especi${n}_ci`, `especi${n}_co`])]);
export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const input = readExactParams(new URL(req.url).searchParams, ['geometry', 'mapExtent', 'imageDisplay', 'tolerance']);
  const geometry = input ? parseNumberTuple(input.geometry, 2) : null;
  const extent = input ? parseNumberTuple(input.mapExtent, 4) : null;
  const display = input ? parseNumberTuple(input.imageDisplay, 3) : null;
  const tolerance = input ? Number(input.tolerance) : Number.NaN;
  if (!geometry || !extent || !display || !validGeographicPoint(geometry) || !validGeographicExtent(extent) || !validIntegerTuple(display.slice(0, 2), 2, 1, 2048) || !Number.isInteger(display[2]) || display[2] < 72 || display[2] > 192 || !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10) {
    return vegetacionalProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }
  const layerIds = vegetacionalLayerIds(extent);
  if (layerIds.length === 0) return Response.json({ results: [] }, { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } });
  const upstream = new URL(`${VEGETACIONAL_UPSTREAM_SERVICE}/identify`);
  upstream.search = new URLSearchParams({ geometry: geometry.join(','), geometryType: 'esriGeometryPoint', sr: '4326', layers: `visible:${layerIds.join(',')}`, tolerance: String(tolerance), mapExtent: extent.join(','), imageDisplay: display.join(','), returnGeometry: 'false', f: 'json' }).toString();
  const { response, body, timedOut, bodyError } = await fetchCiren(upstream, 'application/json', 512 * 1024);
  if (!response) return vegetacionalProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  if (!response.ok || timedOut || bodyError || !body) return vegetacionalProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  let data: { results?: unknown; error?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return vegetacionalProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION); }
  if (data.error || !Array.isArray(data.results)) return vegetacionalProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', OPERATION);
  const results = (data.results as Array<{ layerName?: unknown; attributes?: unknown }>).slice(0, 20).map((result) => {
    const attributes: Record<string, string | number | null> = {};
    if (result.attributes && typeof result.attributes === 'object') {
      for (const [rawKey, rawValue] of Object.entries(result.attributes as Record<string, unknown>)) {
        const key = rawKey.trim().toLowerCase();
        if (!ALLOWED_FIELDS.has(key)) continue;
        if (typeof rawValue === 'number' && Number.isFinite(rawValue)) attributes[key] = rawValue;
        else if (typeof rawValue === 'string') attributes[key] = rawValue.slice(0, 500);
        else if (rawValue == null) attributes[key] = null;
      }
    }
    return { layerName: typeof result.layerName === 'string' ? result.layerName.slice(0, 160) : '', attributes };
  });
  return Response.json({ results }, { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } });
}
