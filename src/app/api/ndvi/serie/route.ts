import { corsHeaders, enforce } from '@/lib/security';
import { calcularSerieNdvi } from '@/lib/ndvi-serie';
import {
  NDVI_POLIGONO_LADO_MAX_M,
  NDVI_POLIGONO_VERTICES_MAX,
  NDVI_RADIO_DEFECTO,
  NDVI_RADIO_MAX,
  NDVI_RADIO_MIN,
  redondearCoordenada,
  type NdviGeometria,
  type NdviSerie,
} from '@/lib/ndvi';

export const runtime = 'nodejs';
/** Medido: 25–46 s desde Chile para 36 meses. El presupuesto interno corta
 *  antes y marca los meses pendientes como `tiempo` en vez de fallar entera. */
export const maxDuration = 120;
const PRESUPUESTO_MS = 95_000;

/** Chile continental con margen: la API no es un servicio NDVI mundial. */
const CHILE = { oeste: -76.5, este: -66, sur: -56.5, norte: -17 };

// Límite propio, bastante más estricto que el general de 60/min de `enforce`:
// una consulta lee cientos de MB de COG y dura decenas de segundos.
const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_VENTANA = 12;
const consultas = new Map<string, number[]>();
function excedeLimite(req: Request): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'desconocida';
  const ahora = Date.now();
  const recientes = (consultas.get(ip) ?? []).filter((t) => ahora - t < VENTANA_MS);
  if (recientes.length >= MAX_POR_VENTANA) return true;
  recientes.push(ahora);
  consultas.set(ip, recientes);
  return false;
}

// Caché de polígonos por instancia. Los POST no pasan por la CDN.
const cachePoligonos = new Map<string, NdviSerie>();
const CACHE_POLIGONOS_MAX = 50;

const enChile = (lng: number, lat: number) =>
  lng >= CHILE.oeste && lng <= CHILE.este && lat >= CHILE.sur && lat <= CHILE.norte;

function error(req: Request, status: number, codigo: string, mensaje: string): Response {
  return Response.json(
    { error: { codigo, mensaje } },
    { status, headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } },
  );
}

