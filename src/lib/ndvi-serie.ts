/**
 * Cálculo de la serie mensual de NDVI desde Sentinel-2 L2A (solo servidor).
 *
 * Fuente: catálogo STAC de Element 84 (`sentinel-2-l2a`); los assets son COG
 * en el bucket público `sentinel-cogs` y se leen por HTTP range request con
 * `geotiff`, solo la ventana del área consultada.
 *
 * Cada regla de abajo existe por un fallo medido en el prototipo
 * (`scripts/research/ndvi-serie.mjs`, cifras en `docs/roadmap.md` § 5.2):
 *
 * 1. Reflectancia = DN × 1e-4, siempre. Los COG ya traen restado el offset BOA
 *    aunque `raster:bands` siga declarando `offset: -0.1`; restarlo otra vez
 *    saca el NDVI de rango en vegetación e invierte el signo en agua. Y la
 *    bandera `earthsearch:boa_offset_applied` NO es confiable: viene `false` en
 *    ~4 % de escenas (nov-2024 a mar-2025) que igual tienen el offset aplicado.
 * 2. red/nir/blue son de 10 m y `scl` de 20 m, con transforms distintos: cada
 *    ventana se calcula con el de su propia banda.
 * 3. La máscara SCL no basta en la costa valdiviana: Sen2Cor etiqueta bosque
 *    bajo neblina como agua o suelo. Se descarta además todo píxel con azul
 *    > 0,10, y entre las escenas válidas del mes se queda la de mayor mediana
 *    (compuesto de máximo valor, como MOD13): la neblina que se escapa siempre
 *    baja el NDVI.
 * 4. Un NDVI fuera de [-1, 1] solo sale de una reflectancia mal escalada: se
 *    descarta la escena entera.
 */

import { fromUrl, type GeoTIFFImage } from 'geotiff';
import {
  NDVI_FRACCION_MINIMA,
  NDVI_MESES,
  type NdviGeometria,
  type NdviMes,
  type NdviSerie,
} from '@/lib/ndvi';

const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';

/** 0 nodata · 1 saturado · 3 sombra de nube · 8/9 nube · 10 cirro · 11 nieve. */
const SCL_INVALIDAS = new Set([0, 1, 3, 8, 9, 10, 11]);
const AZUL_NEBLINA = 0.1;

/** Escenas a validar por mes para el compuesto de máximo valor. */
const COMPUESTO = 2;
/** Tope de escenas leídas por mes (válidas o no). */
const LECTURAS_POR_MES = 4;
const MESES_EN_PARALELO = 6;
/** geotiff parte cada baldosa de ~1 MB en bloques de 64 KB por defecto (8
 *  requests por banda); con 256 KB son 2 y el tiempo baja a la mitad. */
const BLOQUE_BYTES = 1 << 18;

interface StacAsset {
  href: string;
  'proj:transform': number[];
  'proj:shape': number[];
}

interface StacItem {
  id: string;
  properties: Record<string, unknown> & { datetime: string };
  assets: Record<string, StacAsset>;
}

