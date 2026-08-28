import { enforce, corsHeaders } from '@/lib/security';
import { PROPIEDADES_RURALES_LAYER_IDS } from '@/lib/propiedades-rurales';
import { PROPIEDADES_RURALES_UPSTREAM_SERVICE, fetchCiren, parseNumberTuple, readExactParams, propiedadesRuralesProxyError, ruralExtent, validGeographicPoint, validIntegerTuple } from '@/lib/propiedades-rurales-proxy';

export const runtime = 'nodejs';
const ROL = /^\d{1,6}-[\dkK]$/;
const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 160) : null;
const attr = (a: Record<string, unknown>, names: string[]) => { const key = Object.keys(a).find((k) => names.includes(k.toLowerCase()) || names.includes(String(a[k]).toLowerCase())); return key ? text(a[key]) : null; };

export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } }); }

export async function GET(req: Request) {
  const blocked = enforce(req); if (blocked) return blocked;
  const input = readExactParams(new URL(req.url).searchParams, ['geometry', 'mapExtent', 'imageDisplay', 'tolerance']);
  const point = input ? parseNumberTuple(input.geometry, 2) : null;
  const extent = input ? parseNumberTuple(input.mapExtent, 4) : null;
  const display = input ? parseNumberTuple(input.imageDisplay, 3) : null;
  const tolerance = input ? Number(input.tolerance) : NaN;
  if (!point || !extent || !display || !validGeographicPoint(point) || !ruralExtent(extent) || !validIntegerTuple(display.slice(0, 2), 2, 1, 2048) || !Number.isInteger(display[2]) || display[2] < 72 || display[2] > 192 || !Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10) return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', 'identify');
  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/identify`);
  upstream.search = new URLSearchParams({ geometry: point.join(','), geometryType: 'esriGeometryPoint', sr: '4326', layers: `visible:${PROPIEDADES_RURALES_LAYER_IDS.join(',')}`, tolerance: String(tolerance), mapExtent: extent.join(','), imageDisplay: display.join(','), returnGeometry: 'false', f: 'json' }).toString();
  const { response, body, timedOut, bodyError } = await fetchCiren(upstream, 'application/json', 512 * 1024);
  if (!response) return propiedadesRuralesProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', 'identify');
  if (!response.ok || bodyError || !body) return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_UNAVAILABLE', 'identify');
  let data: { results?: Array<{ layerName?: unknown; attributes?: unknown }>; error?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', 'identify'); }
  if (data.error || !Array.isArray(data.results)) return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', 'identify');
  const results = data.results.slice(0, 10).map(({ layerName, attributes }) => {
    const a = attributes && typeof attributes === 'object' ? attributes as Record<string, unknown> : {};
    const rol = attr(a, ['rol', 'rol sii del predio', 'rol propiedad']);
    return { layerName: text(layerName), attributes: { rol: rol && ROL.test(rol) ? rol : null, comuna: attr(a, ['desccomu', 'nombre comuna propiedad']), provincia: attr(a, ['provdere']), region: attr(a, ['regidere']), codComuna: attr(a, ['codcomu', 'codigo comuna propiedad']), codProvincia: attr(a, ['codprov', 'codigo provincia propiedad']), codRegion: attr(a, ['codreg', 'codigo region propiedad']), ...(rol && !ROL.test(rol) ? { quality: 'rol-invalid' as const } : {}) } };
  });
  return Response.json({ results }, { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } });
}
