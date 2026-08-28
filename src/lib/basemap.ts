/**
 * Catálogo de mapas base.
 *
 * El SIG ofrece un selector de mapa base al estilo de Google Maps / QGIS: el
 * usuario elige el lienzo sobre el que se dibujan las capas temáticas. Cada
 * entrada declara su proveedor de tiles, su atribución legal, su zoom nativo
 * y qué filtro CSS (si alguno) se aplica al panel de tiles.
 *
 * ## Por qué OSM crudo es el default
 *
 * Es el fondo que un usuario reconoce sin explicación (nombres de calles,
 * localidades, hitos) y el único cuya licencia ya está acreditada en todo el
 * proyecto. El lienzo neutro sigue disponible como opción explícita: es el
 * fondo correcto para leer el mapa de calor de valor, donde los verdes de
 * parque y azules de agua de OSM compiten con la rampa.
 *
 * ## Proveedores verificados (2026-08-28, `curl` + CORS)
 *
 * | Proveedor | Estado |
 * |---|---|
 * | `tile.openstreetmap.org` | 200, `access-control-allow-origin: *`. **En uso.** |
 * | `{a,b,c}.tile.opentopomap.org` | 200, CORS `*`, PNG. **En uso** (curvas de nivel + sombreado SRTM, útil para predios rurales). |
 * | `server.arcgisonline.com` World_Imagery | 200, CORS `*`, JPEG. **En uso** (ortoimagen). |
 * | `server.arcgisonline.com` World_Boundaries_and_Places | 200, CORS `*`, PNG transparente. **En uso** (etiquetas sobre la ortoimagen). |
 * | CARTO Positron / Dark Matter (`basemaps.cartocdn.com`) | Devuelve 200 pero **estampa «API KEY REQUIRED» sobre cada tile**. Descartado. |
 * | Stadia Maps / Stamen (`tiles.stadiamaps.com`) | **401** sin API key. Descartado. |
 * | `tiles.wmflabs.org/hillshading` | No resuelve (servicio retirado). Descartado. |
 *
 * El lienzo neutro NO se resuelve cambiando de proveedor sino filtrando los
 * tiles de OSM por CSS: no depende de la buena voluntad de un tercero, ya
 * están acreditados, funciona en todos los zooms y nadie puede desactivarlo.
 *
 * El mismo filtro debe aplicarse al exportar a PNG (`lib/map-export.ts`), o el
 * PNG saldría con el OSM crudo a todo color bajo una capa pensada para un
 * fondo neutro.
 */

export type BasemapId = 'osm' | 'neutro' | 'satelital' | 'topografico' | 'ninguno';

/** Clave del filtro CSS aplicado a `.leaflet-tile-pane` (ver globals.css). */
export type BasemapFilterKey = 'none' | 'light' | 'dark';

export type BasemapDef = {
  id: BasemapId;
  /** Nombre corto para el chip y la miniatura. */
  label: string;
  /** Una línea que explica para qué sirve este fondo. */
  hint: string;
  /** URL de tiles. `null` = sin fondo (solo las capas temáticas). */
  url: string | null;
  subdomains?: string;
  /** Capa de referencia (etiquetas/límites) que va ENCIMA del fondo. */
  overlayUrl?: string;
  /** Atribución HTML para el control de Leaflet. */
  attribution: string;
  /** Atribución en texto plano para el cajetín del PNG exportado. */
  attributionText: string;
  /** Último zoom con tiles reales; más allá Leaflet reescala el último nivel
   *  en vez de dejar el mapa en blanco. */
  maxNativeZoom: number;
  /** `'theme'` = se desatura/invierte según `prefers-color-scheme`.
   *  `'none'` = se muestra con sus colores reales. */
  filter: 'theme' | 'none';
  /** Tile de muestra sobre Valparaíso (z12) para la miniatura del selector:
   *  costa + trama urbana + relieve, así las cuatro opciones se distinguen
   *  de un vistazo. */
  thumb: string | null;
};

/** Zoom máximo del mapa. Sobre `maxNativeZoom` de cada fondo, Leaflet
 *  reescala: mejor un tile borroso que un viewport vacío al cambiar de base. */
export const MAP_MAX_ZOOM = 19;

/** Tile de muestra: Valparaíso / Viña del Mar, z12. */
const THUMB_Z = 12;
const THUMB_X = 1233;
const THUMB_Y = 2445;

