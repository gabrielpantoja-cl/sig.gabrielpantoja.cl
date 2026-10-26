import 'server-only';
import { fromUrl, type GeoTIFF } from 'geotiff';
import { pngIndexado } from './png-indexado';
import INDICE from './relieve-baldosas.json';
import {
  METROS_POR_GRADO,
  PALETA_EXPOSICION,
  PALETA_PENDIENTE,
  PALETA_SOMBREADO,
  PIXEL_GRADOS,
  anchoBaldosa,
  baldosaDe,
  exposicionGrados,
  gradienteHorn,
  indiceExposicion,
  indicePendiente,
  indiceSombreado,
  nivelPara,
  pendienteGrados,
  pendientePct,
  sombreado,
  type Gradiente,
  type RelieveModo,
  type RelievePunto,
} from './relieve';
import { crucesFila, resumirRelieve, type RelieveZonal } from './zonal';
import type { PoligonoGeoJson } from './analisis-predio';

/**
 * Relieve — pintado server-side por viewport desde Copernicus DEM GLO-30.
 *
 * Mismo patrón que NDVI Visual (`ndvi-raster.ts`): el cliente pide UN PNG por
 * vista y aquí se leen los COG públicos de AWS por rangos HTTP. Diferencias que
 * mandan el diseño:
 *
 * 1. **Mosaico en la grilla de Copernicus, no en la de salida.** La pendiente
 *    necesita vecinos (ventana 3 × 3 de Horn), así que primero se arma un
 *    mosaico de cotas en la grilla nativa del nivel elegido — con 2 celdas de
 *    margen para que el borde de la imagen también tenga vecinos — y recién
 *    después se remuestrea a la grilla de salida. Calcular la pendiente sobre
 *    píxeles ya remuestreados mezclaría la interpolación con el terreno.
 * 2. **Se interpola el GRADIENTE, no el color.** Cada píxel de salida toma
 *    (dz/dx, dz/dy) bilineal de las 4 celdas vecinas y de ahí calcula
 *    pendiente, exposición o sombreado: el resultado es continuo a cualquier
 *    zoom, sin los bloques de un vecino más cercano.
 * 3. **Agua = gradiente exactamente cero.** Copernicus aplana lagos, ríos
 *    anchos y el mar costero a una cota constante; el terreno real nunca da
 *    un gradiente float exactamente nulo en las 4 celdas. Esas celdas quedan
 *    transparentes en vez de pintarse como «clase A: plano».
 *
 * Píxeles: la baldosa `S40_00_W074_00` va de -74 a -73 y de -40 a -39, con el
 * origen en la esquina noroeste y el píxel de 1″ alineado a grados enteros
 * (verificado con `getBoundingBox`). Los overviews no traen transform: se
 * derivan dividiendo el ancho nativo por 2^nivel, la convención de GDAL.
 */

/** Baldosas que existen (sin baldosa = mar). */
const EXISTENTES = new Set(INDICE.baldosas);
const codigo = (latSur: number, lngOeste: number) =>
  `S${String(-latSur).padStart(2, '0')}W${String(-lngOeste).padStart(3, '0')}`;

/** Margen del mosaico, en celdas: 1 para Horn + 1 para la bilineal del borde. */
const MARGEN_CELDAS = 2;
/** Techo de celdas del mosaico (~48 MB en float32 + gradientes). */
const CELDAS_MAX = 6_000_000;
/** Bloque de lectura de la fuente remota (las baldosas internas son de 1024 px). */
const BLOQUE_BYTES = 1 << 18;
/** Exageración vertical del SOMBREADO por nivel: el overview aplana el relieve. */
const EXAGERACION = [1, 1.3, 1.7, 2.2];

/** Validaciones de la ruta. */
export const RELIEVE_SIZE_MIN = 64;
export const RELIEVE_SIZE_MAX = 2048;
export const RELIEVE_SPAN_LON_MAX = 4.5;
export const RELIEVE_SPAN_LAT_MAX = 3.5;

