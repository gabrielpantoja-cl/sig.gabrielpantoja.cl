import { enforce, corsHeaders } from '@/lib/security';
import { SUELOS_EXPORT_LAYERS } from '@/lib/suelos';
import {
  SUELOS_UPSTREAM_SERVICE,
  fetchCiren,
  parseNumberTuple,
  readExactParams,
  suelosProxyError,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/suelos-proxy';

const OPERATION = 'export' as const;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

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

  const input = readExactParams(new URL(req.url).searchParams, ['bbox', 'size']);
  const bbox = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  if (!bbox || !size || !validGeographicExtent(bbox) || !validIntegerTuple(size, 2, 1, 2048)) {
    return suelosProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${SUELOS_UPSTREAM_SERVICE}/export`);
  upstream.search = new URLSearchParams({
    bbox: bbox.join(','),
    bboxSR: '4326',
    imageSR: '3857',
    size: size.join(','),
    layers: SUELOS_EXPORT_LAYERS,
    format: 'png32',
    transparent: 'true',
    f: 'image',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchCiren(
    upstream,
    'image/png',
    MAX_PNG_BYTES,
  );
  if (!response) {
    return suelosProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok) {
    console.error('CIREN soils export returned an upstream error:', response.status);
    return suelosProxyError(req, 502, 'UPSTREAM_HTTP_ERROR', OPERATION);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'image/png') {
    console.error('CIREN soils export returned an invalid content type.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (timedOut) {
    return suelosProxyError(req, 504, 'UPSTREAM_TIMEOUT', OPERATION);
  }
  if (
    bodyError || !body || body.length < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((byte, index) => body[index] === byte)
  ) {
    console.error('CIREN soils export returned an invalid PNG body.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

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
