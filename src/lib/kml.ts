/**
 * Capas KML subidas por el usuario.
 *
 * Los archivos se procesan íntegramente en el navegador (DOMParser +
 * @tmcw/togeojson): nunca se suben a un servidor ni tocan la base de datos,
 * en línea con la regla de que el cliente no accede a datos más allá de los
 * route handlers. Cada archivo válido se convierte en un FeatureCollection
 * GeoJSON que MapView dibuja como una capa Leaflet más.
 */

import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

/** Una capa KML cargada por el usuario, lista para dibujarse en el mapa. */
export interface KmlLayer {
  id: string;
  name: string; // nombre del archivo, sin extensión
  color: string; // color asignado de la paleta, distinto por capa
  visible: boolean;
  featureCount: number;
  geojson: FeatureCollection<Geometry, KmlFeatureProps>;
}

/**
 * Propiedades que togeojson conserva de cada Placemark y que usa el popup.
 * Ojo: cuando la descripción viene como CDATA con HTML, togeojson la entrega
 * como objeto tipado `{ '@type': 'html', value: '…' }`, no como string —
 * usar kmlPropText() para leerlas.
 */
export interface KmlFeatureProps {
  name?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

/** Extrae texto plano de una propiedad KML (string u objeto tipado de togeojson). */
export function kmlPropText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value != null && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string') return inner;
  }
  return '';
}

/** Límites defensivos: un KML de Google Earth rara vez supera estos umbrales. */
export const KML_MAX_FILE_MB = 15;
export const KML_MAX_FEATURES = 5000;

/**
 * Paleta para capas de usuario: tonos que no chocan con el verde de los
 * puntos CBR, el ámbar del límite urbano ni las categorías RNAP.
 */
const KML_COLORS = [
  '#7c3aed', // violeta
  '#0ea5e9', // celeste
  '#db2777', // magenta
  '#b45309', // café
  '#0d9488', // verde azulado
  '#dc2626', // rojo
] as const;

export const kmlColorFor = (index: number): string =>
  KML_COLORS[index % KML_COLORS.length];

const hasGeometry = (
  f: Feature<Geometry | null, KmlFeatureProps>,
): f is Feature<Geometry, KmlFeatureProps> => f.geometry != null;

/**
 * Convierte un File .kml en una KmlLayer o lanza Error con un mensaje en
 * español apto para mostrarse tal cual en la UI.
 */
export async function parseKmlFile(file: File, color: string): Promise<KmlLayer> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.kmz')) {
    throw new Error(
      `«${file.name}»: los KMZ son ZIP comprimidos; descomprímelo y sube el .kml interior.`,
    );
  }
  if (!lower.endsWith('.kml')) {
    throw new Error(`«${file.name}»: solo se aceptan archivos .kml.`);
  }
  if (file.size > KML_MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`«${file.name}»: supera el máximo de ${KML_MAX_FILE_MB} MB.`);
  }

  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'application/xml');
  if (dom.querySelector('parsererror')) {
    throw new Error(`«${file.name}»: no es un XML válido.`);
  }

  const collection = kmlToGeoJson(dom) as FeatureCollection<
    Geometry | null,
    KmlFeatureProps
  >;
  const features = collection.features.filter(hasGeometry);
  if (features.length === 0) {
    throw new Error(`«${file.name}»: no contiene geometrías (Placemarks).`);
  }
  if (features.length > KML_MAX_FEATURES) {
    throw new Error(
      `«${file.name}»: tiene ${features.length.toLocaleString('es-CL')} geometrías; el máximo es ${KML_MAX_FEATURES.toLocaleString('es-CL')}.`,
    );
  }

  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.kml$/i, ''),
    color,
    visible: true,
    featureCount: features.length,
    geojson: { type: 'FeatureCollection', features },
  };
}