const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_PLACES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const BASEMAPS: BasemapDef[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    hint: 'Callejero estándar. Nombres de calles y localidades a todo color.',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: OSM_ATTRIBUTION,
    attributionText: '© OpenStreetMap contributors',
    maxNativeZoom: 19,
    filter: 'none',
    thumb: `https://tile.openstreetmap.org/${THUMB_Z}/${THUMB_X}/${THUMB_Y}.png`,
  },
  {
    id: 'neutro',
    label: 'Neutro',
    hint: 'OSM desaturado. El fondo correcto para leer el mapa de calor de valor.',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution: OSM_ATTRIBUTION,
    attributionText: '© OpenStreetMap contributors',
    maxNativeZoom: 19,
    filter: 'theme',
    thumb: `https://tile.openstreetmap.org/${THUMB_Z}/${THUMB_X}/${THUMB_Y}.png`,
  },
  {
    id: 'satelital',
    label: 'Satélite',
    hint: 'Ortoimagen con etiquetas. Para reconocer deslindes, cultivos y construcciones.',
    url: ESRI_IMAGERY,
    overlayUrl: ESRI_PLACES,
    attribution:
      'Imagen: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG',
    attributionText: 'Esri · Maxar · Earthstar Geographics · GIS User Community',
    maxNativeZoom: 19,
    filter: 'none',
    thumb: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${THUMB_Z}/${THUMB_Y}/${THUMB_X}`,
  },
  {
    id: 'topografico',
    label: 'Topográfico',
    hint: 'Curvas de nivel y sombreado SRTM. Útil para pendiente y exposición de un predio.',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    attribution:
      'Datos: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · Cartografía: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    attributionText:
      '© OpenStreetMap contributors, SRTM · Cartografía © OpenTopoMap (CC-BY-SA)',
    maxNativeZoom: 17,
    filter: 'none',
    thumb: `https://a.tile.opentopomap.org/${THUMB_Z}/${THUMB_X}/${THUMB_Y}.png`,
  },
  {
    id: 'ninguno',
    label: 'Sin fondo',
    hint: 'Solo las capas temáticas, sobre lienzo liso. Para exportar láminas limpias.',
    url: null,
    attribution: '',
    attributionText: '',
    maxNativeZoom: MAP_MAX_ZOOM,
    filter: 'none',
    thumb: null,
  },
];

export const DEFAULT_BASEMAP_ID: BasemapId = 'osm';

export function getBasemap(id: BasemapId): BasemapDef {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

/** Type guard para lo que vuelve de `localStorage` (puede ser cualquier cosa). */
export function isBasemapId(value: unknown): value is BasemapId {
  return typeof value === 'string' && BASEMAPS.some((b) => b.id === value);
}

/**
 * Filtros CSS por tema, en sintaxis compartida entre `filter` de CSS y
 * `CanvasRenderingContext2D.filter` (misma gramática), para que el mapa en
 * pantalla y el PNG exportado sean idénticos.
 *
 * - **claro**: casi monocromo y levemente aclarado, para que cualquier color
 *   encima destaque sin competir con los verdes de parque y azules de agua.
 * - **oscuro**: el `invert(1) hue-rotate(180deg)` clásico de los mapas
 *   nocturnos (invierte luminancia conservando el matiz), más desaturación y
 *   una bajada de brillo para que el blanco de OSM no quede gris lechoso.
 * - **none**: el fondo se muestra tal cual lo sirve el proveedor.
 */
export const BASEMAP_FILTER: Record<BasemapFilterKey, string> = {
  none: 'none',
  light: 'grayscale(0.92) brightness(1.06) contrast(0.9)',
  dark: 'invert(1) hue-rotate(180deg) grayscale(0.86) brightness(0.82) contrast(1.08)',
};

/** Resuelve qué filtro toca: solo los fondos `'theme'` siguen al sistema. */
export function basemapFilterKey(id: BasemapId, isDark: boolean): BasemapFilterKey {
  const def = getBasemap(id);
  if (def.filter === 'none') return 'none';
  return isDark ? 'dark' : 'light';
}

/**
 * ¿El lienzo resultante es oscuro? Decide la rampa del mapa de calor: el
 * extremo bajo de plasma (#0d0887) desaparece sobre blanco, y la rampa clara
 * de tasación se pierde sobre una ortoimagen. La ortoimagen cuenta como
 * lienzo oscuro aunque el sistema esté en tema claro.
 */
export function isDarkCanvas(id: BasemapId, isDark: boolean): boolean {
  return id === 'satelital' ? true : isDark;
}

/** El tema del SIG se resuelve por `prefers-color-scheme` (ver globals.css). */
export function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Clave de `localStorage` donde se recuerda la elección del usuario. */
export const BASEMAP_STORAGE_KEY = 'sig.basemap';
