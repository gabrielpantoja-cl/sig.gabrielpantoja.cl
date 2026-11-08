import { enforce, corsHeaders } from '@/lib/security';
import {
  fetchArcGis,
  isPngBody,
  mediaType,
  pngResponse,
  readExportParams,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';
import {
  SII_PREDIOS_DEFAULT_LAYER,
} from '@/lib/sii-predios';
import { siiPrediosProxyError } from '@/lib/sii-predios-proxy';

const OPERATION = 'export' as const;
const MAX_PNG_BYTES = 20 * 1024 * 1024;

/** Servicio WMS del SII (proxy de mapas). Requiere sesión en su visor oficial;
 *  desde este SIG se consulta de forma anónima a través de este mismo proxy. */
const SII_WMS_BASE =
  'https://www4.sii.cl/mapasui/services/ui/wmsProxyService/call';

/** Cabeceras que el WMS del SII exige para no rechazar el cliente anónimo. */
const SII_WMS_HEADERS: Record<string, string> = {
  Referer: 'https://www4.sii.cl/mapasui/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(req), Vary: 'Origin' },
  });
}

/** `?bbox=oeste,sur,este,norte&size=ancho,alto[&layer=sii:...]` — un PNG por
 *  viewport del WMS del SII. `layer` es opcional; por defecto se usa la capa
 *  de deslindes prediales que indicó el usuario. */
export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readExportParams(new URL(req.url).searchParams);
  if (!input || !validGeographicExtent(input.bbox) || !validIntegerTuple(input.size, 2, 1, 2048)) {
    return siiPrediosProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  // Capa WMS solicitada (opcional) o la por defecto. Se valida que no traiga
  // caracteres raros: solo alfanumérico, dos puntos, guión bajo y dos puntos.
  const rawLayer = new URL(req.url).searchParams.get('layer');
  const layer =
    rawLayer && /^[A-Za-z0-9:_\-.]+$/.test(rawLayer)
      ? rawLayer
      : SII_PREDIOS_DEFAULT_LAYER;

  const upstream = new URL(SII_WMS_BASE);
  upstream.search = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: layer,
    BBOX: input.bbox.join(','),
    SRS: 'EPSG:4326',
    WIDTH: String(input.size[0]),
    HEIGHT: String(input.size[1]),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
    STYLES: '',
  }).toString();

  console.log('Upstream SII:', upstream.toString());

  const { response, body, timedOut, bodyError } = await fetchArcGis(
    upstream,
    'image/png',
    MAX_PNG_BYTES,
    SII_WMS_HEADERS,
  );
  if (!response) {
    return siiPrediosProxyError(
      req,
      timedOut ? 504 : 502,
      timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      OPERATION,
    );
  }
  if (!response.ok) {
    const ct = response.headers.get('content-type') ?? '';
    let sample = '';
    try {
      sample = await response.text();
      sample = sample.slice(0, 300);
    } catch {}
    console.error(
      'SII predios WMS upstream error:',
      response.status,
      'content-type:',
      ct,
      'body sample:',
      sample,
    );
    return siiPrediosProxyError(req, 502, 'UPSTREAM_HTTP_ERROR', OPERATION);
  }
  if (mediaType(response) !== 'image/png') {
    console.error('SII predios WMS returned an invalid content type.');
    return siiPrediosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (timedOut) {
    return siiPrediosProxyError(req, 504, 'UPSTREAM_TIMEOUT', OPERATION);
  }
  if (bodyError || !isPngBody(body)) {
    console.error('SII predios WMS returned an invalid PNG body.');
    return siiPrediosProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }

  return pngResponse(req, body);
}
