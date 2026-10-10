/**
 * Search manifest for the layer sidebar.
 *
 * The catalogue itself is inline JSX in `src/components/LayersControl.tsx` —
 * each row owns its own checkbox, swatch, legend and controls, so there is no
 * data array to filter. This manifest is the INDEX those rows are filtered
 * against: one entry per thematic layer, grouped exactly the way the sidebar
 * renders its category headers, plus the group-level keywords.
 *
 * Two invariants keep it honest:
 *
 * 1. Every entry's `id` is a `CatalogLayerId`, and `LayerRow` REQUIRES a
 *    `layerId` of that type — a typo is a compile error, not a row that
 *    silently disappears from search.
 * 2. Filtering and counting share ONE predicate (`layerMatches`), so the
 *    "No layers found" empty state can never disagree with the visible rows.
 *
 * KNOWN DRIFT: `label` here duplicates the literal passed to `LayerRow` in the
 * JSX. Rename a layer in one place and search goes stale in the other — there
 * is no way to enforce that link without restructuring the catalogue into a
 * data array, which would cost more than it saves. Keep them in sync.
 *
 * Normalisation uses `toLowerCase()` + `normalize('NFD')` + a BMP combining
 * range instead of `\p{Diacritic}`: `tsconfig.json` targets ES2017 and the
 * Unicode property escape is ES2018 syntax, so TS would reject it. NFD is the
 * load-bearing half — without it the precomposed `á`/`í` of "Áreas"/"Líneas"
 * never match the ASCII query a user actually types.
 */

export interface LayerCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export interface LayerCatalogGroup {
  id: string;
  title: string;
  keywords: string;
  /** `readonly` because the catalog below is `as const`-frozen: widening it to
   *  a mutable array would hide accidental writes to the manifest. */
  layers: readonly LayerCatalogEntry[];
}

export const LAYER_CATALOG = [
  {
    id: 'cbr',
    title: 'Transacciones CBR',
    keywords: 'escrituras mercado transaccion compra venta',
    layers: [
      {
        id: 'points',
        label: 'Transacciones CBR',
        description: 'Escrituras del Conservador de Bienes Raíces: predio, rol, monto, destino SII, comuna',
      },
      {
        id: 'hexbins',
        label: 'Mapa de calor de valor ($/m²)',
        description: 'Mediana de valor por celda hexagonal, interpolada; escalonado por destino y cobertura de dato',
      },
    ],
  },
  {
    id: 'static',
    title: 'Capas temáticas estáticas',
    keywords: 'capas estaticas locales geojson referencia catastral',
    layers: [
      {
        id: 'protected',
        label: 'Áreas protegidas (RNAP)',
        description: 'Registro Nacional de Áreas Protegidas: parques, reservas y categorías del MMA',
      },
      {
        id: 'urbanLimit',
        label: 'Límite urbano (PRC)',
        description: 'Límite urbano de los Planes Reguladores Comunales, MINVU',
      },
      {
        id: 'comunas',
        label: 'Límites comunales (DPA)',
        description: 'División político administrativa SUBDERE: comuna, provincia, región, código CUT',
      },
      {
        id: 'redVial',
        label: 'Red caminera (MOP)',
        description: 'Dirección de Vialidad MOP: caminos, rol de vialidad, toponimia oficial',
      },
      {
        id: 'redDrenaje',
        label: 'Red de drenaje (DGA)',
        description: 'Ríos y esteros del Banco Nacional de Aguas: cuenca, subcuenca, jerarquía BNA',
      },
      {
        id: 'lineasTransmision',
        label: 'Líneas de transmisión eléctrica',
        description: 'Ejes de líneas de tensión del Ministerio de Energía / CEN: kilovolts, circuito, estado',
      },
      {
        id: 'catastroFruticola',
        label: 'Catastro frutícola (CIREN)',
        description: 'Productores de fruta por especie, ROL del predio y año del levantamiento CIREN-ODEPA',
      },
    ],
  },
  {
    id: 'remote',
    title: 'Capas dinámicas remotas',
    keywords: 'capas dinamicas remotas servicios arcgis bajo demanda sentinel ndvi vegetacion humedales turberas',
    layers: [
      {
        id: 'suelos',
        label: 'Suelos agrológicos (CIREN)',
        description: 'Clases de aptitud de suelo I a VIII, servidas por CIREN; consulta por punto',
      },
      {
        id: 'vegetacional',
        label: 'Recursos vegetacionales (CONAF)',
        description: 'Usos del suelo y especies vegetacionales, año regional del catastro CONAF',
      },
      {
        id: 'humedales',
        label: 'Humedales (MMA)',
        description: 'Inventario Nacional de Humedales y humedales urbanos declarados (Ley 21.202), con su resolución',
      },
      {
        id: 'propiedadesRurales',
        label: 'Propiedades rurales (CIREN)',
        description: 'Polígonos prediales con ROL y comuna; búsqueda por ROL, 14 regiones',
      },
      {
        id: 'ndviVisual',
        label: 'NDVI Visual (Sentinel-2)',
        description: 'Raster continuo de vigor vegetal por viewport, Sentinel-2 L2A con máscara de nubes SCL; escala divergente',
      },
    ],
  },
  {
    id: 'climate',
    title: 'Bioclima',
    keywords: 'clima bioclimatico worldclim temperatura precipitacion variables',
    layers: [
      {
        id: 'bioclima',
        label: 'Bioclima (WorldClim)',
        description: 'Temperatura media anual y precipitación anual, WorldClim 2.1, climatología 1970-2000',
      },
    ],
  },
] as const;

