/**
 * Capas KML/KMZ subidas por el usuario.
 *
 * Los archivos se procesan íntegramente en el navegador (fflate para abrir
 * el ZIP de un KMZ, DOMParser + @tmcw/togeojson para el KML): nunca se suben a un servidor ni tocan la base de datos,
 * en línea con la regla de que el cliente no accede a datos más allá de los
 * route handlers. Cada archivo válido se convierte en un FeatureCollection
 * GeoJSON que MapView dibuja como una capa Leaflet más.
 */

import { kml as kmlToGeoJson } from '@tmcw/togeojson';
import { strFromU8, unzipSync } from 'fflate';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

/** Una capa KML cargada por el usuario, lista para dibujarse en el mapa. */
export interface KmlLayer {
  id: string;
  /** Nombre del archivo (sin extensión). Inmutable: viene del File upload. */
  name: string;
  /** Alias editable en el sidebar para ponerle etiqueta peritajística
   *  («Sector de Tasación», «Predio 12», etc.). Si está vacío o no se
   *  ha renombrado, los consumidores caen a `name`. Se inicializa igual al
   *  nombre del archivo en `parseKmlFile`. */
  displayName: string;
  /** Color de la capa: el de la paleta al subirla o el que eligió el
   *  usuario. Siempre `#rrggbb` (se valida al restaurar). En modo
   *  `por-entidad` sigue siendo el color del panel y del cajetín. */
  color: string;
  /** `unico`: toda la capa de `color`. `por-entidad`: cada Placemark con un
   *  color distinto (`kmlFeatureColor`), para diferenciar polígonos. */
  colorMode: KmlColorMode;
  /** Semilla del coloreado por entidad; «Aleatorio» la cambia. */
  colorSeed: number;
  /** Momento de la subida (ms): ordena las capas restauradas. */
  subidaEn: number;
  /** true si vino del almacenamiento del navegador al abrir la página: el
   *  mapa no vuela a ella (respeta el encuadre del enlace). */
  restaurada?: boolean;
  visible: boolean;
  featureCount: number;
  geojson: FeatureCollection<Geometry, KmlFeatureProps>;
}

export type KmlColorMode = 'unico' | 'por-entidad';

/** Helper para consumidores: prioriza el alias editable del perito. */
export const kmlDisplayName = (layer: KmlLayer): string =>
  layer.displayName.trim() || layer.name;

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
/** Tope del KML ya descomprimido dentro de un KMZ: el ZIP comprime ~10×,
 *  así que un KMZ de 15 MB legítimo cabe, y una bomba ZIP no. */
export const KMZ_MAX_UNCOMPRESSED_MB = 150;

/**
 * Extrae el texto del KML principal de un KMZ (un ZIP). Por convención de
 * Google Earth es `doc.kml` en la raíz; si no existe, se toma el primer
 * `.kml` de menor profundidad. Íconos, imágenes y KML secundarios del ZIP
 * se ignoran: la capa se dibuja con los colores del SIG, no con sus estilos.
 * Lanza Error con mensaje en español apto para la UI.
 */
export function extractKmlFromKmz(bytes: Uint8Array, fileName: string): string {
  const maxBytes = KMZ_MAX_UNCOMPRESSED_MB * 1024 * 1024;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      // Solo descomprime los .kml, y nunca uno que declare un tamaño absurdo.
      filter: (f) =>
        f.name.toLowerCase().endsWith('.kml') &&
        !f.name.startsWith('__MACOSX/') &&
        f.originalSize <= maxBytes,
    });
  } catch {
    throw new Error(`«${fileName}»: no es un KMZ válido (el ZIP está dañado).`);
  }

  const names = Object.keys(entries).sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
  const main = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names[0];
  if (!main) {
    throw new Error(`«${fileName}»: el KMZ no contiene ningún archivo .kml.`);
  }
  const data = entries[main];
  // El tamaño declarado en la cabecera ZIP puede mentir; se revisa el real.
  if (data.length > maxBytes) {
    throw new Error(
      `«${fileName}»: el KML descomprimido supera ${KMZ_MAX_UNCOMPRESSED_MB} MB.`,
    );
  }
  return strFromU8(data);
}

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

/** Muestra del panel para el modo por entidad. */
export const KML_MULTI_SWATCH = `conic-gradient(${[...KML_COLORS, KML_COLORS[0]].join(', ')})`;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR.test(value);

