import 'server-only';
import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import { PNG } from 'pngjs';
import {
  ROJO_DN_MINIMO,
  SCL_INVALIDAS,
  buscarEscenasPorCaja,
  type StacAsset,
  type StacItem,
} from './ndvi-serie';
import { lonLatToUtm } from './coordenadas';
import { ndviRampRgb } from './ndvi-visual';

/**
 * NDVI Visual — pintado server-side del raster continuo por viewport.
 *
 * Para un bbox + tamaño devuelve UN PNG con el NDVI de la escena reciente de
 * cada cuadrícula MGRS que toca la vista, enmascarando nubes/sombras con SCL
 * (las mismas reglas medidas de `ndvi-serie.ts`). El cliente lo cuelga como
 * `L.ImageOverlay` en `moveend`, al igual que suelos/vegetacional — nunca se
 * habla WMS teselado contra el servidor de nadie.
 *
 * Tres decisiones que cargan todo el diseño:
 *
 * 1. **Overviews (pirámides) del COG.** Sentinel-2 publica 5 niveles
 *    (10 → 160 m; verificado 2026-09-27: IFD0..4 = 10980/5490/2745/1373/687
 *    px). `geotiff` NO los selecciona solo — `readRasters({width,height})`
 *    siempre descarga la ventana NATIVA del IFD y recién después remuestrea —
 *    así que el nivel se elige a mano: el más grueso que quede a ≤ 2× la
 *    resolución del viewport. Sin eso, un bbox de 300 km serían 30.000²
 *    muestras por banda (OOM garantizado).
 * 2. **La pirámide no trae transform afín.** `getResolution()`/`getOrigin()`
 *    lanzan en los IFDs de overview; el affine se deriva del nivel 0 (que sí
 *    lo tiene, desde `proj:transform` del STAC): px_k = px0 × ancho0/ancho_k,
 *    origen compartido — la convención de las pirámides de GDAL.
 * 3. **Grilla lineal en EPSG:3857.** `L.ImageOverlay` estira la imagen
 *    linealmente en el plano proyectado de Leaflet, no en lat/lng: los píxeles
 *    de salida se generan con y lineal en Mercator (la latitud de cada fila
 *    sale de la inversa de Mercator). Rasterear lineal en latitud desplaza el
 *    borde sur ~200 m en un bbox de 1°.
 */

/** Días hacia atrás que mira el catálogo: frescura de la capa visual. */
const DIAS_VENTANA = 45;
/** Nubes sobre las que la escena ni se considera para una grilla. */
const NUBES_ACEPTABLES = 40;
/** Dentro de lo aceptable, las ≤ 15 % son "despejadas": entre ellas gana la
 *  más reciente. La neblina entre nubes NO la marca SCL (cubre 10 km con 4 %
 *  de nube "oficial" y el NDVI hundido de amarillo es mentira), y que TODAS
 *  las grillas del viewport caigan en el mismo día deja la costura de huella
 *  casi invisible — misma fecha = misma iluminación y mismo verde. */
const NUBES_DESPEJADAS = 15;
/** Tope de cuadrículas MGRS pintadas por viewport (defensa contra spans
 *  extremos; el zoom mínimo del cliente mantiene el caso normal en ≤ 6). */
const MAX_ESCENAS = 8;
/** Margen en píxeles de nivel al recortar la ventana de cada banda. */
const MARGEN_PX = 3;
/** Techo de muestras nativas leídas por escena (~80 MB en Uint16). */
const MUESTRAS_MAX = 40_000_000;
/** geotiff parte cada baldosa en bloques de 256 KB (misma cifra que la serie). */
const BLOQUE_BYTES = 1 << 18;

/** Validaciones de la ruta: tamaño de imagen y extensión geográfica. */
export const NDVI_VISUAL_SIZE_MIN = 64;
export const NDVI_VISUAL_SIZE_MAX = 1600;
/** Span máximo en grados (≈ 360 × 340 km): coherente con el zoom mínimo del
 *  cliente y con el techo de muestras por escena. */
export const NDVI_VISUAL_SPAN_LON_MAX = 3.6;
export const NDVI_VISUAL_SPAN_LAT_MAX = 2.6;

