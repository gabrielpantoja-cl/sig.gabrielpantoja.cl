import { enforce, corsHeaders } from '@/lib/security';
import { PROPIEDADES_RURALES_LAYER_IDS } from '@/lib/propiedades-rurales';
import { PROPIEDADES_RURALES_UPSTREAM_SERVICE, fetchCiren, parseNumberTuple, readExactParams, propiedadesRuralesProxyError, ruralExtent, validIntegerTuple } from '@/lib/propiedades-rurales-proxy';

export const runtime = 'nodejs';
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } }); }

export async function GET(req: Request) {
  const blocked = enforce(req); if (blocked) return blocked;
  const input = readExactParams(new URL(req.url).searchParams, ['bbox', 'size']);
  const bbox = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  if (!bbox || !size || !ruralExtent(bbox) || !validIntegerTuple(size, 2, 1, 2048) || size[0] * size[1] > 2_100_000) return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', 'export');
  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/export`);
  upstream.search = new URLSearchParams({ bbox: bbox.join(','), bboxSR: '4326', imageSR: '3857', size: size.join(','), layers: `show:${PROPIEDADES_RURALES_LAYER_IDS.join(',')}`, format: 'png32', transparent: 'true', dpi: '96', f: 'image' }).toString();
  const { response, body, timedOut, bodyError } = await fetchCiren(upstream, 'image/png', 20 * 1024 * 1024);
  if (!response) return propiedadesRuralesProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', 'export');
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/png' || bodyError || !body || body.length < 8 || !PNG_SIGNATURE.every((b, i) => body[i] === b)) return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', 'export');
  return new Response(body as BodyInit, { headers: { ...corsHeaders(req), 'Content-Type': 'image/png', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', Vary: 'Origin' } });
}