async function responder(req: Request, geo: NdviGeometria, cacheable: boolean): Promise<Response> {
  const controller = new AbortController();
  const cancelar = () => controller.abort();
  req.signal.addEventListener('abort', cancelar);
  try {
    const serie = await calcularSerieNdvi(geo, { signal: controller.signal, presupuestoMs: PRESUPUESTO_MS });
    const completa = !serie.meses.some((m) => m.estado === 'tiempo');
    return Response.json(serie, {
      headers: {
        ...corsHeaders(req),
        // Los meses pasados no cambian; el más reciente puede ganar escenas
        // reprocesadas, de ahí un día de frescura. Una serie cortada por tiempo
        // no se cachea: el próximo intento podría completarla.
        'Cache-Control': cacheable && completa
          ? 'public, s-maxage=86400, stale-while-revalidate=604800'
          : 'no-store',
        Vary: 'Origin',
      },
    });
  } catch (e) {
    if (controller.signal.aborted) return error(req, 499, 'CANCELADA', 'La consulta fue cancelada.');
    console.error('NDVI: fallo al armar la serie', e);
    return error(
      req,
      502,
      'FUENTE_NO_DISPONIBLE',
      'No se pudo leer el catálogo o las imágenes de Sentinel-2 (Element 84 Earth Search / AWS). Intenta de nuevo en unos minutos.',
    );
  } finally {
    req.signal.removeEventListener('abort', cancelar);
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

/** Punto: `?lat=-39.93&lng=-73.40&radio=100`. */
export async function GET(req: Request) {
  const bloqueado = enforce(req);
  if (bloqueado) return bloqueado;

  const p = new URL(req.url).searchParams;
  const lat = Number(p.get('lat'));
  const lng = Number(p.get('lng'));
  const radio = p.has('radio') ? Number(p.get('radio')) : NDVI_RADIO_DEFECTO;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !enChile(lng, lat)) {
    return error(req, 400, 'PUNTO_INVALIDO', 'El punto debe estar dentro de Chile continental.');
  }
  if (!Number.isInteger(radio) || radio < NDVI_RADIO_MIN || radio > NDVI_RADIO_MAX) {
    return error(req, 400, 'RADIO_INVALIDO', `El radio debe ser un entero entre ${NDVI_RADIO_MIN} y ${NDVI_RADIO_MAX} m.`);
  }
  if (excedeLimite(req)) {
    return error(req, 429, 'LIMITE', 'Demasiadas consultas NDVI seguidas. Espera unos minutos.');
  }
  return responder(
    req,
    { tipo: 'punto', lat: redondearCoordenada(lat), lng: redondearCoordenada(lng), radio },
    true,
  );
}

/** Polígono: cuerpo `{ "anillos": [[[lng, lat], …], …] }`, exterior primero. */
export async function POST(req: Request) {
  const bloqueado = enforce(req);
  if (bloqueado) return bloqueado;

  let anillos: unknown;
  try {
    anillos = ((await req.json()) as { anillos?: unknown }).anillos;
  } catch {
    return error(req, 400, 'CUERPO_INVALIDO', 'Se esperaba JSON con la propiedad "anillos".');
  }
  const esPar = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);
  if (
    !Array.isArray(anillos) || !anillos.length ||
    !anillos.every((a) => Array.isArray(a) && a.length >= 4 && a.every(esPar))
  ) {
    return error(req, 400, 'POLIGONO_INVALIDO', 'El polígono necesita al menos un anillo de 4 vértices [lng, lat].');
  }
  // Los vértices NO se redondean: redondear a 4 decimales colapsaba vértices
  // vecinos en aristas duplicadas. Los POST no pasan por la CDN, así que no hay
  // clave de caché que normalizar.
  const limpio = (anillos as number[][][]).map((a) => a.map(([lng, lat]) => [lng, lat]));
  const vertices = limpio.reduce((s, a) => s + a.length, 0);
  if (vertices > NDVI_POLIGONO_VERTICES_MAX) {
    return error(req, 400, 'POLIGONO_COMPLEJO', `El polígono supera ${NDVI_POLIGONO_VERTICES_MAX} vértices.`);
  }
  const exterior = limpio[0];
  if (!exterior.every(([lng, lat]) => enChile(lng, lat))) {
    return error(req, 400, 'POLIGONO_FUERA', 'El polígono debe estar dentro de Chile continental.');
  }
  const lats = exterior.map((v) => v[1]);
  const lngs = exterior.map((v) => v[0]);
  const latMedia = (Math.max(...lats) + Math.min(...lats)) / 2;
  const altoM = (Math.max(...lats) - Math.min(...lats)) * 111_320;
  const anchoM = (Math.max(...lngs) - Math.min(...lngs)) * 111_320 * Math.cos((latMedia * Math.PI) / 180);
  if (Math.max(altoM, anchoM) > NDVI_POLIGONO_LADO_MAX_M) {
    return error(
      req,
      400,
      'POLIGONO_GRANDE',
      `El polígono mide ${(Math.max(altoM, anchoM) / 1000).toFixed(1)} km de lado; el máximo es ${NDVI_POLIGONO_LADO_MAX_M / 1000} km.`,
    );
  }

  const clave = JSON.stringify(limpio);
  const enCache = cachePoligonos.get(clave);
  if (enCache) {
    return Response.json(enCache, { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } });
  }
  if (excedeLimite(req)) {
    return error(req, 429, 'LIMITE', 'Demasiadas consultas NDVI seguidas. Espera unos minutos.');
  }
  const respuesta = await responder(req, { tipo: 'poligono', anillos: limpio }, false);
  if (respuesta.ok) {
    const serie = (await respuesta.clone().json()) as NdviSerie;
    if (!serie.meses.some((m) => m.estado === 'tiempo')) {
      if (cachePoligonos.size >= CACHE_POLIGONOS_MAX) {
        cachePoligonos.delete(cachePoligonos.keys().next().value as string);
      }
      cachePoligonos.set(clave, serie);
    }
  }
  return respuesta;
}
