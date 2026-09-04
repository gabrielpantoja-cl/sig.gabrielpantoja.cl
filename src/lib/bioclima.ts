/**
 * Bioclima — WorldClim 2.1, climatología 1970-2000
 *
 * Temperatura media anual (BIO1) y precipitación total anual (BIO12), como
 * contexto climático del predio y base para análisis de nichos ecológicos.
 *
 * A diferencia de suelos CIREN o vegetacional CONAF, esta capa NO consulta un
 * servicio remoto: el ETL recorta el raster global a Chile y lo deja pintado en
 * `public/data/bioclima-*.png`. Recortado son 224 × 924 px —75 KB entre ambas
 * variables—, así que servir una imagen estática es más simple y más rápido que
 * renderizar por viewport, y funciona sin depender de terceros en runtime.
 *
 * Notas de la fuente que importan al leer los valores:
 * - BIO1 viene en °C float32. La escala entera ×10 era de WorldClim 1.4, no de
 *   la 2.1: el valor se lee tal cual.
 * - Las 19 variables se publican en un solo ZIP de 628 MiB; no hay descarga por
 *   variable individual.
 *
 * @see docs/roadmap.md § 5.1
 * @see scripts/build-bioclima.mjs
 */

import RAMP from './bioclima-ramp.json';

export type BioclimaVariable = 'temperature' | 'precipitation';

/**
 * Escala de color, leída del mismo JSON que usa el ETL para pintar el PNG.
 * Compartir el archivo es lo que garantiza que la leyenda describa exactamente
 * los colores del mapa: si se editara una copia aparte, ambas se separarían sin
 * que nada fallara de forma visible.
 */
export const bioclimaRamp = RAMP;

/** Variable mostrada al encender la capa. La precipitación es la que más
 *  discrimina el territorio chileno: recorre cuatro órdenes de magnitud entre
 *  Atacama y la Patagonia occidental. */
export const BIOCLIMA_DEFAULT_VARIABLE: BioclimaVariable = 'precipitation';

/** Manifiesto de procedencia que emite el ETL. Trae los bounds efectivos del
 *  recorte y la ruta de cada PNG; el mapa los lee de ahí en vez de repetirlos,
 *  para que un cambio de recorte no deje la imagen corrida. */
export type BioclimaMeta = {
  periodo: string;
  resolucion: string;
  boundsWgs84: { oeste: number; este: number; norte: number; sur: number };
  variables: Record<
    BioclimaVariable,
    {
      descripcion: string;
      unidad: string;
      archivo: string;
      rango_observado: { min: number; max: number };
    }
  >;
};

export async function fetchBioclimaMeta(): Promise<BioclimaMeta> {
  const res = await fetch('/data/bioclima.meta.json');
  if (!res.ok) {
    throw new Error(`No se pudo leer el manifiesto de bioclima (${res.status}).`);
  }
  return (await res.json()) as BioclimaMeta;
}

export const BIOCLIMA_SOURCE_URL = 'https://www.worldclim.org/data/worldclim21.html';

/**
 * Atribución y descargo. La última frase no es adorno: a 2.5 min de arco esta
 * superficie no puede citarse como dato del predio en un informe de tasación.
 */
export const bioclimaAttribution = `
WorldClim 2.1 · Fick, S.E. y Hijmans, R.J. (2017), «WorldClim 2: new 1-km spatial
resolution climate surfaces for global land areas», International Journal of
Climatology 37(12): 4302-4315. Licencia CC BY 4.0. Climatología 1970-2000 a 2.5
minutos de arco: es una superficie interpolada desde estaciones meteorológicas,
no una medición del predio, y sirve como contexto regional, no como dato de sitio.
`.trim();
