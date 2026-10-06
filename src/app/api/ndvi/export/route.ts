import { corsHeaders, createRateLimiter, enforce } from '@/lib/security';
import {
  NDVI_VISUAL_SIZE_MAX,
  NDVI_VISUAL_SIZE_MIN,
  NDVI_VISUAL_SPAN_LAT_MAX,
  NDVI_VISUAL_SPAN_LON_MAX,
  renderNdviRaster,
} from '@/lib/ndvi-raster';
import {
  parseNumberTuple,
  readExactParams,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';

const OPERATION = 'export' as const;
const SERVICE =
  'Element 84 Earth Search · Sentinel-2 L2A COG (AWS Open Data)';

export const runtime = 'nodejs';
/** El renderer corta a los 20 s (PRESUPUESTO_MS) y responde 504; el techo del
 *  runtime queda encima solo como red de seguridad. */
export const maxDuration = 60;
/** Presupuesto de composición por viewport. Un bbox del tamaño máximo pinta
 *  hasta 8 escenas secuenciales con lecturas de COG; si no alcanza, mejor 504
 *  (y el legend lo muestra como servicio caído) que un PNG a medio pintar. */
const PRESUPUESTO_MS = 20_000;

/** Chile continental con margen: la capa no es un servicio NDVI mundial. */
const CHILE = { oeste: -76.5, este: -66, sur: -56.5, norte: -17 };

// Límite propio contra ráfagas de `moveend` (además de `enforce`, 60/min):
// cada viewport dispara una composición con decenas de MB de COG.
const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_VENTANA = 120;
const excedeLimite = createRateLimiter(VENTANA_MS, MAX_POR_VENTANA);

function ndviExportError(req: Request, status: number, code: string, mensaje: string): Response {
  return Response.json(
    { error: { code, message: mensaje, service: SERVICE, operation: OPERATION } },
    { status, headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } },
  );
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

/** `?bbox=oeste,sur,este,norte&size=ancho,alto` — un PNG por viewport. */
export async function GET(req: Request) {
  const bloqueado = enforce(req);
  if (bloqueado) return bloqueado;

  const input = readExactParams(new URL(req.url).searchParams, ['bbox', 'size']);
  const crudo = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  if (!crudo || !size || !validGeographicExtent(crudo) || !validIntegerTuple(size, 2, NDVI_VISUAL_SIZE_MIN, NDVI_VISUAL_SIZE_MAX)) {
    return ndviExportError(
      req,
      400,
      'INVALID_REQUEST',
      `Los parámetros no son válidos: bbox (oeste,sur,este,norte) y size entre ${NDVI_VISUAL_SIZE_MIN} y ${NDVI_VISUAL_SIZE_MAX} px.`,
    );
  }
  const bbox = crudo as [number, number, number, number];
  const [west, south, east, north] = bbox;
  const enChile = ([lng, lat]: [number, number]) =>
    lng >= CHILE.oeste && lng <= CHILE.este && lat >= CHILE.sur && lat <= CHILE.norte;
  if (
    !(west < east && south < north) ||
    !([[west, south], [east, south], [east, north], [west, north]] as [number, number][]).every(enChile) ||
    east - west > NDVI_VISUAL_SPAN_LON_MAX ||
    north - south > NDVI_VISUAL_SPAN_LAT_MAX
  ) {
    return ndviExportError(
      req,
      400,
      'INVALID_REQUEST',
      'La caja debe estar dentro de Chile continental y medir como máximo ~360 × 340 km.',
    );
  }
  if (excedeLimite(req)) {
    return ndviExportError(req, 429, 'LIMITE', 'Demasiadas consultas NDVI seguidas. Espera unos minutos.');
  }

  const controller = new AbortController();
  let presupuestoVencido = false;
  let clienteAbandonado = false;
  const vencimiento = setTimeout(() => {
    presupuestoVencido = true;
    controller.abort();
  }, PRESUPUESTO_MS);
  const alCancelar = () => {
    clienteAbandonado = true;
    controller.abort();
  };
  req.signal.addEventListener('abort', alCancelar);

  try {
    const { png, fecha, escenas } = await renderNdviRaster({
      bbox,
      width: size[0],
      height: size[1],
      signal: controller.signal,
    });
    if (!escenas) {
      // Ninguna escena útil en la caja (más allá del margen costero o sin
      // cobertura): la capa queda transparente y el mapa de base se ve solo.
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(req),
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
          Vary: 'Origin',
        },
      });
    }
    const headers: Record<string, string> = {
      ...corsHeaders(req),
      'Content-Type': 'image/png',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      Vary: 'Origin',
    };
    if (fecha) headers['X-Ndvi-Fecha'] = fecha;
    return new Response(new Uint8Array(png), { headers });
  } catch (e) {
    if (presupuestoVencido) {
      return ndviExportError(
        req,
        504,
        'PRESUPUESTO',
        'La composición NDVI superó los 20 s permitidos. Intenta con una vista más pequeña.',
      );
    }
    if (clienteAbandonado || req.signal.aborted) {
      return ndviExportError(req, 499, 'CANCELADA', 'La consulta fue cancelada.');
    }
    console.error('NDVI visual: fallo al componer el raster', e);
    return ndviExportError(
      req,
      502,
      'FUENTE_NO_DISPONIBLE',
      'No se pudieron leer las imágenes de Sentinel-2 (Element 84 Earth Search / AWS). Intenta de nuevo en unos minutos.',
    );
  } finally {
    clearTimeout(vencimiento);
    req.signal.removeEventListener('abort', alCancelar);
  }
}
