import { enforce, corsHeaders } from '@/lib/security';
import { SUELOS_EXPORT_LAYERS } from '@/lib/suelos';
import {
  fetchArcGis,
  isPngBody,
  mediaType,
  pngResponse,
  readExportParams,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';
import { SUELOS_UPSTREAM_SERVICE, suelosProxyError } from '@/lib/suelos-proxy';

const OPERATION = 'export' as const;
const MAX_PNG_BYTES = 20 * 1024 * 1024;

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

  const input = readExportParams(new URL(req.url).searchParams);
  if (!input || !validGeographicExtent(input.bbox) || !validIntegerTuple(input.size, 2, 1, 2048)) {
    return suelosProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${SUELOS_UPSTREAM_SERVICE}/export`);
  upstream.search = new URLSearchParams({
    bbox: input.bbox.join(','),
    bboxSR: '4326',
    imageSR: '3857',
    size: input.size.join(','),
    layers: SUELOS_EXPORT_LAYERS,
    format: 'png32',
    transparent: 'true',
    f: 'image',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchArcGis(
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
  if (mediaType(response) !== 'image/png') {
    console.error('CIREN soils export returned an invalid content type.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (timedOut) {
    return suelosProxyError(req, 504, 'UPSTREAM_TIMEOUT', OPERATION);
  }
  if (bodyError || !isPngBody(body)) {
    console.error('CIREN soils export returned an invalid PNG body.');
    return suelosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

  return pngResponse(req, body);
}