export interface NdviRasterResultado {
  /** PNG RGBA; vacío (byteLength 0) cuando no hay escenas útiles en la caja. */
  png: Buffer;
  /** Fecha UTC (YYYY-MM-DD) de la escena más reciente pintada. */
  fecha: string | null;
  escenas: number;
}

const nubes = (item: StacItem): number => Number(item.properties['eo:cloud_cover'] ?? 100);

/** Cuadrícula MGRS del id de la escena (`S2B_18HXB_20260914_0_L2A` → `18HXB`). */
function grillaDe(id: string): string {
  return /^S2[AB]_([0-9]{2}[A-Z]{3})_/.exec(id)?.[1] ?? id;
}

/** Por cuadrícula, en dos niveles: primero las despejadas (≤ 15 %) — de ahí
 *  la más reciente; si ninguna lo está, la de menos nube de las aceptables
 *  (≤ 40 %, o de todo el lote si ninguna pasa ese filtro). Medicido con datos
 *  reales de la ventana 2026-08/09 sobre Valdivia: elegir "más reciente" a
 *  secas escogió una escena de 39 % de nube para una grilla y otra de 3 % para
 *  la vecina, y la banda quedó amarilla por neblina contra la verde del día
 *  claro. */
function elegirEscena(lista: StacItem[]): StacItem {
  const aceptables = lista.filter((item) => nubes(item) <= NUBES_ACEPTABLES);
  const base = aceptables.length ? aceptables : lista;
  const despejadas = base.filter((item) => nubes(item) <= NUBES_DESPEJADAS);
  const candidatas = despejadas.length ? despejadas : base;
  if (despejadas.length) {
    return candidatas.reduce((mejor, item) =>
      item.properties.datetime > mejor.properties.datetime ? item : mejor,
    );
  }
  return candidatas.reduce((mejor, item) => {
    const deItem = nubes(item);
    const deMejor = nubes(mejor);
    if (deItem !== deMejor) return deItem < deMejor ? item : mejor;
    return item.properties.datetime > mejor.properties.datetime ? item : mejor;
  });
}

interface Nivel {
  imagen: GeoTIFFImage;
  ancho: number;
  alto: number;
}

/** Pirámide completa del asset (IFD 0 = resolución nativa). */
async function niveles(tiff: GeoTIFF, signal: AbortSignal): Promise<Nivel[]> {
  const count = await tiff.getImageCount();
  const salida: Nivel[] = [];
  for (let i = 0; i < count; i++) {
    const imagen = await tiff.getImage(i);
    if (signal.aborted) throw new Error('NDVI raster cancelado');
    salida.push({ imagen, ancho: imagen.getWidth(), alto: imagen.getHeight() });
  }
  return salida;
}

/** El nivel más grueso cuyo píxel quede a ≤ 2× la resolución del viewport
 *  (más grueso = menos bytes; ≤ 2× = el remuestreo posterior no muestrea a
 *  ciegas y la superficie queda continua, sin moteado). */
function elegirNivel(lista: Nivel[], px0: number, py0: number, w0: number, h0: number, objetivoM: number): number {
  let elegido = 0;
  for (let k = 1; k < lista.length; k++) {
    const pxk = Math.abs(px0) * (w0 / lista[k].ancho);
    if (pxk > 2 * objetivoM) break;
    elegido = k;
  }
  return elegido;
}

/** Caja UTM (m) de la caja WGS84: se proyectan los 4 vértices y los 4
 *  puntos medios de los lados (los paralelos no son rectos en UTM). */
