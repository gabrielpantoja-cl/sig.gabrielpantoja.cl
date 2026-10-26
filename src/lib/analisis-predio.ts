/**
 * Ficha del predio — el primer geoproceso del SIG: el usuario entrega un
 * polígono y `/api/analisis/predio` lo cruza en PostGIS con las capas
 * oficiales del esquema `capas` (cargadas SIN simplificar por
 * `npm run data:load:postgis`) y con las transacciones CBR cercanas.
 *
 * Este módulo es compartido cliente/servidor y puro: el contrato de la
 * respuesta, la validación del polígono que llega del navegador (la misma
 * regla corre en los dos lados, así el usuario se entera antes de mandar) y la
 * aritmética del radio de búsqueda. Con tests.
 *
 * El polígono del usuario NO se guarda: el análisis no tiene estado y el
 * evento de analítica lleva solo el número de vértices, nunca coordenadas.
 */

import { superficieM2, type Punto } from '@/lib/medicion';
import type { RelieveZonal } from '@/lib/zonal';

export const ANALISIS_PREDIO_URL = '/api/analisis/predio';

/** Tope de vértices sumando todos los anillos: un predio dibujado o un KML razonable. */
export const MAX_VERTICES = 5_000;
/** 200.000 ha: más que la estancia más grande de Magallanes; frena consultas de escala regional. */
export const MAX_SUPERFICIE_HA = 200_000;
/** Cuerpo del POST: 5.000 vértices con 7 decimales caben holgados. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Envolvente de Chile continental e insular (incluye Rapa Nui y Juan Fernández). */
export const CHILE_ANALISIS = { oeste: -110, este: -66, sur: -56.6, norte: -17.4 };

export const RADIO_DEFAULT_M = 5_000;
export const RADIO_MIN_M = 500;
export const RADIO_MAX_M = 20_000;
/** Comparables listados uno a uno (los más cercanos); la estadística usa todos. */
export const MAX_COMPARABLES = 100;

export type Posicion = [number, number];
export type PoligonoGeoJson =
  | { type: 'Polygon'; coordinates: Posicion[][] }
  | { type: 'MultiPolygon'; coordinates: Posicion[][][] };

export type ValidacionPoligono =
  | { ok: true; geometry: PoligonoGeoJson; superficieHa: number; vertices: number }
  | { ok: false; error: string };

const esPosicion = (p: unknown): p is Posicion =>
  Array.isArray(p) &&
  p.length >= 2 &&
  typeof p[0] === 'number' &&
  typeof p[1] === 'number' &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]);

/** Anillo con al menos 3 vértices distintos; lo cierra si viene abierto y descarta la Z. */
function normalizarAnillo(raw: unknown): Posicion[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(esPosicion)) return null;
  const ring: Posicion[] = raw.map((p) => [p[0], p[1]]);
  const [a, z] = [ring[0], ring[ring.length - 1]];
  if (a[0] !== z[0] || a[1] !== z[1]) ring.push([a[0], a[1]]);
  return ring.length >= 4 ? ring : null;
}

const aPuntos = (ring: Posicion[]): Punto[] => ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));

/** Área esférica de un polígono con huecos (exterior menos interiores), en m². */
function areaPoligonoM2(rings: Posicion[][]): number {
  const [exterior, ...huecos] = rings;
  const area = superficieM2(aPuntos(exterior)) - huecos.reduce((s, h) => s + superficieM2(aPuntos(h)), 0);
  return Math.max(0, area);
}

/**
 * Valida y normaliza el polígono del usuario: GeoJSON Polygon o MultiPolygon
 * (o un Feature que lo contenga), en WGS84, dentro de Chile, con un tope de
 * vértices y de superficie. La validez topológica (autointersecciones) la
 * resuelve PostGIS con ST_MakeValid; aquí se rechaza lo que no tiene arreglo.
 */
