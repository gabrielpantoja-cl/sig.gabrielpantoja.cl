/**
 * Permalink: la URL de la página describe la vista del SIG, de modo que
 * copiarla y abrirla en otro navegador reconstruye lo mismo — encuadre,
 * capas, mapa base y filtros. Ejemplo:
 *
 *   /?v=-39.85067,-73.23874,15&capas=puntos,humedales&fondo=satelital&comuna=Valdivia&anio_min=2022
 *
 * Funciones puras (sin `window`): `usePermalink` las conecta al navegador.
 *
 * Decisiones:
 * - Los nombres de los filtros son los MISMOS de la API (`comuna`,
 *   `anio_min`, `monto_min`…): un enlace del SIG y una consulta a
 *   `/api/points` hablan el mismo idioma.
 * - Los nombres de capa son los de la analítica (`layer_on`), un catálogo
 *   cerrado: un nombre desconocido se ignora, nunca rompe la página.
 * - Todo valor se valida al leer; lo inválido cae al valor por defecto. La
 *   URL es entrada de usuario (puede venir editada a mano o de un tercero).
 * - Lo que define la vista por defecto NO se escribe: el SIG recién abierto
 *   sigue en `/` sin parámetros.
 * - Quedan fuera, a propósito: opacidades, paneles abiertos, la consulta
 *   NDVI y las capas KML del usuario (son archivos locales que nunca salen
 *   del navegador).
 * - La analítica registra solo la ruta y los `utm_*`, nunca esta query, así
 *   que un ROL o un monto puesto en un filtro no llega a la base.
 */

import type { BasemapId } from '@/lib/basemap';

/** Capas que viajan en el enlace. Mismos nombres que `layer_on`. */
export const PERMALINK_LAYERS = [
  'puntos',
  'mapa_calor',
  'areas_protegidas',
  'limite_urbano',
  'comunas',
  'red_vial',
  'red_drenaje',
  'lineas_transmision',
  'suelos',
  'bioclima',
  'catastro_fruticola',
  'vegetacional',
  'humedales',
  'propiedades_rurales',
  'ndvi_visual',
] as const;

export type PermalinkLayer = (typeof PERMALINK_LAYERS)[number];

/** Al abrir el SIG sin parámetros solo están encendidas las transacciones. */
export const DEFAULT_LAYERS: readonly PermalinkLayer[] = ['puntos'];

const BASEMAPS: readonly BasemapId[] = ['osm', 'neutro', 'satelital', 'topografico', 'ninguno'];

export interface PermalinkView {
  lat: number;
  lng: number;
  zoom: number;
}

export interface PermalinkFilters {
  comuna: string;
  anioMin: number | null;
  fechaDesde: string;
  fechaHasta: string;
  montoMin: string;
  montoMax: string;
  supMin: string;
  supMax: string;
  predio: string;
  rol: string;
}

export interface PermalinkState {
  view: PermalinkView | null;
  layers: readonly PermalinkLayer[];
  /** `null` = el enlace no impone fondo; manda la preferencia guardada. */
  basemap: BasemapId | null;
  bioclima: 'temperature' | 'precipitation';
  destino: string;
  minN: number;
  filters: PermalinkFilters;
}

export const DEFAULT_FILTERS: PermalinkFilters = {
  comuna: 'todas',
  anioMin: null,
  fechaDesde: '',
  fechaHasta: '',
  montoMin: '',
  montoMax: '',
  supMin: '',
  supMax: '',
  predio: '',
  rol: '',
};

export interface PermalinkDefaults {
  /** Fondo por defecto del SIG: no se escribe en la URL. */
  basemap: BasemapId;
  bioclima: 'temperature' | 'precipitation';
  destino: string;
  minN: number;
}

/** Rangos admitidos para el encuadre. Generosos: cubren Chile insular y
 *  antártico sin aceptar basura. */
const LAT_RANGE = [-90, 90] as const;
const LNG_RANGE = [-180, 180] as const;
const ZOOM_RANGE = [3, 19] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^\d{1,15}$/;
const DESTINO_RE = /^[A-Z]$/;
const MAX_TEXT = 80;

const BIOCLIMA_URL = { temperature: 'temperatura', precipitation: 'precipitacion' } as const;

function inRange(value: number, [min, max]: readonly [number, number]): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function text(params: URLSearchParams, key: string): string {
  const value = (params.get(key) ?? '').trim();
  return value.length <= MAX_TEXT ? value : '';
}

function pattern(params: URLSearchParams, key: string, re: RegExp): string {
  const value = (params.get(key) ?? '').trim();
  return re.test(value) ? value : '';
}

export function parseView(raw: string | null): PermalinkView | null {
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 3) return null;
  const [lat, lng, zoom] = parts;
  if (!inRange(lat, LAT_RANGE) || !inRange(lng, LNG_RANGE) || !inRange(zoom, ZOOM_RANGE)) return null;
  return { lat, lng, zoom: Math.round(zoom) };
}