/* ---------- COG abiertos (caché por instancia) ---------- */

/** Los encabezados de un COG cuestan una petición: en una instancia caliente
 *  se reutilizan (la pirámide y sus offsets no cambian nunca). */
const abiertos = new Map<string, Promise<GeoTIFF>>();
const ABIERTOS_MAX = 48;

function abrir(nombre: string): Promise<GeoTIFF> {
  const enCache = abiertos.get(nombre);
  if (enCache) {
    abiertos.delete(nombre);
    abiertos.set(nombre, enCache);
    return enCache;
  }
  const opciones = { blockSize: BLOQUE_BYTES } as Parameters<typeof fromUrl>[1];
  const promesa = fromUrl(
    `https://copernicus-dem-30m.s3.amazonaws.com/${nombre}/${nombre}.tif`,
    opciones,
  );
  promesa.catch(() => abiertos.delete(nombre));
  abiertos.set(nombre, promesa);
  while (abiertos.size > ABIERTOS_MAX) abiertos.delete(abiertos.keys().next().value as string);
  return promesa;
}

/* ---------- Mosaico ---------- */

interface Mosaico {
  /** Cotas, fila 0 = norte; NaN donde no hay baldosa (mar). */
  z: Float32Array;
  cols: number;
  filas: number;
  /** Borde oeste y norte del mosaico (bordes de celda, no centros). */
  oeste: number;
  norte: number;
  resLon: number;
  resLat: number;
  nivel: number;
}

/**
 * Cotas del nivel `nivel` que cubren la caja más `MARGEN_CELDAS`. La grilla
 * del mosaico es la de la baldosa del centro; si la caja cruza los 50° S (donde
 * cambia el espaciado en longitud) las baldosas del otro lado se muestrean por
 * vecino más cercano, que a esa escala no se nota.
 */
async function leerMosaico(
  caja: readonly [number, number, number, number],
  nivel: number,
  signal: AbortSignal,
): Promise<Mosaico> {
  const [west, south, east, north] = caja;
  const resLat = PIXEL_GRADOS * 2 ** nivel;
  const anchoCentro = anchoBaldosa(Math.floor((south + north) / 2));
  const resLon = resLat * (3600 / anchoCentro);
  // Índices globales de celda: 1/res es entero, así que la grilla cae en grados enteros.
  const c0 = Math.floor(west / resLon) - MARGEN_CELDAS;
  const c1 = Math.ceil(east / resLon) + MARGEN_CELDAS;
  const r0 = Math.floor(-north / resLat) - MARGEN_CELDAS;
  const r1 = Math.ceil(-south / resLat) + MARGEN_CELDAS;
  const cols = c1 - c0;
  const filas = r1 - r0;
  if (cols * filas > CELDAS_MAX) throw new RangeError('Vista demasiado grande para el relieve');
  const m: Mosaico = {
    z: new Float32Array(cols * filas).fill(Number.NaN),
    cols, filas, oeste: c0 * resLon, norte: -r0 * resLat, resLon, resLat, nivel,
  };
  const sur = -r1 * resLat;
  const este = c1 * resLon;

  const lecturas: Promise<void>[] = [];
  for (let latSur = Math.floor(sur); latSur < Math.ceil(m.norte); latSur++) {
    for (let lngOeste = Math.floor(m.oeste); lngOeste < Math.ceil(este); lngOeste++) {
      if (!EXISTENTES.has(codigo(latSur, lngOeste))) continue;
      lecturas.push(leerBaldosa(m, latSur, lngOeste, signal));
    }
  }
  await Promise.all(lecturas);
  return m;
}

