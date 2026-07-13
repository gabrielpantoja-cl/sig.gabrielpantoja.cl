/**
 * Capa de Límites Comunales — División Político-Administrativa (DPA) 2023.
 *
 * Polígonos de las 346 comunas de Chile, dato oficial de la Subsecretaría de
 * Desarrollo Regional y Administrativo (SUBDERE) publicado en geoportal.cl
 * (Grupo de Trabajo DPA: SUBDERE, IGM, DIFROL, INE; escala 1:50.000,
 * circulación autorizada por Resolución N°50/2019 de DIFROL). Generado por
 * scripts/build-comunas.mjs. Estilo de mapa político clásico: línea gris
 * pizarra discontinua + relleno pastel translúcido distinto por comuna, para
 * que cada unidad se distinga de sus vecinas sin tapar el mapa base.
 */

/** Propiedades de cada feature en limites-comunales.geojson (nombres de la fuente). */
export interface ComunaProps {
  CUT_REG: string | null; // Código Único Territorial de la región
  CUT_PROV: string | null; // CUT de la provincia
  CUT_COM: string | null; // CUT de la comuna (el mismo de la tabla conservadorId)
  REGION: string | null;
  PROVINCIA: string | null;
  COMUNA: string | null;
  SUPERFICIE: number | null; // km² según la fuente
}

export const COMUNAS_COLOR = '#475569';

/**
 * Paleta pastel para el relleno por comuna (tonos suaves, translúcidos, que
 * no compiten con los pines carmesí ni con las demás capas temáticas). Se
 * asigna por módulo del código CUT: los CUT son correlativos dentro de cada
 * provincia, así que las comunas vecinas caen casi siempre en tonos distintos.
 */
export const COMUNAS_FILL_PALETTE = [
  '#fecaca', // rojo pastel
  '#fed7aa', // naranjo pastel
  '#fde68a', // ámbar pastel
  '#d9f99d', // lima pastel
  '#99f6e4', // turquesa pastel
  '#bae6fd', // celeste pastel
  '#ddd6fe', // lavanda pastel
  '#fbcfe8', // rosa pastel
] as const;

export function comunaFillColor(cutCom: string | null | undefined): string {
  const n = Number.parseInt(cutCom ?? '', 10);
  const idx = Number.isNaN(n) ? 0 : n % COMUNAS_FILL_PALETTE.length;
  return COMUNAS_FILL_PALETTE[idx];
}

export const COMUNAS_STYLE = {
  color: COMUNAS_COLOR,
  fillOpacity: 0.35,
  weight: 1.1,
  opacity: 0.8,
  dashArray: '4 3',
  smoothFactor: 0.5,
} as const;

export const COMUNAS_ATTRIBUTION =
  'Fuente: SUBDERE · División Político-Administrativa 2023 · geoportal.cl';

export const COMUNAS_SOURCE_URL =
  'https://geoportal.cl/geoportal/catalog/36391/Divisi%C3%B3n%20Pol%C3%ADtica%20Administrativa%202023';
