/**
 * NDVI Visual — capa temática de raster continuo por viewport (Sentinel-2).
 *
 * Constantes, textos de licencia y utilidades de la rampa compartidas entre
 * el proxy del servidor (`/api/ndvi/export` + `ndvi-raster.ts`) y la UI
 * (leyenda en `LayersControl`, cajetín en `map-export.ts`). La escala de color
 * vive en `ndvi-ramp.json` y la leen AMOS lados: el pintador del PNG y el
 * gradiente de la leyenda derivan del mismo JSON, igual que Bioclima con
 * `bioclima-ramp.json`.
 *
 * El descargo es obligatorio en la leyenda: una sola fecha de NDVI no separa
 * bosque nativo de plantación (~70 % de exactitud balanceada en la costa
 * valdiviana).
 */

import RAMP from './ndvi-ramp.json';

/** Ruta same-origin del proxy que renderiza el PNG del viewport. */
export const NDVI_VISUAL_EXPORT_URL = '/api/ndvi/export';

/**
 * Zoom mínimo para pedir el raster. Un viewport amplio obliga a leer varias
 * escenas (cuadrículas MGRS de 110 km) y a rasterizar cientos de km: el caso
 * nacional se rechaza en el servidor por span y aquí no emite peticiones
 * (mismo razonamiento que `SUELOS_MIN_ZOOM`).
 */
export const NDVI_VISUAL_MIN_ZOOM = 10;

/** Opacidad por defecto del raster sobre el mapa base. */
export const NDVI_VISUAL_OPACITY = 0.8;

/** Identificación humana estable del proveedor para mensajes de falla. */
export const NDVI_VISUAL_SERVICE_NAME =
  'Copernicus Sentinel-2 (Element 84 Earth Search / AWS Open Data)';

export const NDVI_VISUAL_SOURCE_URL = 'https://registry.opendata.aws/sentinel-2-l2a-cogs/';

/** Atribución exigida por la licencia Copernicus (panel + PNG exportado). */
export const NDVI_VISUAL_ATTRIBUTION =
  'Contiene datos modificados de Copernicus Sentinel, vía Element 84 Earth Search / AWS Open Data';

/** La leyenda jamás lo omite. */
export const NDVI_VISUAL_DESCARGO =
  'El NDVI mide verdor, no especie ni origen. No usar para identificar bosque nativo; para eso, capa de Recursos vegetacionales (CONAF).';

/**
 * Redondea la coordenada a 4 decimales (~11 m) antes de pedir el raster: es la
 * misma precisión en cliente y servidor, así dos vistas casi iguales reutilizan
 * la respuesta cacheada en la CDN.
 */
export const redondearCoordenada = (v: number): number => Math.round(v * 1e4) / 1e4;

export type NdviVisualEstado =
  | { kind: 'idle' }
  | { kind: 'zoom-required'; minZoom: number }
  | { kind: 'loading' }
  | { kind: 'ready'; fecha: string | null }
  /** Límite de consultas del SIG (no Earth Search): reintenta solo. */
  | { kind: 'rate-limited'; retryIn: number }
  | { kind: 'error' };

// ── Ramp de color ───────────────────────────────────────────────────────────

interface RampStop {
  t: number;
  color: string;
}

const stops: readonly RampStop[] = RAMP.stops;
export const NDVI_VISUAL_DOMINIO: { min: number; max: number } = RAMP.dominio;

/** Paradas crudas, para el swatch de la fila y el cajetín del PNG. */
export const NDVI_VISUAL_STOPS = stops;

function hexARgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

const RGB_CACHE = new Map<string, [number, number, number]>();
function rgbDe(hex: string): [number, number, number] {
  let rgb = RGB_CACHE.get(hex);
  if (!rgb) {
    rgb = hexARgb(hex);
    RGB_CACHE.set(hex, rgb);
  }
  return rgb;
}

/**
 * Color RGB continuo para un valor NDVI: interpola linealmente entre paradas
 * y recorta al rango del dominio. La misma funcion decide el color de cada
 * pixel del PNG en el servidor; la leyenda solo dibuja el gradiente formado
 * por las mismas paradas, así ambos coinciden por construccion.
 */
export function ndviRampRgb(ndvi: number): [number, number, number] {
  const { min, max } = NDVI_VISUAL_DOMINIO;
  const t = Math.min(1, Math.max(0, (ndvi - min) / (max - min)));
  let i = 1;
  while (i < stops.length - 1 && stops[i].t < t) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const span = b.t - a.t;
  const f = span <= 0 ? 0 : (t - a.t) / span;
  const ra = rgbDe(a.color);
  const rb = rgbDe(b.color);
  return [
    Math.round(ra[0] + (rb[0] - ra[0]) * f),
    Math.round(ra[1] + (rb[1] - ra[1]) * f),
    Math.round(ra[2] + (rb[2] - ra[2]) * f),
  ];
}

/** Gradiente CSS horizontal exacto de la rampa (leyenda y swatch). */
export function ndviRampCssGradient(): string {
  const parts = stops.map((s) => `${s.color} ${(s.t * 100).toFixed(0)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function formatoNdvi(v: number): string {
  return v.toFixed(1).replace('.', ',');
}

/** Etiquetas de la escala: valores redondos de un decimal dentro del dominio
 *  (-0,1 / 0,1 / 0,4 / 0,7 / 0,9), no fracciones que obliguen a dos decimales. */
export function ndviRampTicks(): { t: number; label: string }[] {
  const { min, max } = NDVI_VISUAL_DOMINIO;
  return [-0.1, 0.1, 0.4, 0.7, 0.9].map((v) => ({
    t: (v - min) / (max - min),
    label: formatoNdvi(v),
  }));
}