function cajaUtmDeBbox(
  bbox: readonly [number, number, number, number],
  zona: number,
): { xmin: number; xmax: number; ymin: number; ymax: number } {
  const [west, south, east, north] = bbox;
  const midLon = (west + east) / 2;
  const midLat = (south + north) / 2;
  const puntos: [number, number][] = [
    [west, south], [east, south], [east, north], [west, north],
    [midLon, south], [midLon, north], [west, midLat], [east, midLat],
  ];
  let xmin = Infinity; let xmax = -Infinity; let ymin = Infinity; let ymax = -Infinity;
  for (const [lng, lat] of puntos) {
    const [x, y] = lonLatToUtm(lng, lat, zona);
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  return { xmin, xmax, ymin, ymax };
}

interface Banda {
  datos: ArrayLike<number>;
  ancho: number;
  alto: number;
  /** Affine del nivel elegido (origen del nivel 0, píxel del nivel k). */
  x0: number;
  y0: number;
  px: number;
  py: number;
  /** Ventana leída, en píxeles del nivel. */
  c0: number;
  r0: number;
}

/** Abre el COG, elige nivel, recorta la ventana de la caja UTM y la lee en
 *  nativo del nivel (sin `width/height`: eso no ahorra bytes, solo achica el
 *  array de salida — y el nivel elegido ya está en escala del viewport). */
async function leerBanda(
  asset: StacAsset,
  caja: { xmin: number; xmax: number; ymin: number; ymax: number },
  objetivoM: number,
  signal: AbortSignal,
): Promise<Banda | null> {
  const [px0, , x0, , py0, y0] = asset['proj:transform'];
  const [h0, w0] = asset['proj:shape'];
  // `blockSize` lo acepta la fuente remota en runtime, pero la firma pública de
  // `fromUrl` solo tipa las opciones HTTP (mismo cast documentado en la serie).
  const opciones = { blockSize: BLOQUE_BYTES } as Parameters<typeof fromUrl>[1];
  const tiff = await fromUrl(asset.href, opciones, signal);
  const piramide = await niveles(tiff, signal);
  if (!piramide.length) return null;
  const k = elegirNivel(piramide, px0, py0, w0, h0, objetivoM);
  const nivel = piramide[k];
  const px = px0 * (w0 / nivel.ancho);
  const py = py0 * (h0 / nivel.alto);

  const cols = [(caja.xmin - x0) / px, (caja.xmax - x0) / px];
  const filas = [(caja.ymin - y0) / py, (caja.ymax - y0) / py];
  let c0 = Math.floor(Math.min(...cols)) - MARGEN_PX;
  let c1 = Math.ceil(Math.max(...cols)) + MARGEN_PX;
  let r0 = Math.floor(Math.min(...filas)) - MARGEN_PX;
  let r1 = Math.ceil(Math.max(...filas)) + MARGEN_PX;
  c0 = Math.max(0, c0); c1 = Math.min(nivel.ancho, c1);
  r0 = Math.max(0, r0); r1 = Math.min(nivel.alto, r1);
  if (c1 <= c0 || r1 <= r0) return null;
  if ((c1 - c0) * (r1 - r0) > MUESTRAS_MAX) return null;

  const rasters = await nivel.imagen.readRasters({
    window: [c0, r0, c1, r1],
    signal,
  });
  const datos = (rasters as unknown as ArrayLike<number>[])[0];
  return { datos, ancho: c1 - c0, alto: r1 - r0, x0, y0, px, py, c0, r0 };
}

function interpolarBilineal(
  b: Banda,
  fx: number,
  fy: number,
): number {
  const ic = Math.floor(fx);
  const ir = Math.floor(fy);
  const cx = fx - ic;
  const cy = fy - ir;
  const ic1 = Math.min(ic + 1, b.ancho - 1);
  const ir1 = Math.min(ir + 1, b.alto - 1);
  const i00 = ir * b.ancho + ic;
  const i01 = ir * b.ancho + ic1;
  const i10 = ir1 * b.ancho + ic;
  const i11 = ir1 * b.ancho + ic1;
  const v00 = b.datos[i00];
  const v01 = b.datos[i01];
  const v10 = b.datos[i10];
  const v11 = b.datos[i11];
  // Un cero es nodata del COG (borde de la escena): el píxel queda fuera en
  // vez de mezclar reflectancia falsa en el promedio.
  if (v00 === 0 || v01 === 0 || v10 === 0 || v11 === 0) return -1;
  const superior = v00 + (v01 - v00) * cx;
  const inferior = v10 + (v11 - v10) * cx;
  return superior + (inferior - superior) * cy;
}

/** Inversa de Mercator esférico para la latitud de una fila. */
function latDeY(y: number, radio: number): number {
  return ((2 * Math.atan(Math.exp(y / radio)) - Math.PI / 2) * 180) / Math.PI;
}

export async function renderNdviRaster(opciones: {
  bbox: readonly [number, number, number, number];
  width: number;
  height: number;
  signal: AbortSignal;
}): Promise<NdviRasterResultado> {
  const { bbox, width, height, signal } = opciones;
  const [west, south, east, north] = bbox;

  const hoy = new Date();
  const desde = new Date(hoy.getTime() - DIAS_VENTANA * 86_400_000).toISOString().slice(0, 10);
  const hasta = hoy.toISOString().slice(0, 10);
  const items = await buscarEscenasPorCaja(bbox, desde, hasta, signal);
  if (signal.aborted) throw new Error('NDVI raster cancelado');

  // Una escena por cuadrícula MGRS; si hay más cuadrículas que el techo, se
  // quedan las de menos nubes (las grillas con peor nube son las que más
  // enmienda necesitan igual). Se pintan de peor a mejor nube para que la
  // escena más despejada quede ENCIMA en los solapes de borde de cuadrícula.
  const porGrilla = new Map<string, StacItem[]>();
  for (const item of items) {
    if (!item.assets.red || !item.assets.nir || !item.assets.scl) continue;
    if (!Number(item.properties['mgrs:utm_zone'])) continue;
    const grilla = grillaDe(item.id);
    const lista = porGrilla.get(grilla);
    if (lista) lista.push(item);
    else porGrilla.set(grilla, [item]);
  }
  if (!porGrilla.size) return { png: Buffer.alloc(0), fecha: null, escenas: 0 };

  const elegidas = [...porGrilla.values()].map(elegirEscena);
  if (elegidas.length > MAX_ESCENAS) {
    elegidas.sort((a, b) => nubes(a) - nubes(b));
    elegidas.length = MAX_ESCENAS;
  }
  elegidas.sort((a, b) => nubes(b) - nubes(a));

  // Resolución objetivo en metros/píxel de salida (el peor de los dos ejes:
  // conserva calidad en viewports alargados y acota bytes en los cuadrados).
  const latMedia = (south + north) / 2;
  const spanX = (east - west) * 111_320 * Math.cos((latMedia * Math.PI) / 180);
  const spanY = (north - south) * 110_540;
  const objetivoM = Math.max(spanX / width, spanY / height);

  // Grilla de salida: lineal en EPSG:3857 (véase nota 3 del encabezado).
  const radio = 6_378_137;
  const rad = Math.PI / 180;
  const xOeste = radio * west * rad;
  const xEste = radio * east * rad;
  const dx = (xEste - xOeste) / width;
  const norteY = radio * Math.log(Math.tan(Math.PI / 4 + (north * rad) / 2));
  const surY = radio * Math.log(Math.tan(Math.PI / 4 + (south * rad) / 2));
  const dy = (norteY - surY) / height;
  const lonCol = new Float64Array(width);
  for (let c = 0; c < width; c++) {
    lonCol[c] = ((xOeste + (c + 0.5) * dx) / radio) / rad;
  }
  const latFila = new Float64Array(height);
  for (let r = 0; r < height; r++) {
    latFila[r] = latDeY(norteY - (r + 0.5) * dy, radio);
  }

  // Fase 1 — lectura: TODAS las escenas (y sus tres bandas) en paralelo. Cada
  // banda es una cadena de rangos HTTP contra los COG (IFDs de la pirámide +
  // baldosas de la ventana); en serie costaba ~1,6 s por escena y un viewport
  // de 4 cuadrículas pasaba de 10 s. Las ventanas son pequeñas por construcción
  // (el nivel elegido deja ≤ ancho/2 muestras por eje), así que sostener las
  // ocho a la vez son ~30 MB, no cientos.
  interface EscenaLista {
    item: StacItem;
    zona: number;
    red: Banda;
    nir: Banda;
    scl: Banda;
  }
  const lecturas = await Promise.all(
    elegidas.map(async (item): Promise<EscenaLista | null | 'fallo'> => {
      const zona = Number(item.properties['mgrs:utm_zone']);
      try {
        const caja = cajaUtmDeBbox(bbox, zona);
        const [red, nir, scl] = await Promise.all([
          leerBanda(item.assets.red, caja, objetivoM, signal),
          leerBanda(item.assets.nir, caja, objetivoM, signal),
          leerBanda(item.assets.scl, caja, objetivoM, signal),
        ]);
        if (!red || !nir || !scl) return null;
        return { item, zona, red, nir, scl };
      } catch (e) {
        // Un COG ilegible no tira el viewport completo: se pinta lo que haya.
        // Si NINGUNA escena pudo leerse, el fallo de origen sí se propaga.
        if (signal.aborted) throw e;
        console.error('NDVI visual: escena ilegible', item.id, e);
        return 'fallo';
      }
    }),
  );
  const escenas: EscenaLista[] = [];
  let fallos = 0;
  for (const lectura of lecturas) {
    if (lectura === 'fallo') fallos++;
    else if (lectura) escenas.push(lectura);
  }
  if (!escenas.length && fallos) throw new Error('NDVI raster: ninguna escena pudo leerse');
  if (!escenas.length) return { png: Buffer.alloc(0), fecha: null, escenas: 0 };

  // Fase 2 — pintado: CPU puro sobre las ventanas ya en memoria.
  const rgba = Buffer.alloc(width * height * 4);
  let fecha: string | null = null;
  let pintadas = 0;

  for (const { item, zona, red, nir, scl } of escenas) {
    if (signal.aborted) throw new Error('NDVI raster cancelado');
    // Prefiltro geográfico: la caja WGS84 de la escena (STAC `bbox`) descarta
    // filas/columnas enteras sin proyectar nada.
    const bb = item.bbox;
    const [fW, fS, fE, fN] = bb ?? [-180, -90, 180, 90];

    let pintados = 0;
    for (let r = 0; r < height; r++) {
      const lat = latFila[r];
      if (lat < fS || lat > fN) continue;
      for (let c = 0; c < width; c++) {
        const lon = lonCol[c];
        if (lon < fW || lon > fE) continue;
        const [x, y] = lonLatToUtm(lon, lat, zona);

        const fx = (x - red.x0) / red.px - red.c0;
        const fy = (y - red.y0) / red.py - red.r0;
        if (fx < 0 || fy < 0 || fx > red.ancho - 1 || fy > red.alto - 1) continue;
        const gx = (x - nir.x0) / nir.px - nir.c0;
        const gy = (y - nir.y0) / nir.py - nir.r0;
        if (gx < 0 || gy < 0 || gx > nir.ancho - 1 || gy > nir.alto - 1) continue;

        const claseX = (x - scl.x0) / scl.px - scl.c0;
        const claseY = (y - scl.y0) / scl.py - scl.r0;
        const sc = Math.round(claseX);
        const sr = Math.round(claseY);
        if (sc < 0 || sr < 0 || sc >= scl.ancho || sr >= scl.alto) continue;
        if (SCL_INVALIDAS.has(scl.datos[sr * scl.ancho + sc])) continue;

        const rv = interpolarBilineal(red, fx, fy);
        if (rv < 0 || rv < ROJO_DN_MINIMO) continue;
        const nv = interpolarBilineal(nir, gx, gy);
        if (nv < 0) continue;
        const den = nv + rv;
        if (den <= 0) continue;
        const ndvi = (nv - rv) / den;
        if (ndvi < -1 || ndvi > 1) continue;

        const [cr, cg, cb] = ndviRampRgb(ndvi);
        const i = (r * width + c) * 4;
        rgba[i] = cr;
        rgba[i + 1] = cg;
        rgba[i + 2] = cb;
        rgba[i + 3] = 255;
        pintados++;
      }
    }

    if (pintados) {
      pintadas++;
      const f = item.properties.datetime.slice(0, 10);
      if (!fecha || f > fecha) fecha = f;
    }
    if (signal.aborted) throw new Error('NDVI raster cancelado');
  }

  if (!pintadas) return { png: Buffer.alloc(0), fecha: null, escenas: 0 };

  const png = new PNG({ width, height });
  rgba.copy(png.data);
  const buffer: Buffer = PNG.sync.write(png);
  return { png: buffer, fecha, escenas: pintadas };
}