async function leerBaldosa(m: Mosaico, latSur: number, lngOeste: number, signal: AbortSignal): Promise<void> {
  const { nombre } = baldosaDe(latSur + 0.5, lngOeste + 0.5);
  const tiff = await abrir(nombre);
  const imagen = await tiff.getImage(m.nivel);
  const anchoT = imagen.getWidth();
  const altoT = imagen.getHeight();
  const resLonT = 1 / anchoT;
  const resLatT = 1 / altoT;
  const norteT = latSur + 1;

  // Celdas del mosaico que caen dentro de la baldosa.
  const jc0 = Math.max(0, Math.ceil((lngOeste - m.oeste) / m.resLon - 1e-9));
  const jc1 = Math.min(m.cols, Math.floor((lngOeste + 1 - m.oeste) / m.resLon + 1e-9));
  const ir0 = Math.max(0, Math.ceil((m.norte - norteT) / m.resLat - 1e-9));
  const ir1 = Math.min(m.filas, Math.floor((m.norte - latSur) / m.resLat + 1e-9));
  if (jc1 <= jc0 || ir1 <= ir0) return;

  // Ventana de la baldosa que contiene esos centros de celda.
  const lng0 = m.oeste + (jc0 + 0.5) * m.resLon;
  const lng1 = m.oeste + (jc1 - 0.5) * m.resLon;
  const lat0 = m.norte - (ir0 + 0.5) * m.resLat;
  const lat1 = m.norte - (ir1 - 0.5) * m.resLat;
  const x0 = Math.max(0, Math.floor((lng0 - lngOeste) / resLonT));
  const x1 = Math.min(anchoT, Math.floor((lng1 - lngOeste) / resLonT) + 1);
  const y0 = Math.max(0, Math.floor((norteT - lat0) / resLatT));
  const y1 = Math.min(altoT, Math.floor((norteT - lat1) / resLatT) + 1);
  if (x1 <= x0 || y1 <= y0) return;

  const rasters = await imagen.readRasters({ window: [x0, y0, x1, y1], samples: [0], signal });
  const datos = (rasters as unknown as ArrayLike<number>[])[0];
  const ancho = x1 - x0;
  for (let i = ir0; i < ir1; i++) {
    const lat = m.norte - (i + 0.5) * m.resLat;
    const y = Math.min(y1 - 1, Math.max(y0, Math.floor((norteT - lat) / resLatT))) - y0;
    for (let j = jc0; j < jc1; j++) {
      const lng = m.oeste + (j + 0.5) * m.resLon;
      const x = Math.min(x1 - 1, Math.max(x0, Math.floor((lng - lngOeste) / resLonT))) - x0;
      m.z[i * m.cols + j] = datos[y * ancho + x];
    }
  }
}

/** Gradiente de Horn en cada celda interior; NaN en el borde o junto al mar. */
function gradientes(m: Mosaico): { gx: Float32Array; gy: Float32Array } {
  const gx = new Float32Array(m.z.length).fill(Number.NaN);
  const gy = new Float32Array(m.z.length).fill(Number.NaN);
  const celdaY = m.resLat * METROS_POR_GRADO;
  const ventana = new Float64Array(9);
  for (let i = 1; i < m.filas - 1; i++) {
    const lat = m.norte - (i + 0.5) * m.resLat;
    const celdaX = m.resLon * METROS_POR_GRADO * Math.cos((lat * Math.PI) / 180);
    for (let j = 1; j < m.cols - 1; j++) {
      let valida = true;
      for (let di = -1; di <= 1 && valida; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const v = m.z[(i + di) * m.cols + (j + dj)];
          if (Number.isNaN(v)) {
            valida = false;
            break;
          }
          ventana[(di + 1) * 3 + (dj + 1)] = v;
        }
      }
      if (!valida) continue;
      const g = gradienteHorn(ventana, celdaX, celdaY);
      gx[i * m.cols + j] = g.dzdx;
      gy[i * m.cols + j] = g.dzdy;
    }
  }
  return { gx, gy };
}

/* ---------- Pintado ---------- */

const RADIO_MERCATOR = 6_378_137;
const mercY = (lat: number) => RADIO_MERCATOR * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latDeY = (y: number) => ((2 * Math.atan(Math.exp(y / RADIO_MERCATOR)) - Math.PI / 2) * 180) / Math.PI;