// ── Proyección UTM (WGS84, series de Krüger) ────────────────────────────────
export function lonLatToUtm(lon: number, lat: number, zona: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const lam0 = (((zona - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2
    + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

/** Par-impar sobre todos los anillos: respeta huecos de un polígono. */
function dentroDeAnillos(x: number, y: number, anillos: [number, number][][]): boolean {
  let dentro = false;
  for (const anillo of anillos) {
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
      const [xi, yi] = anillo[i];
      const [xj, yj] = anillo[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

function percentil(ordenado: number[], p: number): number | null {
  if (!ordenado.length) return null;
  const i = (ordenado.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (i - lo);
}

const redondear3 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000);

/** Meses completos de la ventana, del más antiguo al más reciente. */
export function ventanaDeMeses(hoy = new Date()): string[] {
  const meses: string[] = [];
  for (let k = NDVI_MESES; k >= 1; k--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - k, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

async function buscarEscenas(
  geo: NdviGeometria,
  desde: string,
  hasta: string,
  signal: AbortSignal,
): Promise<StacItem[]> {
  const intersects = geo.tipo === 'punto'
    ? { type: 'Point', coordinates: [geo.lng, geo.lat] }
    : { type: 'Polygon', coordinates: geo.anillos };
  const base = {
    collections: ['sentinel-2-l2a'],
    intersects,
    datetime: `${desde}T00:00:00Z/${hasta}T23:59:59Z`,
    // Por encima de 90 % de nubes en la cuadrícula no queda área útil en la
    // práctica, y el filtro recorta ~35 % del JSON que hay que paginar.
    query: { 'eo:cloud_cover': { lt: 90 } },
    limit: 100,
  };
  const items: StacItem[] = [];
  let url = STAC_SEARCH;
  let body: Record<string, unknown> = base;
  for (let pagina = 0; pagina < 10; pagina++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Catálogo STAC respondió ${res.status}`);
    const json = (await res.json()) as {
      features: StacItem[];
      links?: { rel: string; href: string; body?: Record<string, unknown> }[];
    };
    items.push(...json.features);
    const next = json.links?.find((l) => l.rel === 'next');
    if (!next) break;
    url = next.href;
    body = { ...base, ...(next.body ?? {}) };
  }
  return items;
}

interface Ventana {
  datos: ArrayLike<number>;
  c0: number;
  f0: number;
  ancho: number;
  alto: number;
  x0: number;
  y0: number;
  px: number;
  py: number;
}

/** Caja UTM del área, en metros, con la que se recorta cada banda. */
interface CajaUtm {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

function ventanaDePixeles(asset: StacAsset, caja: CajaUtm) {
  const [px, , x0, , py, y0] = asset['proj:transform'];
  const [alto, ancho] = asset['proj:shape'];
  const c0 = Math.max(0, Math.floor((caja.xmin - x0) / px));
  const c1 = Math.min(ancho, Math.ceil((caja.xmax - x0) / px));
  const f0 = Math.max(0, Math.floor((caja.ymax - y0) / py));
  const f1 = Math.min(alto, Math.ceil((caja.ymin - y0) / py));
  return { c0, c1, f0, f1, x0, y0, px, py };
}

class LectorCog {
  private imagenes = new Map<string, Promise<GeoTIFFImage>>();

  constructor(private signal: AbortSignal) {}

  private abrir(href: string): Promise<GeoTIFFImage> {
    let img = this.imagenes.get(href);
    if (!img) {
      // `blockSize` lo acepta la fuente remota en runtime, pero la firma pública
      // de `fromUrl` solo tipa las opciones HTTP.
      const opciones = { blockSize: BLOQUE_BYTES } as Parameters<typeof fromUrl>[1];
      img = fromUrl(href, opciones, this.signal).then((t) => t.getImage());
      this.imagenes.set(href, img);
    }
    return img;
  }

  async leer(asset: StacAsset, caja: CajaUtm): Promise<Ventana | null> {
    const w = ventanaDePixeles(asset, caja);
    if (w.c1 <= w.c0 || w.f1 <= w.f0) return null;
    const img = await this.abrir(asset.href);
    const rasters = await img.readRasters({ window: [w.c0, w.f0, w.c1, w.f1], signal: this.signal });
    const datos = (rasters as unknown as ArrayLike<number>[])[0];
    return { datos, c0: w.c0, f0: w.f0, ancho: w.c1 - w.c0, alto: w.f1 - w.f0, x0: w.x0, y0: w.y0, px: w.px, py: w.py };
  }
}

interface ResultadoEscena {
  item: StacItem;
  pixeles: number;
  validos: number;
  fraccion: number;
  valores: number[];
}

async function evaluarEscena(
  item: StacItem,
  geo: NdviGeometria,
  lector: LectorCog,
): Promise<ResultadoEscena | null> {
  const zona = Number(item.properties['mgrs:utm_zone']);
  const red = item.assets.red;
  const nir = item.assets.nir;
  const blue = item.assets.blue;
  const scl = item.assets.scl;
  if (!zona || !red || !nir || !blue || !scl) return null;

  // Geometría en metros de la zona UTM de esta escena.
  let dentro: (x: number, y: number) => boolean;
  let caja: CajaUtm;
  if (geo.tipo === 'punto') {
    const [cx, cy] = lonLatToUtm(geo.lng, geo.lat, zona);
    const r2 = geo.radio * geo.radio;
    dentro = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r2;
    caja = { xmin: cx - geo.radio, xmax: cx + geo.radio, ymin: cy - geo.radio, ymax: cy + geo.radio };
  } else {
    const anillos = geo.anillos.map((a) => a.map(([lng, lat]) => lonLatToUtm(lng, lat, zona)));
    const xs = anillos[0].map((p) => p[0]);
    const ys = anillos[0].map((p) => p[1]);
    caja = { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
    dentro = (x, y) => dentroDeAnillos(x, y, anillos);
  }

  // Posiciones de los píxeles de 10 m del área, sin leer aún ninguna banda.
  const w10 = ventanaDePixeles(red, caja);
  const posiciones: { i: number; x: number; y: number }[] = [];
  const ancho10 = w10.c1 - w10.c0;
  for (let f = w10.f0; f < w10.f1; f++) {
    for (let c = w10.c0; c < w10.c1; c++) {
      const x = w10.x0 + (c + 0.5) * w10.px;
      const y = w10.y0 + (f + 0.5) * w10.py;
      if (dentro(x, y)) posiciones.push({ i: (f - w10.f0) * ancho10 + (c - w10.c0), x, y });
    }
  }
  if (!posiciones.length) return null;

  // SCL primero: pesa una fracción de las bandas y descarta escenas nubladas
  // sin bajar rojo, NIR ni azul.
  const vScl = await lector.leer(scl, caja);
  if (!vScl) return null;
  const claseEn = (x: number, y: number): number => {
    const c = Math.floor((x - vScl.x0) / vScl.px) - vScl.c0;
    const f = Math.floor((y - vScl.y0) / vScl.py) - vScl.f0;
    if (c < 0 || f < 0 || c >= vScl.ancho || f >= vScl.alto) return 0;
    return vScl.datos[f * vScl.ancho + c];
  };
  const candidatos = posiciones.filter((p) => !SCL_INVALIDAS.has(claseEn(p.x, p.y)));
  if (candidatos.length / posiciones.length < NDVI_FRACCION_MINIMA) {
    return { item, pixeles: posiciones.length, validos: candidatos.length, fraccion: candidatos.length / posiciones.length, valores: [] };
  }

  const [vRed, vNir, vBlue] = await Promise.all([lector.leer(red, caja), lector.leer(nir, caja), lector.leer(blue, caja)]);
  if (!vRed || !vNir || !vBlue) return null;

  const valores: number[] = [];
  for (const p of candidatos) {
    const r = vRed.datos[p.i];
    const n = vNir.datos[p.i];
    const b = vBlue.datos[p.i];
    if (!r || !n) continue;
    if (b * 1e-4 > AZUL_NEBLINA) continue;
    const rr = r * 1e-4;
    const nn = n * 1e-4;
    valores.push((nn - rr) / (nn + rr));
  }
  valores.sort((a, b) => a - b);
  if (valores.length && (valores[0] < -1 || valores[valores.length - 1] > 1)) valores.length = 0;
  return { item, pixeles: posiciones.length, validos: valores.length, fraccion: valores.length / posiciones.length, valores };
}

async function conLimite<T>(tareas: (() => Promise<T>)[], limite: number): Promise<T[]> {
  const salida = new Array<T>(tareas.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, tareas.length) }, async () => {
      while (siguiente < tareas.length) {
        const k = siguiente++;
        salida[k] = await tareas[k]();
      }
    }),
  );
  return salida;
}

export async function calcularSerieNdvi(
  geo: NdviGeometria,
  opciones: { signal: AbortSignal; presupuestoMs: number },
): Promise<NdviSerie> {
  const t0 = Date.now();
  const meses = ventanaDeMeses();
  const desde = `${meses[0]}-01`;
  const [ay, am] = meses[meses.length - 1].split('-').map(Number);
  const hasta = new Date(Date.UTC(ay, am, 0)).toISOString().slice(0, 10);

  const items = await buscarEscenas(geo, desde, hasta, opciones.signal);
  const porMes = new Map<string, StacItem[]>();
  for (const it of items) {
    const mes = it.properties.datetime.slice(0, 7);
    const lista = porMes.get(mes) ?? [];
    lista.push(it);
    porMes.set(mes, lista);
  }
  const nubes = (it: StacItem) => Number(it.properties['eo:cloud_cover'] ?? 100);
  for (const lista of porMes.values()) lista.sort((a, b) => nubes(a) - nubes(b));

  const lector = new LectorCog(opciones.signal);
  let escenasLeidas = 0;

  const tareas = meses.map((mes) => async (): Promise<NdviMes> => {
    const candidatas = porMes.get(mes) ?? [];
    const vacio: NdviMes = {
      mes, estado: candidatas.length ? 'hueco' : 'sin-escenas', fecha: null, escena: null,
      nubesEscena: null, pixeles: 0, validos: 0, descartado: null, p25: null, mediana: null, p75: null,
      leidas: 0, disponibles: candidatas.length,
    };
    const aceptadas: ResultadoEscena[] = [];
    let mejorParcial: ResultadoEscena | null = null;
    let leidas = 0;
    for (const item of candidatas.slice(0, LECTURAS_POR_MES)) {
      if (Date.now() - t0 > opciones.presupuestoMs) {
        if (!aceptadas.length) return { ...vacio, estado: 'tiempo', leidas };
        break;
      }
      let r: ResultadoEscena | null = null;
      try {
        r = await evaluarEscena(item, geo, lector);
      } catch (error) {
        if (opciones.signal.aborted) throw error;
      }
      leidas++;
      escenasLeidas++;
      if (!r) continue;
      if (r.fraccion >= NDVI_FRACCION_MINIMA && r.valores.length) {
        aceptadas.push(r);
        if (aceptadas.length >= COMPUESTO) break;
      } else if (!mejorParcial || r.fraccion > mejorParcial.fraccion) {
        mejorParcial = r;
      }
    }

    if (!aceptadas.length) {
      return {
        ...vacio,
        leidas,
        pixeles: mejorParcial?.pixeles ?? 0,
        validos: mejorParcial?.validos ?? 0,
        descartado: mejorParcial ? Math.round((1 - mejorParcial.fraccion) * 100) : null,
      };
    }
    const mediana = (r: ResultadoEscena) => percentil(r.valores, 0.5) ?? -Infinity;
    const e = aceptadas.sort((a, b) => mediana(b) - mediana(a))[0];
    return {
      mes,
      estado: 'ok',
      fecha: e.item.properties.datetime.slice(0, 10),
      escena: e.item.id,
      nubesEscena: Math.round(nubes(e.item)),
      pixeles: e.pixeles,
      validos: e.validos,
      descartado: Math.round((1 - e.fraccion) * 100),
      p25: redondear3(percentil(e.valores, 0.25)),
      mediana: redondear3(percentil(e.valores, 0.5)),
      p75: redondear3(percentil(e.valores, 0.75)),
      leidas,
      disponibles: candidatas.length,
    };
  });

  const resultado = await conLimite(tareas, MESES_EN_PARALELO);
  const anios = [...new Set(resultado.filter((m) => m.fecha).map((m) => Number(m.fecha!.slice(0, 4))))].sort();
  return {
    geometria: geo,
    desde,
    hasta,
    meses: resultado,
    anios,
    resumen: {
      conDato: resultado.filter((m) => m.estado === 'ok').length,
      huecos: resultado.filter((m) => m.estado !== 'ok').length,
      escenasLeidas,
      ms: Date.now() - t0,
    },
  };
}
