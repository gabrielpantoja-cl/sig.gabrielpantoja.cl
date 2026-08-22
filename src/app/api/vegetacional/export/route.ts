import { enforce, corsHeaders } from '@/lib/security';
import { vegetacionalLayerIds } from '@/lib/vegetacional';
import { fetchCiren, parseNumberTuple, readExactParams, validGeographicExtent, validIntegerTuple } from '@/lib/suelos-proxy';
import { VEGETACIONAL_UPSTREAM_SERVICE, vegetacionalProxyError } from '@/lib/vegetacional-proxy';

const OPERATION = 'export' as const;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const input = readExactParams(new URL(req.url).searchParams, ['bbox', 'size']);
  const bbox = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  if (!bbox || !size || !validGeographicExtent(bbox) || !validIntegerTuple(size, 2, 1, 2048)) {
    return vegetacionalProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }
  const layerIds = vegetacionalLayerIds(bbox);
  if (layerIds.length === 0) return new Response(new Uint8Array(), { status: 204, headers: corsHeaders(req) });
  const upstream = new URL(`${VEGETACIONAL_UPSTREAM_SERVICE}/export`);
  upstream.search = new URLSearchParams({ bbox: bbox.join(','), bboxSR: '4326', imageSR: '3857', size: size.join(','), layers: `show:${layerIds.join(',')}`, format: 'png32', transparent: 'true', f: 'image' }).toString();
  const { response, body, timedOut, bodyError } = await fetchCiren(upstream, 'image/png', 20 * 1024 * 1024);
  if (!response) return vegetacionalProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || contentType !== 'image/png' || timedOut || bodyError || !body || !PNG_SIGNATURE.every((byte, index) => body[index] === byte)) {
    return vegetacionalProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  const png = new ArrayBuffer(body.byteLength);
  new Uint8Array(png).set(body);
  return new Response(png, { headers: { ...corsHeaders(req), 'Content-Type': 'image/png', 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600', Vary: 'Origin' } });
}
