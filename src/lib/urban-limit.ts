/**
 * Capa de Límite Urbano — MINVU, Instrumentos de Planificación Territorial.
 *
 * Polígonos de límites urbanos de los Planes Reguladores Comunales (PRC),
 * servicio oficial nacional del MINVU (geoide.minvu.cl). A diferencia de las
 * áreas protegidas no hay categorías: es un solo tipo de límite, con estilo
 * fijo ámbar que contrasta con el verde de los puntos CBR y de las áreas
 * protegidas.
 */

/** Propiedades de cada feature en limite-urbano.geojson (nombres de la fuente). */
export interface UrbanLimitProps {
  REG: string | null; // Región
  COM: string | null; // Comuna
  NOM: string | null; // Nombre del instrumento (PRC)
  INSTRUM: string | null; // Tipo de instrumento
  ADMIN: string | null; // Organismo administrador
  P_DO: string | null; // Fecha de publicación en el Diario Oficial
  N_DO: string | null; // N° de documento publicado en el D.O.
  T_DO: string | null; // Tipo de documento publicado en el D.O.
}

export const URBAN_LIMIT_COLOR = '#c2410c';

export const URBAN_LIMIT_STYLE = {
  color: URBAN_LIMIT_COLOR,
  fillColor: '#f59e0b',
  fillOpacity: 0.08,
  weight: 1.5,
  opacity: 0.9,
  smoothFactor: 0.5,
} as const;

export const URBAN_LIMIT_ATTRIBUTION =
  'Fuente: MINVU · Límites Urbanos (IPT) · geoide.minvu.cl';
