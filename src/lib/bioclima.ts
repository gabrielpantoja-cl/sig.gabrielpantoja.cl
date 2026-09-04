/**
 * Bioclima — WorldClim 2.1, climatología 1970-2000
 *
 * Raster de variables bioclimáticas: temperatura media anual y precipitación
 * anual. Base para análisis de nichos ecológicos, distribuciones de especies y
 * contexto climático del predio.
 *
 * Datos: https://www.worldclim.org/data/worldclim21.html
 * - BIO1: temperatura media anual (°C, float32 — la v2.1 NO usa la escala
 *   entera ×10 de la v1.4; leer el valor tal cual)
 * - BIO12: precipitación total anual (mm, entero)
 * - Resolución: 2.5 min de arco (≈4,6 km en el ecuador; la celda es más
 *   angosta en longitud a la latitud de Chile)
 *
 * Las 19 variables vienen en un solo ZIP de 658 MB; el ETL extrae solo estas dos.
 *
 * @see docs/roadmap.md § 5.1
 */

/**
 * Cortes de color. Los rangos son los valores REALES del raster —°C para
 * temperatura, mm para precipitación— sin factor de escala.
 *
 * Chile continental abarca del desierto absoluto (Arica, ~0 mm) a la Patagonia
 * occidental (>4000 mm), y de la altiplanicie andina bajo cero a los ~19 °C del
 * norte costero, así que los extremos de ambas rampas se usan de verdad.
 */
export const bioclimaColorPalette = {
  // Temperatura (BIO1): divergente azul → rojo, en °C.
  temperature: {
    ranges: [
      { min: -50, max: 0, color: '#1a237e', label: '< 0 °C (altiplano, hielo)' },
      { min: 0, max: 5, color: '#1565c0', label: '0 a 5 °C' },
      { min: 5, max: 10, color: '#42a5f5', label: '5 a 10 °C' },
      { min: 10, max: 13, color: '#81c784', label: '10 a 13 °C (templado)' },
      { min: 13, max: 16, color: '#fdd835', label: '13 a 16 °C' },
      { min: 16, max: 20, color: '#ff7043', label: '16 a 20 °C (cálido)' },
      { min: 20, max: 60, color: '#c62828', label: '> 20 °C' },
    ],
    label: 'Temperatura media anual',
    unit: '°C',
  },
  // Precipitación (BIO12): divergente azul oscuro → amarillo → rojo
  // Escala: 0 (desierto) → 2000 (templado) → 4000+ (húmedo)
  precipitation: {
    ranges: [
      { min: 0, max: 100, color: '#8b4513', label: '0–100 mm (desierto)' },
      { min: 100, max: 300, color: '#d2691e', label: '100–300 mm (árido)' },
      { min: 300, max: 600, color: '#f5deb3', label: '300–600 mm (semiárido)' },
      { min: 600, max: 1200, color: '#7cb342', label: '600–1200 mm (templado)' },
      { min: 1200, max: 2000, color: '#2e7d32', label: '1200–2000 mm' },
      { min: 2000, max: 3000, color: '#0277bd', label: '2000–3000 mm (húmedo)' },
      { min: 3000, max: 5000, color: '#01579b', label: '> 3000 mm (muy húmedo)' },
    ],
    label: 'Precipitación anual',
    unit: 'mm',
  },
};

export type BioclimaVariable = keyof typeof bioclimaColorPalette;

/** Variable mostrada al encender la capa. */
export const BIOCLIMA_DEFAULT_VARIABLE: BioclimaVariable = 'precipitation';

/** Extensión del raster recortado, en WGS84: Chile continental. */
export const BIOCLIMA_BOUNDS = {
  oeste: -75.7,
  sur: -56.0,
  este: -66.4,
  norte: -17.5,
} as const;

/**
 * Atribución y descargo legal.
 *
 * @see docs/roadmap.md § 5.1
 */
export const bioclimaAttribution = `
WorldClim 2.1 · Fick, S.E. &amp; Hijmans, R.J. (2017) «WorldClim 2: new 1-km spatial
resolution climate surfaces for global land areas», International Journal of
Climatology 37(12): 4302-4315.

Datos: <a href="https://www.worldclim.org/" target="_blank">worldclim.org</a> ·
Licencia: <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank">CC BY 4.0</a>

<strong>Nota:</strong> climatología 1970-2000 a 2.5 min de arco (≈4,6 km). Es una
superficie interpolada desde estaciones meteorológicas, no una medición del predio:
sirve como contexto regional y para análisis de nichos, no como dato de sitio.
`.trim();
