/**
 * Capa de Conservadores de Bienes Raíces: una oficina por punto, en su
 * ubicación física real (para que el perito la visite), y al hacer clic la
 * JURISDICCIÓN resaltada = la unión de los polígonos comunales que atiende.
 *
 * Los datos vienen de la tabla `conservadores` de Neon vía
 * `/api/conservadores`; la geometría de la jurisdicción NO viaja en esa
 * respuesta: se arma en el navegador con los polígonos DPA 2023 de
 * `/data/limites-comunales.geojson` (el mismo archivo de la capa «Límites
 * comunales»), haciendo match por `jurisdiccion_cut` ↔ `CUT_COM`. El `id` de
 * la oficina (`cbr-XXXXX`) NO sirve para eso: no siempre es el CUT real.
 *
 * Funciones puras (sin Leaflet): se testean en `conservadores.test.ts`.
 */
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Conservador } from '@/lib/types';

export const CONSERVADORES_URL = '/api/conservadores';
export const COMUNAS_GEOJSON_URL = '/data/limites-comunales.geojson';

/**
 * Acento de la capa. Azul institucional: distinto del carmesí de las
 * transacciones, del violeta de la red vial, del cian del drenaje y del ámbar
 * del límite urbano. El 600 se lee sobre el lienzo claro y sobre el oscuro.
 */
export const CONSERVADORES_COLOR = '#2563eb';

/** Estilo del resaltado de jurisdicción (no interactivo: el clic pasa al mapa). */
export const JURISDICCION_STYLE = {
  color: CONSERVADORES_COLOR,
  weight: 2.6,
  opacity: 0.95,
  fillColor: '#3b82f6',
  fillOpacity: 0.2,
  smoothFactor: 0.5,
} as const;

export const CONSERVADORES_ATTRIBUTION =
  'Oficinas y jurisdicciones: registro propio de Conservadores · límites SUBDERE DPA 2023';

/**
 * Ícono de la oficina: edificio institucional (frontón + columnas) blanco sobre
 * un disco azul con halo blanco. Sin punta de gota, para que nunca se confunda
 * con un pin de transacción.
 */
export const conservadorIconSvg = (color: string = CONSERVADORES_COLOR): string =>
  `<svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg" ` +
  `style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.4))" aria-hidden="true">` +
  `<circle cx="13" cy="13" r="11.5" fill="${color}" stroke="#fff" stroke-width="2"/>` +
  `<path d="M13 6.2 6.6 9.6v1.3h12.8V9.6z" fill="#fff"/>` +
  `<rect x="7.75" y="11.8" width="1.7" height="5.6" fill="#fff"/>` +
  `<rect x="10.68" y="11.8" width="1.7" height="5.6" fill="#fff"/>` +
  `<rect x="13.62" y="11.8" width="1.7" height="5.6" fill="#fff"/>` +
  `<rect x="16.55" y="11.8" width="1.7" height="5.6" fill="#fff"/>` +
  `<rect x="6.6" y="18.2" width="12.8" height="1.6" fill="#fff"/>` +
  `</svg>`;

/** Estado de la capa para la leyenda. */
export type ConservadoresStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'error' };

/** `''`/espacios → null; cualquier no-string → null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((v): v is string => v !== null);
}

const CUT_RE = /^\d{5}$/;

/**
 * Fila de Neon → objeto de la API. Devuelve null si la oficina no está ubicada
 * (lat/lng NULL o no finitos): esas no se dibujan. Los CUT que no tengan cinco
 * dígitos se descartan — un CUT mal formado nunca haría match y solo ensuciaría.
 */
export function normalizeConservadorRow(row: Record<string, unknown>): Conservador | null {
  const id = text(row.id);
  const nombre = text(row.nombre);
  if (row.lat == null || row.lng == null) return null;
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!id || !nombre || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id,
    nombre,
    direccion: text(row.direccion),
    comuna: text(row.comuna),
    region: text(row.region),
    telefono: text(row.telefono),
    email: text(row.email),
    sitioWeb: text(row.sitioWeb),
    jurisdiccion: textArray(row.jurisdiccion),
    jurisdiccion_cut: textArray(row.jurisdiccion_cut).filter((cut) => CUT_RE.test(cut)),
    lat,
    lng,
  };
}

/** Polígonos comunales indexados por `CUT_COM` (una comuna puede venir partida). */
export type ComunasIndex = Map<string, Feature<Geometry, { CUT_COM?: string | null }>[]>;

export function indexComunasByCut(
  geojson: FeatureCollection<Geometry, { CUT_COM?: string | null } | null>,
): ComunasIndex {
  const index: ComunasIndex = new Map();
  for (const feature of geojson.features) {
    const cut = feature.properties?.CUT_COM;
    if (!cut) continue;
    const list = index.get(cut);
    const typed = feature as Feature<Geometry, { CUT_COM?: string | null }>;
    if (list) list.push(typed);
    else index.set(cut, [typed]);
  }
  return index;
}

/**
 * Polígonos de la jurisdicción y los CUT que no se encontraron. Sin CUT (fila
 * sin `jurisdiccion_cut`) → sin features: el clic solo abre el popup.
 */
export function jurisdiccionFeatures(
  index: ComunasIndex,
  cuts: readonly string[],
): { features: Feature<Geometry, { CUT_COM?: string | null }>[]; missing: string[] } {
  const features: Feature<Geometry, { CUT_COM?: string | null }>[] = [];
  const missing: string[] = [];
  for (const cut of new Set(cuts)) {
    const found = index.get(cut);
    if (found) features.push(...found);
    else missing.push(cut);
  }
  return { features, missing };
}

/**
 * Transiciones del resaltado, guiadas por los eventos del popup de cada
 * oficina. Un solo CBR resaltado a la vez: abrir el de B lo reemplaza; cerrar
 * un popup solo limpia si es el del CBR resaltado — Leaflet cierra el popup
 * anterior antes de abrir el nuevo, pero si el orden llegara invertido el
 * cierre tardío de A no debe borrar el resaltado de B.
 */
export function highlightOnOpen(_current: string | null, id: string): string {
  return id;
}

export function highlightOnClose(current: string | null, id: string): string | null {
  return current === id ? null : current;
}

/** Enlace «Cómo llegar» de Google Maps (sin API key, abre la app en móviles). */
export function comoLlegarUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