export function validarPoligono(input: unknown): ValidacionPoligono {
  let g = input as { type?: unknown; coordinates?: unknown; geometry?: unknown } | null;
  if (g && typeof g === 'object' && g.type === 'Feature') g = g.geometry as typeof g;
  if (!g || typeof g !== 'object') return { ok: false, error: 'Falta la geometría del predio.' };

  let poligonos: unknown[];
  if (g.type === 'Polygon') poligonos = [g.coordinates];
  else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) poligonos = g.coordinates;
  else return { ok: false, error: 'La geometría debe ser un polígono (Polygon o MultiPolygon).' };
  if (poligonos.length === 0) return { ok: false, error: 'El polígono está vacío.' };

  const normalizados: Posicion[][][] = [];
  let vertices = 0;
  let areaM2 = 0;
  for (const raw of poligonos) {
    if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'El polígono está vacío.' };
    const rings: Posicion[][] = [];
    for (const r of raw) {
      const ring = normalizarAnillo(r);
      if (!ring) return { ok: false, error: 'Cada anillo necesita al menos 3 vértices con coordenadas numéricas.' };
      rings.push(ring);
      vertices += ring.length - 1;
    }
    if (vertices > MAX_VERTICES) {
      return { ok: false, error: `El polígono tiene más de ${MAX_VERTICES.toLocaleString('es-CL')} vértices.` };
    }
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (
          lng < CHILE_ANALISIS.oeste || lng > CHILE_ANALISIS.este ||
          lat < CHILE_ANALISIS.sur || lat > CHILE_ANALISIS.norte
        ) {
          return { ok: false, error: 'El polígono cae fuera de Chile (o sus coordenadas vienen como lat,lng invertidas).' };
        }
      }
    }
    areaM2 += areaPoligonoM2(rings);
    normalizados.push(rings);
  }

  const superficieHa = areaM2 / 10_000;
  if (!(superficieHa > 0)) return { ok: false, error: 'El polígono no encierra superficie.' };
  if (superficieHa > MAX_SUPERFICIE_HA) {
    return {
      ok: false,
      error: `El polígono supera las ${MAX_SUPERFICIE_HA.toLocaleString('es-CL')} ha; la ficha es para predios, no para regiones.`,
    };
  }

  const geometry: PoligonoGeoJson =
    normalizados.length === 1
      ? { type: 'Polygon', coordinates: normalizados[0] }
      : { type: 'MultiPolygon', coordinates: normalizados };
  return { ok: true, geometry, superficieHa, vertices };
}

/** Vértices de la herramienta «Medir» (anillo abierto) → GeoJSON Polygon. */
export function poligonoDesdeVertices(puntos: readonly Punto[]): PoligonoGeoJson {
  const ring: Posicion[] = puntos.map((p) => [p.lng, p.lat]);
  if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Los polígonos de una capa del usuario (KML) → un solo (Multi)Polygon para la
 * ficha. Puntos y líneas se ignoran: un KML de deslinde suele traer también los
 * vértices como Placemark. `null` si no hay ningún polígono.
 */
export function poligonoDeFeatures(fc: {
  features: { geometry: { type: string; coordinates?: unknown; geometries?: unknown } | null }[];
}): PoligonoGeoJson | null {
  const partes: Posicion[][][] = [];
  const agregar = (g: { type: string; coordinates?: unknown; geometries?: unknown } | null) => {
    if (!g) return;
    if (g.type === 'Polygon') partes.push(g.coordinates as Posicion[][]);
    else if (g.type === 'MultiPolygon') partes.push(...(g.coordinates as Posicion[][][]));
    else if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) {
      for (const sub of g.geometries) agregar(sub as typeof g);
    }
  };
  for (const f of fc.features) agregar(f.geometry);
  if (partes.length === 0) return null;
  return partes.length === 1 ? { type: 'Polygon', coordinates: partes[0] } : { type: 'MultiPolygon', coordinates: partes };
}

/** Radio de búsqueda de comparables, en metros, acotado. */
export function parseRadioM(raw: string | null): number {
  if (raw == null || raw === '') return RADIO_DEFAULT_M;
  const n = Number(raw);
  if (!Number.isFinite(n)) return RADIO_DEFAULT_M;
  return Math.min(RADIO_MAX_M, Math.max(RADIO_MIN_M, Math.round(n)));
}

const METROS_POR_GRADO = 111_195;

