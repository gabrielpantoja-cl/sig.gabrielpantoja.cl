import { corsHeaders, enforce } from '@/lib/security';
import { relieveEnPunto } from '@/lib/relieve-raster';
import { RELIEVE_SERVICE_NAME } from '@/lib/relieve';
import { parseNumberTuple, proxyErrorResponse, readExactParams } from '@/lib/arcgis-proxy';

const OPERATION = 'identify' as const;

export const runtime = 'nodejs';
export const maxDuration = 30;
const PRESUPUESTO_MS = 12_000;

function puntoError(req: Request, status: number, code: string, message: string): Response {
  return proxyErrorResponse(req, status, { code, message, service: RELIEVE_SERVICE_NAME, operation: OPERATION });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

/**
 * `?punto=lng,lat` → `{ relieve: { cota, pendientePct, pendienteGrados,
 * exposicion } | null }` a la resolución nativa de 30 m. `null` = mar.
 */
export async function GET(req: Request) {
  const bloqueado = enforce(req);
  if (bloqueado) return bloqueado;

  const input = readExactParams(new URL(req.url).searchParams, ['punto']);
  const punto = input ? parseNumberTuple(input.punto, 2) : null;
  if (!punto) return puntoError(req, 400, 'INVALID_REQUEST', 'Parámetro punto=lng,lat no válido.');
  const [lng, lat] = punto;
  if (lng < -77.5 || lng > -65.5 || lat < -57 || lat > -17) {
    return puntoError(req, 400, 'INVALID_REQUEST', 'El punto debe estar en Chile continental.');
  }

  const controller = new AbortController();
  let vencido = false;
  const vencimiento = setTimeout(() => {
    vencido = true;
    controller.abort();
  }, PRESUPUESTO_MS);
  try {
    const relieve = await relieveEnPunto(lat, lng, controller.signal);
    return Response.json(
      { relieve },
      { headers: { ...corsHeaders(req), 'Cache-Control': 'public, s-maxage=604800', Vary: 'Origin' } },
    );
  } catch (e) {
    if (vencido) return puntoError(req, 504, 'UPSTREAM_TIMEOUT', 'El modelo de elevación tardó demasiado en responder.');
    console.error('Relieve: fallo en la consulta del punto', e);
    return puntoError(req, 502, 'UPSTREAM_UNAVAILABLE', 'No se pudo leer el modelo de elevación Copernicus (AWS Open Data).');
  } finally {
    clearTimeout(vencimiento);
  }
}
