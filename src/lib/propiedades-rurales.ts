/** Capa dinámica CIREN de propiedades rurales y ROL predial referencial. */
export interface PropiedadRuralProps {
  rol: string | null;
  comuna: string | null;
  provincia: string | null;
  region: string | null;
  codComuna: string | null;
  codProvincia: string | null;
  codRegion: string | null;
  quality?: 'rol-invalid';
}

export const PROPIEDADES_RURALES_EXPORT_URL = '/api/propiedades-rurales/export';
export const PROPIEDADES_RURALES_IDENTIFY_URL = '/api/propiedades-rurales/identify';
export const PROPIEDADES_RURALES_SERVICE_NAME = 'CIREN · PROPIEDADES_RURALES · ArcGIS MapServer';
export const PROPIEDADES_RURALES_SOURCE_URL = 'https://ide.minagri.gob.cl/';
export const PROPIEDADES_RURALES_ATTRIBUTION = 'Fuente: CIREN · Propiedades rurales · IDE Minagri';
export const PROPIEDADES_RURALES_DISCLAIMER =
  'Polígonos y ROL referenciales; no acreditan dominio, deslindes legales ni vigencia registral.';
export const PROPIEDADES_RURALES_MIN_ZOOM = 11;
export const PROPIEDADES_RURALES_OPACITY = 0.9;
export const PROPIEDADES_RURALES_COLOR = '#dc2626';
export const PROPIEDADES_RURALES_LAYER_IDS = Array.from({ length: 14 }, (_, i) => i);

export type PropiedadesRuralesOperation = 'export' | 'identify';
export type PropiedadesRuralesStatus =
  | { kind: 'idle' }
  | { kind: 'zoom-required'; minZoom: number }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; service: string; operation: PropiedadesRuralesOperation };

export interface PropiedadesRuralesProxyErrorBody {
  error?: { service?: string; operation?: PropiedadesRuralesOperation };
}

export const PROPIEDADES_RURALES_REGIONS = [
  ['Arica y Parinacota', '2018'], ['Tarapacá', '2017'], ['Atacama', '2013'], ['Coquimbo', '2014'],
  ['Valparaíso', '2022'], ['Metropolitana', '2023'], ["O'Higgins", '2013'], ['Maule', '2021'],
  ['Ñuble', '2016'], ['Biobío', '2016'], ['La Araucanía', '2023'], ['Los Ríos', '2018'],
  ['Los Lagos', '2016'], ['Aysén', '2004'],
] as const;