/**
 * Lee el estado del SIG desde la query de la URL. Nunca lanza: cada campo
 * inválido cae a su valor por defecto por separado.
 */
export function parsePermalink(search: string, defaults: PermalinkDefaults): PermalinkState {
  const params = new URLSearchParams(search);

  // `capas=` vacío es «todo apagado» (una vista válida); una lista con
  // nombres pero ninguno conocido es un enlace roto y cae al valor por defecto.
  const rawLayers = params.get('capas');
  const named = (rawLayers ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  const known = PERMALINK_LAYERS.filter((layer) => named.includes(layer));
  const layers = rawLayers === null || (named.length > 0 && known.length === 0) ? DEFAULT_LAYERS : known;

  const fondo = params.get('fondo') as BasemapId | null;
  const bioclimaUrl = params.get('bioclima');
  const bioclima = bioclimaUrl === BIOCLIMA_URL.temperature
    ? 'temperature'
    : bioclimaUrl === BIOCLIMA_URL.precipitation
      ? 'precipitation'
      : defaults.bioclima;

  const destino = pattern(params, 'destino', DESTINO_RE) || defaults.destino;
  const minNRaw = Number(params.get('min_n'));
  const minN = Number.isInteger(minNRaw) && minNRaw >= 1 && minNRaw <= 50 ? minNRaw : defaults.minN;

  const anio = Number(params.get('anio_min'));
  const anioMin = params.has('anio_min') && Number.isInteger(anio) && anio >= 1900 && anio <= 2100 ? anio : null;

  return {
    view: parseView(params.get('v')),
    layers,
    basemap: fondo && BASEMAPS.includes(fondo) ? fondo : null,
    bioclima,
    destino,
    minN,
    filters: {
      comuna: text(params, 'comuna') || 'todas',
      anioMin,
      fechaDesde: pattern(params, 'fecha_desde', DATE_RE),
      fechaHasta: pattern(params, 'fecha_hasta', DATE_RE),
      montoMin: pattern(params, 'monto_min', AMOUNT_RE),
      montoMax: pattern(params, 'monto_max', AMOUNT_RE),
      supMin: pattern(params, 'sup_min', AMOUNT_RE),
      supMax: pattern(params, 'sup_max', AMOUNT_RE),
      predio: text(params, 'predio'),
      rol: text(params, 'rol'),
    },
  };
}

/** Decimales del centro según el zoom: ~1 m de resolución a zoom de predio,
 *  sin arrastrar 15 decimales que no significan nada. */
function coordDecimals(zoom: number): number {
  if (zoom >= 15) return 5;
  if (zoom >= 10) return 4;
  return 3;
}

/**
 * Escribe la query de la URL. Omite todo lo que coincide con la vista por
 * defecto, así que el estado inicial produce `''`. El orden de las claves es
 * fijo para que la misma vista dé siempre la misma URL.
 */
export function serializePermalink(state: PermalinkState, defaults: PermalinkDefaults): string {
  const params = new URLSearchParams();

  if (state.view) {
    const d = coordDecimals(state.view.zoom);
    params.set('v', `${state.view.lat.toFixed(d)},${state.view.lng.toFixed(d)},${Math.round(state.view.zoom)}`);
  }

  const layers = PERMALINK_LAYERS.filter((layer) => state.layers.includes(layer));
  const isDefaultLayers =
    layers.length === DEFAULT_LAYERS.length && DEFAULT_LAYERS.every((layer) => layers.includes(layer));
  if (!isDefaultLayers) params.set('capas', layers.join(','));

  if (state.basemap && state.basemap !== defaults.basemap) params.set('fondo', state.basemap);
  if (layers.includes('bioclima') && state.bioclima !== defaults.bioclima) {
    params.set('bioclima', BIOCLIMA_URL[state.bioclima]);
  }
  if (layers.includes('mapa_calor')) {
    if (state.destino !== defaults.destino) params.set('destino', state.destino);
    if (state.minN !== defaults.minN) params.set('min_n', String(state.minN));
  }

  const f = state.filters;
  if (f.comuna && f.comuna !== 'todas') params.set('comuna', f.comuna);
  if (f.anioMin != null) params.set('anio_min', String(f.anioMin));
  if (f.fechaDesde) params.set('fecha_desde', f.fechaDesde);
  if (f.fechaHasta) params.set('fecha_hasta', f.fechaHasta);
  if (f.montoMin) params.set('monto_min', f.montoMin);
  if (f.montoMax) params.set('monto_max', f.montoMax);
  if (f.supMin) params.set('sup_min', f.supMin);
  if (f.supMax) params.set('sup_max', f.supMax);
  if (f.predio.trim()) params.set('predio', f.predio.trim());
  if (f.rol.trim()) params.set('rol', f.rol.trim());

  // `URLSearchParams` codifica las comas como %2C; se dejan legibles porque
  // la coma no tiene significado especial en una query.
  return params.toString().replace(/%2C/g, ',');
}
