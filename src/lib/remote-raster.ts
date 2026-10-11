/**
 * Encuadre de las capas remotas que se piden como UNA imagen por vista
 * (suelos, CONAF, humedales, propiedades rurales). Puro: sin Leaflet ni
 * `window`, para testearlo.
 *
 * Problema que resuelve: cada `moveend` pedía una imagen con la caja exacta
 * del mapa, así que un paneo de pocos píxeles era una URL nueva — ni la CDN ni
 * el navegador podían reutilizar nada, y cada capa gastaba una consulta del
 * límite por IP en cada movimiento.
 *
 * Solución: el centro de la petición se ajusta a una grilla de `GRID` píxeles
 * en Web Mercator al zoom actual, y la imagen se pide `GRID` píxeles más
 * grande que el mapa (medio `GRID` de margen por lado). Mientras el centro
 * real no salga de la celda, la imagen ya pedida sigue cubriendo la vista y
 * no se pide nada; y dos usuarios en la misma celda piden la MISMA URL, que
 * la CDN sirve desde caché (5 min) sin tocar la función ni el límite.
 *
 * Por qué no el redondeo de NDVI (caja a 4 decimales, tamaño a múltiplos de
 * 64): NDVI lo pinta nuestro servidor y estira la imagen a la caja pedida.
 * ArcGIS no: si la proporción de la caja no coincide con la del tamaño, AMPLÍA
 * la extensión por su cuenta y la imagen queda corrida. Aquí la caja se deriva
 * de los píxeles en Mercator, así que su proporción en EPSG:3857 es exactamente
 * la del tamaño pedido.
 */

/** Paso de la grilla en píxeles. Más grande = más reutilización, más margen. */
export const RASTER_GRID_PX = 128;

/** Tope de los proxies (`validIntegerTuple(size, 2, 1, 2048)`). */
export const RASTER_MAX_SIZE = 2048;

/** Espera tras el último `moveend` antes de pedir (un arrastre emite varios). */
export const RASTER_DEBOUNCE_MS = 250;

export interface RasterRequest {
  /** oeste, sur, este, norte en grados (EPSG:4326). */
  bbox: [number, number, number, number];
  /** ancho, alto en píxeles. */
  size: [number, number];
  /** Igual para dos vistas que comparten celda: no hace falta pedir de nuevo. */
  key: string;
}

const TILE = 256;
const MAX_LAT = 85.0511287798;

function worldSize(zoom: number): number {
  return TILE * 2 ** zoom;
}

export function project(lat: number, lng: number, zoom: number): [number, number] {
  const size = worldSize(zoom);
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * size;
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * size;
  return [x, y];
}

export function unproject(x: number, y: number, zoom: number): [number, number] {
  const size = worldSize(zoom);
  const lng = (x / size) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;
  return [lat, lng];
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Petición para una vista: centro ajustado a la grilla y margen de media
 * celda por lado. Si con el margen la imagen superaría el tope del proxy
 * (pantallas muy anchas), se pide la vista exacta sin ajuste: se pierde la
 * reutilización, nunca la exactitud.
 */
export function rasterRequest(
  center: { lat: number; lng: number },
  zoom: number,
  viewport: { x: number; y: number },
): RasterRequest {
  const [cx, cy] = project(center.lat, center.lng, zoom);
  const vw = Math.max(1, Math.ceil(viewport.x));
  const vh = Math.max(1, Math.ceil(viewport.y));
  const snap = vw + RASTER_GRID_PX <= RASTER_MAX_SIZE && vh + RASTER_GRID_PX <= RASTER_MAX_SIZE;
  const w = snap ? vw + RASTER_GRID_PX : Math.min(vw, RASTER_MAX_SIZE);
  const h = snap ? vh + RASTER_GRID_PX : Math.min(vh, RASTER_MAX_SIZE);
  const sx = snap ? Math.round(cx / RASTER_GRID_PX) * RASTER_GRID_PX : cx;
  const sy = snap ? Math.round(cy / RASTER_GRID_PX) * RASTER_GRID_PX : cy;
  const [north, west] = unproject(sx - w / 2, sy - h / 2, zoom);
  const [south, east] = unproject(sx + w / 2, sy + h / 2, zoom);
  const z = Math.round(zoom * 100) / 100;
  return {
    bbox: [round6(west), round6(south), round6(east), round6(north)],
    size: [w, h],
    key: snap ? `${z}/${sx}/${sy}/${w}x${h}` : `${z}/${cx.toFixed(1)}/${cy.toFixed(1)}/${w}x${h}`,
  };
}

/**
 * Segundos de `Retry-After`, acotados a 1–120. Sin cabecera legible se asume
 * 10 s: lo suficiente para que el límite por minuto libere cupo.
 */
export function retryAfterSeconds(response: Pick<Response, 'headers'>): number {
  const value = Number(response.headers.get('Retry-After'));
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.min(120, Math.max(1, Math.ceil(value)));
}

/** Estado de una capa remota por vista, que la leyenda muestra. */
export type RemoteRasterStatus =
  | { kind: 'idle' }
  | { kind: 'zoom-required'; minZoom: number }
  | { kind: 'loading' }
  | { kind: 'ready' }
  /** El límite de consultas del propio SIG, no una caída del organismo. */
  | { kind: 'rate-limited'; retryIn: number }
  | { kind: 'error'; service: string; operation: 'export' | 'identify' };
