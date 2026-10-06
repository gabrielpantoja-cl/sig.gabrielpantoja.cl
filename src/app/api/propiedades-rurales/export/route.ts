import { enforce, corsHeaders } from '@/lib/security';
import { PROPIEDADES_RURALES_LAYER_IDS } from '@/lib/propiedades-rurales';
import {
  fetchArcGis,
  isPngBody,
  mediaType,
  pngResponse,
  readExportParams,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';
import {
  PROPIEDADES_RURALES_UPSTREAM_SERVICE,
  propiedadesRuralesProxyError,
  ruralExtent,
} from '@/lib/propiedades-rurales-proxy';

const OPERATION = 'export' as const;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
/** Techo de píxeles por imagen (~1450 × 1450): acota el costo en el servidor CIREN. */
const MAX_PIXELS = 2_100_000;

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readExportParams(new URL(req.url).searchParams);
  if (
    !input || !ruralExtent(input.bbox) || !validIntegerTuple(input.size, 2, 1, 2048) ||
    input.size[0] * input.size[1] > MAX_PIXELS
  ) {
    return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/export`);
  upstream.search = new URLSearchParams({
    bbox: input.bbox.join(','),
    bboxSR: '4326',
    imageSR: '3857',
    size: input.size.join(','),
    layers: `show:${PROPIEDADES_RURALES_LAYER_IDS.join(',')}`,
    format: 'png32',
    transparent: 'true',
    dpi: '96',
    f: 'image',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchArcGis(upstream, 'image/png', MAX_PNG_BYTES);
  if (!response) {
    return propiedadesRuralesProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok || mediaType(response) !== 'image/png' || bodyError || !isPngBody(body)) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

  return pngResponse(req, body);
}
