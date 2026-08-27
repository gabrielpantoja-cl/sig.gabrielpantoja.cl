/**
 * Tema del mapa base.
 *
 * El SIG usa los tiles estándar de OpenStreetMap y los NEUTRALIZA con un
 * filtro CSS sobre `.leaflet-tile-pane`, en vez de cambiar de proveedor. El
 * resultado es un lienzo tipo «Positron» (claro) o «Dark Matter» (oscuro):
 * fondo desaturado sobre el que se leen las rampas de color de las capas
 * temáticas, en particular el mapa de calor de valor.
 *
 * ## Por qué no un proveedor de tiles «bonitos»
 *
 * Verificado el 2026-08-27:
 *
 * | Proveedor | Estado |
 * |---|---|
 * | CARTO Positron / Dark Matter (`basemaps.cartocdn.com`) | Devuelve 200 pero **estampa «API KEY REQUIRED» sobre cada tile**. Ya no sirve sin cuenta. |
 * | Stadia Maps / Stamen (`tiles.stadiamaps.com`) | **401** sin API key. Los tiles gratuitos de Stamen migraron a Stadia y exigen cuenta. |
 * | Esri Canvas Light/Dark Gray (`server.arcgisonline.com`) | Sirve sin key, CORS `*`, hasta z23 — pero es el mismo tipo de endpoint legacy sin contrato que acaba de fallarnos con CARTO. |
 *
 * Filtrar OSM no depende de la buena voluntad de un tercero: los tiles ya se
 * usan (y se acreditan) hoy, el filtro es CSS puro, funciona en todos los
 * zooms y nadie puede desactivarlo. El costo es que las etiquetas de OSM
 * siguen ahí, solo que atenuadas — para un SIG de consulta eso es una ventaja.
 *
 * El mismo filtro debe aplicarse al exportar a PNG (`lib/map-export.ts`), o el
 * PNG saldría con el OSM crudo a todo color bajo una capa pensada para un
 * fondo neutro.
 */

export type BasemapTheme = 'light' | 'dark';

export const BASEMAP_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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
 */
export const BASEMAP_FILTER: Record<BasemapTheme, string> = {
  light: 'grayscale(0.92) brightness(1.06) contrast(0.9)',
  dark: 'invert(1) hue-rotate(180deg) grayscale(0.86) brightness(0.82) contrast(1.08)',
};

/** El tema del SIG se resuelve por `prefers-color-scheme` (ver globals.css). */
export function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}
