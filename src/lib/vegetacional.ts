/** Capa CONAF de recursos vegetacionales y uso de la tierra. */

export interface VegetacionalProps {
  uso: string | null;
  uso_tierra: string | null;
  subuso: string | null;
  estructura: string | null;
  cobertura: string | null;
  tipo_fores: string | null;
  nom_reg: string | null;
  nom_prov: string | null;
  nom_com: string | null;
  codreg: string | null;
  codprov: string | null;
  codcom: string | null;
  superf_ha: number | null;
  vintage?: string;
  regionSlug?: string;
  especi1_ci: string | null;
  especi1_co: string | null;
  especi2_ci: string | null;
  especi2_co: string | null;
  especi3_ci: string | null;
  especi3_co: string | null;
  especi4_ci: string | null;
  especi4_co: string | null;
  especi5_ci: string | null;
  especi5_co: string | null;
  especi6_ci: string | null;
  especi6_co: string | null;
}

export const VEGETACIONAL_ATTRIBUTION =
  'Fuente: CONAF — Catastro de los Recursos Vegetacionales y Uso de la Tierra · IDE Minagri';
export const VEGETACIONAL_SOURCE_URL =
  'https://ide.minagri.gob.cl/descarga-de-capas-shp/planificacion-catastral/';
export const VEGETACIONAL_COLOR = '#15803d';
export const VEGETACIONAL_MIN_ZOOM = 8;
export const VEGETACIONAL_OPACITY = 0.68;
export const VEGETACIONAL_EXPORT_URL = '/api/vegetacional/export';
export const VEGETACIONAL_IDENTIFY_URL = '/api/vegetacional/identify';
export const VEGETACIONAL_SERVICE_NAME =
  'CONAF · USOS_DE_LA_TIERRA__CONAF · ArcGIS MapServer';

export const VEGETACIONAL_USE_COLORS: Record<string, string> = {
  bosques: '#166534',
  matorrales: '#65a30d',
  praderas: '#ca8a04',
  agricultura: '#d97706',
  'áreas urbanas e industriales': '#64748b',
  'cuerpos de agua': '#0284c7',
  'nieves y glaciares': '#7dd3fc',
};

export const VEGETACIONAL_REGIONS = [
  { slug: 'r15', label: 'Arica y Parinacota', vintage: '2015', bbox: [-70.8, -18.6, -68.9, -17.4], layerIds: [0] },
  { slug: 'r01', label: 'Tarapacá', vintage: '2016', bbox: [-71.5, -21.7, -68.4, -18.3], layerIds: [1] },
  { slug: 'r02', label: 'Antofagasta', vintage: '2019', bbox: [-70.8, -26.1, -67.0, -20.9], layerIds: [2] },
  { slug: 'r03', label: 'Atacama', vintage: '2018', bbox: [-71.5, -29.2, -68.0, -25.0], layerIds: [3] },
  { slug: 'r04', label: 'Coquimbo', vintage: '2014', bbox: [-71.8, -32.3, -69.8, -28.0], layerIds: [4] },
  { slug: 'r05', label: 'Valparaíso', vintage: '2019', bbox: [-72.1, -33.1, -70.0, -31.2], layerIds: [5] },
  { slug: 'rm', label: 'Metropolitana', vintage: '2019', bbox: [-71.9, -34.4, -70.8, -32.8], layerIds: [6] },
  { slug: 'r06', label: "O'Higgins", vintage: '2020', bbox: [-72.3, -35.1, -70.4, -33.7], layerIds: [7] },
  { slug: 'r07', label: 'Maule', vintage: '2024', bbox: [-72.8, -36.6, -70.3, -34.7], layerIds: [8] },
  { slug: 'r16', label: 'Ñuble', vintage: '2024', bbox: [-73.0, -37.0, -71.0, -36.0], layerIds: [9] },
  { slug: 'r08', label: 'Biobío', vintage: '2024', bbox: [-73.8, -38.0, -70.7, -36.6], layerIds: [10] },
  { slug: 'r09', label: 'La Araucanía', vintage: '2024', bbox: [-73.4, -39.7, -70.6, -37.2], layerIds: [11] },
  { slug: 'r14', label: 'Los Ríos', vintage: '2024', bbox: [-73.8, -40.7, -71.2, -39.2], layerIds: [12] },
  { slug: 'r10', label: 'Los Lagos', vintage: '2018', bbox: [-74.5, -44.0, -71.0, -40.0], layerIds: [13] },
  { slug: 'r11', label: 'Aysén', vintage: '2020–2022', bbox: [-75.8, -49.0, -71.0, -43.5], layerIds: [14, 15, 16, 17] },
  { slug: 'r12', label: 'Magallanes', vintage: '2017–2019', bbox: [-75.0, -56.2, -66.0, -48.5], layerIds: [18, 19, 20, 21] },
] as const;

export function vegetacionalLayerIds(extent: number[]): number[] {
  const [west, south, east, north] = extent;
  return VEGETACIONAL_REGIONS
    .filter(({ bbox }) => west <= bbox[2] && east >= bbox[0] && south <= bbox[3] && north >= bbox[1])
    .flatMap(({ layerIds }) => [...layerIds]);
}

export function vegetationUseColor(use: string | null | undefined): string {
  const key = (use ?? '').trim().toLocaleLowerCase('es-CL');
  const match = Object.entries(VEGETACIONAL_USE_COLORS).find(([name]) => key.includes(name));
  return match?.[1] ?? VEGETACIONAL_COLOR;
}

export function speciesPairs(props: VegetacionalProps): string[] {
  return [1, 2, 3, 4, 5, 6]
    .map((n) => {
      const scientific = props[`especi${n}_ci` as keyof VegetacionalProps];
      const common = props[`especi${n}_co` as keyof VegetacionalProps];
      if (typeof scientific !== 'string' && typeof common !== 'string') return '';
      return [scientific, common].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).join(' · ');
    })
    .filter(Boolean);
}
