/** Capa dinámica CIREN de propiedades rurales y ROL predial referencial. */
import type { Feature, MultiPolygon, Polygon } from 'geojson';

export interface PropiedadRuralProps {
  rol: string | null;
  comuna: string | null;
  codComuna: string | null;
  codProvincia: string | null;
  codRegion: string | null;
  quality?: 'rol-invalid';
}

export const PROPIEDADES_RURALES_EXPORT_URL = '/api/propiedades-rurales/export';
export const PROPIEDADES_RURALES_IDENTIFY_URL = '/api/propiedades-rurales/identify';
export const PROPIEDADES_RURALES_SEARCH_URL = '/api/propiedades-rurales/search';
export const PROPIEDADES_RURALES_FEATURE_URL = '/api/propiedades-rurales/feature';
export const PROPIEDADES_RURALES_SERVICE_NAME = 'CIREN · PROPIEDADES_RURALES · ArcGIS MapServer';
export const PROPIEDADES_RURALES_SOURCE_URL = 'https://ide.minagri.gob.cl/';
export const PROPIEDADES_RURALES_ATTRIBUTION = 'Fuente: CIREN · Propiedades rurales · IDE Minagri';
export const PROPIEDADES_RURALES_DISCLAIMER =
  'Polígonos y ROL referenciales; no acreditan dominio, deslindes legales ni vigencia registral.';
export const PROPIEDADES_RURALES_MIN_ZOOM = 11;
export const PROPIEDADES_RURALES_OPACITY = 0.9;
export const PROPIEDADES_RURALES_COLOR = '#dc2626';
export const PROPIEDADES_RURALES_LAYER_IDS = Array.from({ length: 14 }, (_, i) => i);

export type PropiedadesRuralesOperation = 'export' | 'identify' | 'search' | 'feature';
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

export const PROPIEDADES_RURALES_SUBLAYERS = PROPIEDADES_RURALES_REGIONS.map(
  ([region, vintage], layerId) => ({
    layerId,
    region,
    vintage,
    objectIdField: layerId === 5 ? 'objectid_1' : 'objectid',
  }),
);

export function normalizePropiedadRuralRol(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s*-\s*/g, '-');
  return /^\d{1,7}-\d{1,6}$/.test(normalized) ? normalized : null;
}

export interface PropiedadRuralSearchMatch {
  id: string;
  layerId: number;
  objectId: number;
  rol: string;
  comuna: string | null;
  codComuna: string | null;
  codProvincia: string | null;
  codRegion: string | null;
  sourceRegion: string;
  vintage: string;
}

export interface PropiedadRuralSearchResponse {
  query: { rol: string; comuna: string | null };
  results: PropiedadRuralSearchMatch[];
  truncated: boolean;
}

export interface PropiedadRuralFeatureProps extends PropiedadRuralSearchMatch {
  disclaimer: string;
}

export interface PropiedadRuralFeatureResponse {
  feature: Feature<Polygon | MultiPolygon, PropiedadRuralFeatureProps>;
  extent: [west: number, south: number, east: number, north: number];
}
