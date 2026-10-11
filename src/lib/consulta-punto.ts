/**
 * Consulta integrada del punto («¿Qué hay aquí?»): un clic en el mapa abre UN
 * popup con lo que cada capa activa sabe de ese punto, en vez de un popup por
 * capa que se pisan entre sí. Este módulo es la parte pura (sin Leaflet ni
 * `fetch`): el modelo de secciones y la prueba de punto en polígono para las
 * capas estáticas ya cargadas en el navegador. El ciclo de vida vive en
 * `src/components/map/usePointQuery.ts` y el HTML en `map-popups.ts`.
 */

import type { Geometry, Position } from 'geojson';

/** Estado de una sección del popup, que se llena a medida que responde. */
export type ConsultaSeccion =
  | { id: string; titulo: string; estado: 'cargando' }
  /** `html` ya viene escapado: lo produce un constructor de `map-popups.ts`. */
  | { id: string; titulo: string; estado: 'listo'; html: string }
  | { id: string; titulo: string; estado: 'vacio'; mensaje: string }
  | { id: string; titulo: string; estado: 'error'; mensaje: string };

/**
 * Mensaje de una respuesta fallida de un proxy remoto. Un 429 es el límite
 * de consultas del propio SIG: decir «no responde CIREN» sería falso.
 */
export function mensajeFalla(status: number, servicio: string): string {
  if (status === 429) return 'Demasiadas consultas seguidas. Espera unos segundos y vuelve a hacer clic.';
  return `No responde ${servicio}. El resto de la consulta sigue siendo válido.`;
}

/** Ray casting sobre un anillo [lng, lat]. Borde incluido de forma arbitraria. */
function inRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Dentro del exterior y fuera de todos los huecos. */
function inPolygon(lng: number, lat: number, rings: Position[][]): boolean {
  if (!rings.length || !inRing(lng, lat, rings[0])) return false;
  return !rings.slice(1).some((hole) => inRing(lng, lat, hole));
}

/**
 * ¿El punto cae dentro de la geometría? Solo Polygon y MultiPolygon: las
 * líneas y puntos no «contienen» nada (esas capas conservan su propio popup).
 */
export function pointInGeometry(lng: number, lat: number, geometry: Geometry | null | undefined): boolean {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(lng, lat, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((rings) => inPolygon(lng, lat, rings));
  if (geometry.type === 'GeometryCollection') return geometry.geometries.some((g) => pointInGeometry(lng, lat, g));
  return false;
}