const PALETAS = { sombreado: PALETA_SOMBREADO, pendiente: PALETA_PENDIENTE, exposicion: PALETA_EXPOSICION };

export interface RelieveRasterResultado {
  png: Buffer;
  /** Resolución efectiva del DEM usado (nivel de la pirámide). */
  nivel: number;
  /** Ningún píxel con datos (todo mar): la ruta responde 204. */
  vacio: boolean;
}

/**
 * PNG del modo pedido para la caja (grilla de salida lineal en EPSG:3857,
 * como la estira `L.ImageOverlay`).
 */
export async function renderRelieve(opciones: {
  bbox: readonly [number, number, number, number];
  width: number;
  height: number;
  modo: RelieveModo;
  signal: AbortSignal;
}): Promise<RelieveRasterResultado> {
  const { bbox, width, height, modo, signal } = opciones;
  const [west, south, east, north] = bbox;
  const latMedia = (south + north) / 2;
  const metrosPixel = ((east - west) / width) * METROS_POR_GRADO * Math.cos((latMedia * Math.PI) / 180);
  // El nivel que pide el píxel de salida, o uno más grueso si el mosaico no
  // cabe en memoria (vistas muy anchas a z10: el DEM tendría hasta 4× las
  // celdas del PNG).
  let nivel = nivelPara(metrosPixel);
  const celdas = (k: number) => {
    const res = PIXEL_GRADOS * 2 ** k;
    return ((east - west) / (res * (3600 / anchoBaldosa(Math.floor(latMedia)))) + 6) * ((north - south) / res + 6);
  };
  while (nivel < 3 && celdas(nivel) > CELDAS_MAX) nivel++;
  const m = await leerMosaico(bbox, nivel, signal);
  if (signal.aborted) throw new Error('Relieve cancelado');
  const { gx, gy } = gradientes(m);
  const exagerar = EXAGERACION[nivel];

  const indices = new Uint8Array(width * height);
  const yNorte = mercY(north);
  const ySur = mercY(south);
  let conDatos = 0;
  const g: Gradiente = { dzdx: 0, dzdy: 0 };

  for (let fila = 0; fila < height; fila++) {
    const lat = latDeY(yNorte + ((fila + 0.5) / height) * (ySur - yNorte));
    const fy = (m.norte - lat) / m.resLat - 0.5;
    const i0 = Math.floor(fy);
    const ty = fy - i0;
    if (i0 < 0 || i0 + 1 >= m.filas) continue;
    for (let col = 0; col < width; col++) {
      const lng = west + ((col + 0.5) / width) * (east - west);
      const fx = (lng - m.oeste) / m.resLon - 0.5;
      const j0 = Math.floor(fx);
      const tx = fx - j0;
      if (j0 < 0 || j0 + 1 >= m.cols) continue;
      const a = i0 * m.cols + j0;
      const b = a + 1;
      const c = a + m.cols;
      const d = c + 1;
      const x00 = gx[a], x01 = gx[b], x10 = gx[c], x11 = gx[d];
      if (Number.isNaN(x00) || Number.isNaN(x01) || Number.isNaN(x10) || Number.isNaN(x11)) continue;
      const y00 = gy[a], y01 = gy[b], y10 = gy[c], y11 = gy[d];
      // Agua aplanada por Copernicus: transparente.
      if (x00 === 0 && x01 === 0 && x10 === 0 && x11 === 0 && y00 === 0 && y01 === 0 && y10 === 0 && y11 === 0) {
        continue;
      }
      g.dzdx = (x00 * (1 - tx) + x01 * tx) * (1 - ty) + (x10 * (1 - tx) + x11 * tx) * ty;
      g.dzdy = (y00 * (1 - tx) + y01 * tx) * (1 - ty) + (y10 * (1 - tx) + y11 * tx) * ty;
      conDatos++;
      indices[fila * width + col] =
        modo === 'sombreado'
          ? indiceSombreado(sombreado(g, exagerar))
          : modo === 'pendiente'
            ? indicePendiente(pendientePct(g))
            : indiceExposicion(exposicionGrados(g), pendientePct(g));
    }
  }
  return { png: pngIndexado(width, height, indices, PALETAS[modo]), nivel, vacio: conDatos === 0 };
}

