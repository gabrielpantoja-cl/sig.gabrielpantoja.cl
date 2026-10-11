import { corsHeaders, createRateLimiterWithRetry, enforce, rateLimitResponse } from '@/lib/security';
import {
  RELIEVE_SIZE_MAX,
  RELIEVE_SIZE_MIN,
  RELIEVE_SPAN_LAT_MAX,
  RELIEVE_SPAN_LON_MAX,
  renderRelieve,
} from '@/lib/relieve-raster';
import { RELIEVE_SERVICE_NAME, esRelieveModo } from '@/lib/relieve';
import {
  parseNumberTuple,
  proxyErrorResponse,
  readExactParams,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';

const OPERATION = 'export' as const;

export const runtime = 'nodejs';
export const maxDuration = 60;
/** Lectura de COG + cálculo por viewport; si no alcanza, 504 honesto. */
const PRESUPUESTO_MS = 20_000;

/** Chile continental con margen (el índice de baldosas cubre S17–S57). */
const CHILE = { oeste: -77.5, este: -65.5, sur: -57, norte: -17 };

// Límite propio contra ráfagas (además de `enforce`, 60/min). Más holgado que
// NDVI: el DEM es inmutable y la CDN absorbe la mayoría de las vistas.
const esperaLimite = createRateLimiterWithRetry(10 * 60 * 1000, 200);

function relieveError(req: Request, status: number, code: string, message: string): Response {
  return proxyErrorResponse(req, status, { code, message, service: RELIEVE_SERVICE_NAME, operation: OPERATION });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

/** `?modo=sombreado|pendiente|exposicion&bbox=oeste,sur,este,norte&size=ancho,alto` */
export async function GET(req: Request) {
  const bloqueado = enforce(req);
  if (bloqueado) return bloqueado;

  const input = readExactParams(new URL(req.url).searchParams, ['modo', 'bbox', 'size']);
  const crudo = input ? parseNumberTuple(input.bbox, 4) : null;
  const size = input ? parseNumberTuple(input.size, 2) : null;
  const modo = input?.modo;
  if (
    !crudo || !size || !esRelieveModo(modo) || !validGeographicExtent(crudo) ||
    !validIntegerTuple(size, 2, RELIEVE_SIZE_MIN, RELIEVE_SIZE_MAX)
  ) {
    return relieveError(
      req, 400, 'INVALID_REQUEST',
      `Los parámetros no son válidos: modo (sombreado, pendiente o exposicion), bbox (oeste,sur,este,norte) y size entre ${RELIEVE_SIZE_MIN} y ${RELIEVE_SIZE_MAX} px.`,
    );
  }
  const bbox = crudo as [number, number, number, number];
  const [west, south, east, north] = bbox;
  if (
    west < CHILE.oeste || east > CHILE.este || south < CHILE.sur || north > CHILE.norte ||
    east - west > RELIEVE_SPAN_LON_MAX || north - south > RELIEVE_SPAN_LAT_MAX
  ) {
    return relieveError(req, 400, 'INVALID_REQUEST', 'La caja debe estar dentro de Chile continental y medir como máximo ~4,5° × 3,5°.');
  }
  const espera = esperaLimite(req);
  if (espera > 0) return rateLimitResponse(req, espera, 'Demasiadas consultas de relieve seguidas. Espera unos minutos.');

  const controller = new AbortController();
  let vencido = false;
  const vencimiento = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, PRESUPUESTO_MS);
  const alCancelar = () => controller.abort();
  req.signal.addEventListener('abort', alCancelar);

  try {
    const { png, nivel, vacio } = await renderRelieve({
      bbox, width: size[0], height: size[1], modo, signal: controller.signal,
    });
    // El DEM no cambia: la CDN puede servir la misma vista por días.
    const cache = 'public, s-maxage=604800, stale-while-revalidate=2592000';
    if (vacio) {
      return new Response(null, { status: 204, headers: { ...corsHeaders(req), 'Cache-Control': cache, Vary: 'Origin' } });
    }
    return new Response(new Uint8Array(png), {
      headers: {
        ...corsHeaders(req),
        'Content-Type': 'image/png',
        'Cache-Control': cache,
        'X-Relieve-Resolucion': String(30 * 2 ** nivel),
        Vary: 'Origin',
      },
    });
  } catch (e) {
    if (vencido) {
      return relieveError(req, 504, 'UPSTREAM_TIMEOUT', 'El cálculo del relieve superó los 20 s. Intenta con una vista más pequeña.');
    }
    if (req.signal.aborted) return relieveError(req, 499, 'CANCELLED', 'La consulta fue cancelada.');
    if (e instanceof RangeError) return relieveError(req, 400, 'INVALID_REQUEST', e.message);
    console.error('Relieve: fallo al calcular el raster', e);
    return relieveError(
      req, 502, 'UPSTREAM_UNAVAILABLE',
      'No se pudo leer el modelo de elevación Copernicus (AWS Open Data). Intenta de nuevo en unos minutos.',
    );
  } finally {
    clearTimeout(vencimiento);
    req.signal.removeEventListener('abort', alCancelar);
  }
}
