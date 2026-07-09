/**
 * Shared types for the SIG de suelo.
 *
 * A MapPoint is the privacy-safe slice of a CBR land transaction that is allowed
 * to reach the browser. PII (comprador / vendedor / RUT / observaciones) NEVER
 * leaves the server. `rol` IS included on purpose: it is the public SII property
 * identifier (not personal data under Ley 19.628) and peritos search by it.
 */
export interface MapPoint {
  lat: number;
  lng: number;
  monto: number | null;
  anio: number;
  comuna: string;
  predio: string | null;
  superficie: number | null; // superficieTerreno (m²) en Neon
  rol: string | null;
  destino: string | null; // uso SII (Habitacional, Agrícola, etc.)
  fojas: string | null; // foja de la inscripción en el CBR
  numero: number | null; // número de la inscripción en el CBR
  conservador: string | null; // nombre del CBR (conservadores.nombre)
}

export interface Stats {
  count: number;
  avg: number | null;
  mediana: number | null;
  min: number | null;
  max: number | null;
  precio_m2: number | null;
}

/**
 * Resultado del geocodificador (/api/geocode, proxy de Nominatim/OSM). Solo
 * navegación espacial: nombre para mostrar, coordenada y bounding box opcional
 * para encuadrar el mapa. No toca la base CBR.
 */
export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  type: string | null;
  bbox: [number, number, number, number] | null; // [sur, norte, oeste, este]
}

export interface Facets {
  comunas: string[];
  minAnio: number;
  maxAnio: number;
  minMonto: number;
  maxMonto: number;
}