/**
 * Holgura en grados para el prefiltro `geom && ST_Expand(g, dx, dy)`, que usa
 * el índice GiST de `referenciales.geom` (4326) antes del ST_DWithin exacto en
 * geography. La longitud se estira con la latitud de mayor módulo del
 * polígono (el peor caso), más un 2 % de margen: el prefiltro nunca puede
 * dejar afuera un punto que el filtro exacto aceptaría.
 */
export function holguraGrados(geometry: PoligonoGeoJson, radioM: number): { dLng: number; dLat: number } {
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  let maxAbsLat = 0;
  for (const ring of rings) for (const [, lat] of ring) maxAbsLat = Math.max(maxAbsLat, Math.abs(lat));
  const dLat = (radioM / METROS_POR_GRADO) * 1.02;
  const latBorde = Math.min(89, maxAbsLat + dLat);
  const dLng = (radioM / (METROS_POR_GRADO * Math.cos((latBorde * Math.PI) / 180))) * 1.02;
  return { dLng, dLat };
}

// --- Contrato de la respuesta ------------------------------------------------

/**
 * Cada sección falla por separado, como en «¿Qué hay aquí?»: `sin-capa`
 * significa que la tabla todavía no está cargada en PostGIS (no es un error
 * del usuario ni del organismo), `error` que la consulta falló.
 */
export type Seccion<T> = { estado: 'ok'; datos: T } | { estado: 'sin-capa' } | { estado: 'error' };

export interface ComunaIntersectada {
  cut: string | null;
  comuna: string | null;
  provincia: string | null;
  region: string | null;
  ha: number;
  pct: number;
}

export interface InstrumentoUrbano {
  nombre: string | null;
  comuna: string | null;
  instrumento: string | null;
  publicacionDo: string | null;
  ha: number;
}

export interface LimiteUrbanoPredio {
  ha: number;
  pct: number;
  instrumentos: InstrumentoUrbano[];
}

export interface AreaProtegidaPredio {
  codRnap: string | null;
  nombre: string | null;
  designacion: string | null;
  ha: number;
  pct: number;
}

export interface AreasProtegidasPredio {
  areas: AreaProtegidaPredio[];
  /** La más cercana cuando ninguna toca el predio; null si el predio está dentro de una. */
  masCercana: { nombre: string | null; designacion: string | null; distanciaM: number } | null;
}

export interface ComparablesDestino {
  destino: string | null;
  n: number;
  medianaPpm2: number | null;
  p25Ppm2: number | null;
  p75Ppm2: number | null;
  medianaSuperficie: number | null;
  medianaMonto: number | null;
  medianaMontoUf: number | null;
}

/** Misma porción sin PII que `/api/points`, más la distancia al predio. */
export interface Comparable {
  lat: number;
  lng: number;
  monto: number | null;
  montoUf: number | null;
  anio: number | null;
  comuna: string | null;
  predio: string | null;
  superficie: number | null;
  rol: string | null;
  destino: string | null;
  fechaEscritura: string | null;
  fechaInscripcion: string | null;
  fojas: string | null;
  numero: number | null;
  conservador: string | null;
  distanciaM: number;
}

export interface ComparablesPredio {
  radioM: number;
  /** Agrupado por destino: mezclar destinos en una mediana de $/m² no significa nada. */
  porDestino: ComparablesDestino[];
  puntos: Comparable[];
  total: number;
}

export interface FuenteCapa {
  capa: string;
  fuente: string;
  licencia: string | null;
  descargado: string | null;
  cargado: string | null;
}

export interface FichaPredio {
  superficieHa: number;
  perimetroM: number;
  centroide: { lat: number; lng: number };
  comunas: Seccion<ComunaIntersectada[]>;
  limiteUrbano: Seccion<LimiteUrbanoPredio>;
  areasProtegidas: Seccion<AreasProtegidasPredio>;
  comparables: Seccion<ComparablesPredio>;
  /** Pendiente y cotas desde Copernicus GLO-30; `datos: null` = el predio es mar o más chico que una celda. */
  relieve: Seccion<RelieveZonal | null>;
  fuentes: FuenteCapa[];
}