/** Id of a category rendered by the sidebar. */
export type LayerGroupId = (typeof LAYER_CATALOG)[number]['id'];

/** Id of a searchable thematic layer. */
export type CatalogLayerId = (typeof LAYER_CATALOG)[number]['layers'][number]['id'];

const GROUP_BY_ID = new Map<string, LayerCatalogGroup>(
  (LAYER_CATALOG as readonly LayerCatalogGroup[]).map((group) => [group.id, group]),
);

/**
 * Lowercase, strip combining diacritics, trim. Idempotent, so every helper in
 * this module can normalise its own argument instead of trusting the caller
 * to have done it — there is exactly one way to canonicalise a query.
 */
export function normalizeLayerQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Precomputed haystack per layer: its own label + description plus the parent
// group's title and keywords, so a category-level query ("estaticas",
// "remotas") surfaces every member. Built once at module scope — no work per
// keystroke, and no React purity concerns.
const SEARCH_TEXT = new Map<string, string>();
for (const group of LAYER_CATALOG) {
  const groupText = normalizeLayerQuery(`${group.title} ${group.keywords}`);
  for (const layer of group.layers) {
    SEARCH_TEXT.set(layer.id, normalizeLayerQuery(`${layer.label} ${layer.description}`) + ' ' + groupText);
  }
}

/** True when `id` matches the raw query. Empty query matches everything. */
export function layerMatches(id: CatalogLayerId, rawQuery: string): boolean {
  if (rawQuery === '') return true;
  const haystack = SEARCH_TEXT.get(id);
  if (haystack === undefined) return false;
  return haystack.includes(normalizeLayerQuery(rawQuery));
}

/** True when at least one member of the group matches — drives category headers. */
export function groupMatches(groupId: LayerGroupId, rawQuery: string): boolean {
  if (rawQuery === '') return true;
  const group = GROUP_BY_ID.get(groupId);
  if (!group) return false;
  return group.layers.some((layer) => layerMatches(layer.id as CatalogLayerId, rawQuery));
}

/**
 * How many manifest layers match. Deliberately manifest-only: KML layers are
 * user data that does not belong in a static index, so `LayersControl` adds
 * their filtered count on top (see `matchCount` there).
 */
export function countLayerMatches(rawQuery: string): number {
  if (rawQuery === '') return 0;
  let count = 0;
  for (const group of LAYER_CATALOG) {
    for (const layer of group.layers) {
      if (layerMatches(layer.id, rawQuery)) count += 1;
    }
  }
  return count;
}
