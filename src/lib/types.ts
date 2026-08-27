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
  /** Fecha de la escritura (firmada en notaría), no la fecha de inscripción
   *  en el CBR. La columna en la DB es `fechaescritura` (todojunto, sin
   *  guion bajo) y se expone como ISO 8601 (YYYY-MM-DD). No es PII: es la
   *  fecha del acto jurídico inscrito, no del comprador/vendedor. */
  fechaEscritura: string | null;
  fojas: string | null; // foja de la inscripción en el CBR
  numero: number | null; // número de la inscripción en el CBR
  conservador: string | null; // nombre del CBR (conservadores.nombre)
}

/**
 * Estadísticas descriptivas de /api/stats. Cada métrica declara su propio
 * denominador: `avg`/`mediana`/`min`/`max` se calculan sobre `count_monto` y
 * los $/m² sobre `count_precio_m2`, ambos ≤ `count`. Ver docs/estadisticas.md.
 */
export interface Stats {
  /** Filas de la selección (todas las que el mapa dibuja). */
  count: number;
  /** Filas con `monto` informado — base de avg / mediana / min / max. */
  count_monto: number;
  /** Filas con `monto` y `superficieTerreno` > 0 — base de los dos $/m². */
  count_precio_m2: number;
  avg: number | null;
  mediana: number | null;
  min: number | null;
  max: number | null;
  /** $/m² del conjunto: sum(monto) / sum(superficie) (razón de totales). */
  precio_m2: number | null;
  /** $/m² típico: mediana de las razones monto/superficie por transacción. */
  precio_m2_mediana: number | null;
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
