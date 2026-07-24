/**
 * Capa Red de Drenaje de Chile — Dirección General de Aguas (DGA), MOP.
 *
 * Cauces fluviales superficiales con nombre oficial DGA: ríos y esteros
 * (~35.500 polylines a nivel nacional). Dato del Banco Nacional de Aguas
 * (BNA), expuesto por la DGA en su ArcGIS REST oficial
 * (services3.arcgis.com/aSoEm9TBK2shtWjP) — la Mapoteca Digital de la DGA
 * (la página de descargas masivas SHP/KMZ del organismo) está caída en 2026
 * (404, dominio inestable), por lo que la única vía robusta de consumir este
 * dato hoy es el FeatureServer ArcGIS. Generado por
 * scripts/build-red-drenaje.mjs.
 *
 * Atributos clave para el popup y el matching con otras capas:
 *  - NOMBRE: toponimia oficial DGA (en Ríos sin tildes, en Esteros con tildes).
 *  - tipo: derivado del FeatureServer de origen (`rio` | `estero`).
 *  - COD_CUEN / COD_SUBC / COD_SSUBC: códigos BNA. Permiten encadenar con las
 *    capas oficiales de Cuencas/Subcuencas/Subsubcuencas BNA cuando se
 *    integren.
 *  - NOM_REG / REGION_NUM: región administrativa (1–16).
 *
 * Estilo: familia de azules hidrográficos, con jerarquía por tipo: los ríos
 * son la red troncal (línea más oscura y saturada), los esteros tributarios
 * (línea más clara y fina). No colisiona con carmesí = CBR, verdes/azules
 * RNAP, ámbar = PRC, gris pizarra = comunas, violetas = red vial MOP, ni con
 * los tonos pastel del catastro frutícola CIREN.
 */

export interface RedDrenajeProps {
  NOMBRE: string | null; // toponimia oficial DGA
  TIPO: string | null; // categoría original de la fuente (Río / Estero)
  COD_CUEN: string | null; // código de cuenca BNA
  COD_SUBC: string | null; // código de subcuenca BNA
  COD_SSUBC: string | null; // código de subsubcuenca BNA
  NOM_REG: string | null; // nombre de la región administrativa
  REGION_NUM: number | null; // número de región (1–16)
  tipo: 'rio' | 'estero'; // normalizado por el ETL (en minúsculas, sin tildes)
}

export type DrenajeType = 'rio' | 'estero';

/**
 * Paleta hidrográfica: azules saturados típicos de cartografía de drenaje
 * (cian-sky en Tailwind). El río es el colector principal (línea más oscura
 * y gruesa); el estero es tributario (línea más clara y fina).
 */
export const DRENAJE_TYPE_GROUPS: Record<
  DrenajeType,
  { label: string; color: string; weight: number }
> = {
  rio: { label: 'Río', color: '#0369a1', weight: 1.6 },
  estero: { label: 'Estero', color: '#38bdf8', weight: 1 },
};

/** Mapea el TIPO textual de la fuente (con tildes y mayúsculas) al grupo. */
export function drenajeType(props: Pick<RedDrenajeProps, 'tipo' | 'TIPO'> | null | undefined): DrenajeType {
  // El ETL ya normaliza a minúsculas y sin tildes en el campo `tipo`. El
  // fallback al `TIPO` original cubre registros viejos del cache de la ETL.
  const norm = (props?.tipo ?? props?.TIPO ?? '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (norm.startsWith('estero')) return 'estero';
  return 'rio';
}

export const RED_DRENAJE_COLOR = DRENAJE_TYPE_GROUPS.rio.color;

export const RED_DRENAJE_ATTRIBUTION =
  'Fuente: Dirección General de Aguas · Ministerio de Obras Públicas · Red hidrográfica nacional (Banco Nacional de Aguas)';

export const RED_DRENAJE_SOURCE_URL =
  'https://dga.mop.gob.cl/Paginas/default.aspx';