/* ---------- Consulta del punto ---------- */

/** Cota, pendiente y exposición a 30 m nativos. `null` si el punto es mar. */
export async function relieveEnPunto(lat: number, lng: number, signal: AbortSignal): Promise<RelievePunto | null> {
  const medio = PIXEL_GRADOS;
  const m = await leerMosaico([lng - medio, lat - medio, lng + medio, lat + medio], 0, signal);
  const i = Math.floor((m.norte - lat) / m.resLat);
  const j = Math.floor((lng - m.oeste) / m.resLon);
  if (i < 1 || j < 1 || i >= m.filas - 1 || j >= m.cols - 1) return null;
  const ventana: number[] = [];
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) ventana.push(m.z[(i + di) * m.cols + (j + dj)]);
  }
  if (ventana.some(Number.isNaN)) return null;
  const celdaY = m.resLat * METROS_POR_GRADO;
  const celdaX = m.resLon * METROS_POR_GRADO * Math.cos((lat * Math.PI) / 180);
  const g = gradienteHorn(ventana, celdaX, celdaY);
  return {
    cota: ventana[4],
    pendientePct: pendientePct(g),
    pendienteGrados: pendienteGrados(g),
    exposicion: exposicionGrados(g),
  };
}

/* ---------- Estadística zonal del predio ---------- */

/**
 * Celdas máximas del mosaico para la ficha del predio: ~1,5 M celdas a 30 m
 * son ~13.000 ha. Un predio más grande sube de nivel de pirámide (60, 120,
 * 240 m), que la ficha informa en `resolucionM`.
 */
const CELDAS_ZONAL = 1_500_000;

/**
 * Pendiente (Horn, sobre la grilla nativa de Copernicus, igual que la capa) y
 * cota de cada celda cuyo centro cae dentro del predio, resumidas por
 * `resumirRelieve`. `null` si el predio es mar o más chico que una celda.
 */
export async function relieveEnPoligono(geometry: PoligonoGeoJson, signal: AbortSignal): Promise<RelieveZonal | null> {
  const anillos = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const anillo of anillos) {
    for (const [lng, lat] of anillo) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  const latMedia = (south + north) / 2;
  const celdas = (k: number) => {
    const res = PIXEL_GRADOS * 2 ** k;
    return ((east - west) / (res * (3600 / anchoBaldosa(Math.floor(latMedia)))) + 6) * ((north - south) / res + 6);
  };
  let nivel = 0;
  while (nivel < 3 && celdas(nivel) > CELDAS_ZONAL) nivel++;

  const m = await leerMosaico([west, south, east, north], nivel, signal);
  if (signal.aborted) throw new Error('Relieve cancelado');
  const { gx, gy } = gradientes(m);
  const pendientes: number[] = [];
  const cotas: number[] = [];
  const g: Gradiente = { dzdx: 0, dzdy: 0 };
  for (let i = 1; i < m.filas - 1; i++) {
    const lat = m.norte - (i + 0.5) * m.resLat;
    if (lat < south || lat > north) continue;
    const cruces = crucesFila(anillos, lat);
    for (let k = 0; k + 1 < cruces.length; k += 2) {
      const j0 = Math.max(1, Math.ceil((cruces[k] - m.oeste) / m.resLon - 0.5));
      const j1 = Math.min(m.cols - 2, Math.floor((cruces[k + 1] - m.oeste) / m.resLon - 0.5));
      for (let j = j0; j <= j1; j++) {
        const idx = i * m.cols + j;
        if (Number.isNaN(gx[idx])) continue;
        g.dzdx = gx[idx];
        g.dzdy = gy[idx];
        pendientes.push(pendientePct(g));
        cotas.push(m.z[idx]);
      }
    }
  }
  return resumirRelieve(pendientes, cotas, m.resLat * METROS_POR_GRADO);
}