/** HSL (h en grados, s y l en %) → `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const lig = l / 100;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Nueva semilla para «Aleatorio» (un tono de partida, 0–359). */
export const randomKmlSeed = (): number => Math.floor(Math.random() * 360);

/**
 * Color de la entidad `index` de la capa. En modo por entidad los tonos
 * avanzan por el ángulo áureo (137,5°): entidades consecutivas —que suelen
 * ser vecinas en el KML— quedan siempre bien separadas en el círculo
 * cromático, sin importar cuántas haya. La luminosidad alterna para que dos
 * tonos parecidos tampoco se confundan sobre la imagen satelital.
 */
export function kmlFeatureColor(
  layer: Pick<KmlLayer, 'color' | 'colorMode' | 'colorSeed'>,
  index: number,
): string {
  if (layer.colorMode !== 'por-entidad') return layer.color;
  const hue = (layer.colorSeed + index * 137.508) % 360;
  return hslToHex(hue, 75, index % 2 === 0 ? 50 : 40);
}

/**
 * Valida una capa leída del almacenamiento del navegador (IndexedDB). Lo
 * guardado pudo escribirlo otra versión del SIG o alterarse a mano: se
 * revisa la forma mínima y se completan los campos nuevos. Devuelve null si
 * no es utilizable.
 */
export function restoreKmlLayer(raw: unknown): KmlLayer | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const geojson = r.geojson as { type?: unknown; features?: unknown } | undefined;
  if (
    typeof r.id !== 'string' ||
    typeof r.name !== 'string' ||
    geojson == null ||
    geojson.type !== 'FeatureCollection' ||
    !Array.isArray(geojson.features) ||
    geojson.features.length === 0
  ) {
    return null;
  }
  const features = (geojson.features as Feature<Geometry | null, KmlFeatureProps>[]).filter(
    (f) => f != null && typeof f === 'object' && hasGeometry(f),
  ) as Feature<Geometry, KmlFeatureProps>[];
  if (features.length === 0) return null;
  return {
    id: r.id,
    name: r.name,
    displayName: typeof r.displayName === 'string' ? r.displayName : r.name,
    color: isHexColor(r.color) ? r.color : KML_COLORS[0],
    colorMode: r.colorMode === 'por-entidad' ? 'por-entidad' : 'unico',
    colorSeed:
      typeof r.colorSeed === 'number' && Number.isFinite(r.colorSeed) ? r.colorSeed % 360 : 0,
    subidaEn: typeof r.subidaEn === 'number' && Number.isFinite(r.subidaEn) ? r.subidaEn : 0,
    restaurada: true,
    visible: r.visible !== false,
    featureCount: features.length,
    geojson: { type: 'FeatureCollection', features },
  };
}

const hasGeometry = (
  f: Feature<Geometry | null, KmlFeatureProps>,
): f is Feature<Geometry, KmlFeatureProps> => f.geometry != null;

/**
 * Convierte un File .kml o .kmz en una KmlLayer o lanza Error con un mensaje
 * en español apto para mostrarse tal cual en la UI.
 */
export async function parseKmlFile(file: File, color: string): Promise<KmlLayer> {
  const lower = file.name.toLowerCase();
  const isKmz = lower.endsWith('.kmz');
  if (!isKmz && !lower.endsWith('.kml')) {
    throw new Error(`«${file.name}»: solo se aceptan archivos .kml o .kmz.`);
  }
  if (file.size > KML_MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`«${file.name}»: supera el máximo de ${KML_MAX_FILE_MB} MB.`);
  }

  const text = isKmz
    ? extractKmlFromKmz(new Uint8Array(await file.arrayBuffer()), file.name)
    : await file.text();
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

  const baseName = file.name.replace(/\.km[lz]$/i, '');
  return {
    id: crypto.randomUUID(),
    name: baseName,
    // El display arranca igual al nombre del archivo; el usuario puede
    // renombrarlo desde el panel y el cambio se propaga al cajetín del
    // export PNG y al popup del feature.
    displayName: baseName,
    color,
    // Con más de una entidad, cada una de un color: así se distinguen los
    // polígonos vecinos apenas se carga el archivo.
    colorMode: features.length > 1 ? 'por-entidad' : 'unico',
    colorSeed: randomKmlSeed(),
    subidaEn: Date.now(),
    visible: true,
    featureCount: features.length,
    geojson: { type: 'FeatureCollection', features },
  };
}
