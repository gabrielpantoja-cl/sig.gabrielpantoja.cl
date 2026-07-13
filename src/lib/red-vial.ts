/**
 * Capa Red Caminera de Chile — Dirección de Vialidad, MOP.
 *
 * Tramos de la Red Vial Nacional (~14.100 polylines) con la toponimia oficial
 * de Vialidad (NOMBRE_CAMINO), el ROL del camino, la clasificación funcional,
 * el tipo de carpeta y si el tramo está concesionado. Dato oficial del
 * Ministerio de Obras Públicas servido por rest-sit.mop.gob.cl (el backend
 * del visor www.mapas.mop.cl). Generado por scripts/build-red-vial.mjs.
 *
 * La nomenclatura oficial del MOP difiere con frecuencia de la de Google/OSM;
 * esta capa existe precisamente para consultar el nombre y ROL oficiales de
 * cada camino. Estilo: familia violeta (no colisiona con carmesí = puntos CBR,
 * verdes/azules = RNAP, ámbar = límite urbano, gris pizarra = comunas), con
 * jerarquía visual por clasificación: caminos nacionales más gruesos y
 * oscuros, la red regional progresivamente más fina y clara.
 */

/**
 * Propiedades de cada feature en red-vial.geojson (esquema canónico de la
 * fuente; el ETL renombra los nombres truncados del DBF). REGION y KM_I/KM_F
 * se descartan en el ETL para priorizar peso de geometría.
 */
export interface RedVialProps {
  NOMBRE_CAMINO: string | null; // toponimia oficial de Vialidad
  ROL: string | null; // rol del camino (p. ej. "O-374", "Ruta 5")
  CLASIFICACION: string | null;
  CARPETA: string | null; // tipo de carpeta (Pavimento, Ripio, Tierra…)
  CONCESIONADO: string | null; // "Sí" / "No"
}

/** Grupos de clasificación funcional para simbología y leyenda. */
export type RoadClassGroup = 'nacional' | 'principal' | 'provincial' | 'comunal' | 'acceso' | 'otro';

export const ROAD_CLASS_GROUPS: Record<
  RoadClassGroup,
  { label: string; color: string; weight: number }
> = {
  nacional: { label: 'Camino Nacional', color: '#5b21b6', weight: 2.4 },
  principal: { label: 'Regional Principal', color: '#7c3aed', weight: 1.8 },
  provincial: { label: 'Regional Provincial', color: '#8b5cf6', weight: 1.4 },
  comunal: { label: 'Regional Comunal', color: '#a78bfa', weight: 1.1 },
  acceso: { label: 'Regional de Acceso', color: '#c4b5fd', weight: 1 },
  otro: { label: 'Otros (por enrolar, urbanos…)', color: '#d8cffc', weight: 1 },
};

/** Mapea la CLASIFICACION textual de la fuente a su grupo de simbología. */
export function roadClassGroup(clasificacion: string | null | undefined): RoadClassGroup {
  const c = (clasificacion ?? '').toLowerCase();
  if (c.includes('nacional')) return 'nacional';
  if (c.includes('principal')) return 'principal';
  if (c.includes('provincial')) return 'provincial';
  if (c.includes('comunal')) return 'comunal';
  if (c.includes('acceso')) return 'acceso';
  return 'otro';
}

export const RED_VIAL_COLOR = ROAD_CLASS_GROUPS.nacional.color;

export const RED_VIAL_ATTRIBUTION =
  'Fuente: Dirección de Vialidad · Ministerio de Obras Públicas · Red Vial Nacional (mapas.mop.cl)';

export const RED_VIAL_SOURCE_URL = 'https://www.mop.gob.cl/serviciosmop/red-vial-nacional/';
