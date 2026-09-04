#!/usr/bin/env node

/**
 * Bioclima (WorldClim 2.1) — variables bioclimáticas
 *
 * WorldClim publica las 19 variables bioclimáticas en UN SOLO ZIP por
 * resolución, no un archivo por variable. `wc2.1_2.5m_bio.zip` (628 MiB)
 * contiene `wc2.1_2.5m_bio_1.tif` … `_bio_19.tif`. De esas 19 este SIG usa dos:
 *
 * - BIO1  — temperatura media anual (°C, float32)
 * - BIO12 — precipitación total anual (mm, float32)
 *
 * Climatología 1970-2000. Resolución 2.5 min de arco; el GeoTIFF global es de
 * 8640 × 4320 px en EPSG:4326.
 *
 * ## Por qué este ETL produce un PNG y no un servicio por viewport
 *
 * Recortado a Chile continental el raster mide **223 × 924 px**: entero pesa
 * menos que un ícono. Por eso NO se sigue el patrón de suelos CIREN (un PNG
 * renderizado por viewport contra un servidor remoto), que existe porque aquel
 * dataset pesa 500 MB y vive en un servicio ajeno. Aquí conviene lo contrario:
 * pintar una vez en el ETL y servir una imagen estática que el navegador cachea,
 * sin route handler, sin refresco en `moveend` y sin dependencia de terceros en
 * tiempo de ejecución.
 *
 * El ZIP y los TIF globales quedan en `.research/worldclim/` (gitignored): son
 * 700 MB que no pertenecen al repositorio. Lo que sí se versiona es el PNG
 * recortado y su manifiesto.
 *
 * @see docs/roadmap.md § 5.1
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { fromFile } from 'geotiff';
import { PNG } from 'pngjs';
import RAMP from '../src/lib/bioclima-ramp.json' with { type: 'json' };

const RESEARCH_DIR = '.research/worldclim';
const OUT_DIR = 'public/data';
const META_FILE = `${OUT_DIR}/bioclima.meta.json`;

const ZIP_URL =
  'https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip';
const ZIP_FILE = `${RESEARCH_DIR}/wc2.1_2.5m_bio.zip`;
const ZIP_BYTES = 658405521;

/** Grados por píxel del grid de 2.5 minutos de arco. */
const RES = 1 / 24;

/** Recorte pedido. Se ajusta al píxel más cercano; los bounds efectivos se
 *  recalculan desde los índices para que el overlay no quede corrido. */
const CHILE = { oeste: -75.7, este: -66.4, norte: -17.5, sur: -56.0 };

/** Las dos variables que este SIG usa, de las 19 del paquete. */
const WANTED = {
  temperature: {
    tif: 'wc2.1_2.5m_bio_1.tif',
    png: 'bioclima-temperatura.png',
    unidad: '°C',
    descripcion: 'Temperatura media anual (BIO1)',
  },
  precipitation: {
    tif: 'wc2.1_2.5m_bio_12.tif',
    png: 'bioclima-precipitacion.png',
    unidad: 'mm',
    descripcion: 'Precipitación total anual (BIO12)',
  },
};

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Color del primer tramo cuyo `max` supera el valor; el último (max null) actúa
 *  de tope abierto. */
function colorFor(stops, value) {
  for (const stop of stops) {
    if (stop.max === null || value < stop.max) return stop.rgb;
  }
  return stops[stops.length - 1].rgb;
}

async function descargarYExtraer() {
  await fs.mkdir(RESEARCH_DIR, { recursive: true });

  if (!(await exists(ZIP_FILE))) {
    console.log(`⬇️  Descargando ${ZIP_URL}`);
    console.log(`   (${(ZIP_BYTES / 1024 / 1024).toFixed(0)} MB — las 19 variables vienen juntas)\n`);
    execSync(`curl -L --progress-bar -o "${ZIP_FILE}" "${ZIP_URL}"`, { stdio: 'inherit' });
  }

  const stat = await fs.stat(ZIP_FILE).catch(() => null);
  if (!stat || stat.size < ZIP_BYTES * 0.99) {
    throw new Error(
      `${ZIP_FILE} pesa ${stat ? stat.size : 0} bytes; se esperaban ~${ZIP_BYTES}. ` +
        'Descarga incompleta o respuesta de error: borra el archivo y reintenta.',
    );
  }

  for (const { tif } of Object.values(WANTED)) {
    if (await exists(`${RESEARCH_DIR}/${tif}`)) continue;
    console.log(`📦 Extrayendo ${tif}…`);
    execSync(`unzip -o -j "${ZIP_FILE}" "${tif}" -d "${RESEARCH_DIR}"`, { stdio: 'pipe' });
  }
}

/**
 * Lee la ventana de Chile del GeoTIFF global y la pinta como PNG con la rampa.
 * Devuelve los bounds efectivos y el rango de valores observado.
 */
async function renderVariable(key, spec) {
  const tiff = await fromFile(`${RESEARCH_DIR}/${spec.tif}`);
  const image = await tiff.getImage();

  // Índices de píxel del recorte. El grid global arranca en (-180, 90).
  const x0 = Math.floor((CHILE.oeste + 180) / RES);
  const x1 = Math.ceil((CHILE.este + 180) / RES);
  const y0 = Math.floor((90 - CHILE.norte) / RES);
  const y1 = Math.ceil((90 - CHILE.sur) / RES);
  const width = x1 - x0;
  const height = y1 - y0;

  // Bounds REALES del recorte: derivados de los índices ya redondeados, no de
  // los grados pedidos. Usar los pedidos correría la imagen hasta medio píxel.
  const bounds = {
    oeste: x0 * RES - 180,
    este: x1 * RES - 180,
    norte: 90 - y0 * RES,
    sur: 90 - y1 * RES,
  };

  const [raster] = await image.readRasters({ window: [x0, y0, x1, y1] });

  const stops = RAMP[key].stops.map((s) => ({ ...s, rgb: hexToRgb(s.color) }));
  const png = new PNG({ width, height });

  let min = Infinity;
  let max = -Infinity;
  let conDato = 0;

  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    const o = i * 4;
    // El océano viene como NaN o como un centinela muy negativo según cómo se
    // escribió el TIFF; ambos casos deben quedar transparentes en vez de
    // pintarse con el color del tramo más frío.
    if (Number.isNaN(v) || v < -1e30) {
      png.data[o] = png.data[o + 1] = png.data[o + 2] = png.data[o + 3] = 0;
      continue;
    }
    const [r, g, b] = colorFor(stops, v);
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
    if (v < min) min = v;
    if (v > max) max = v;
    conDato++;
  }

  const buffer = PNG.sync.write(png);
  await fs.writeFile(`${OUT_DIR}/${spec.png}`, buffer);

  return {
    width,
    height,
    bounds,
    bytes: buffer.length,
    cobertura: conDato / raster.length,
    rango: { min, max },
  };
}

async function buildBioclima() {
  console.log('🌍 Bioclima — WorldClim 2.1 (2.5 min, climatología 1970-2000)\n');

  await descargarYExtraer();

  const variables = {};
  let bounds = null;

  for (const [key, spec] of Object.entries(WANTED)) {
    console.log(`🎨 Pintando ${key} (${spec.descripcion})…`);
    const r = await renderVariable(key, spec);
    bounds = r.bounds;
    variables[key] = {
      descripcion: spec.descripcion,
      unidad: spec.unidad,
      archivo: `/data/${spec.png}`,
      bytes: r.bytes,
      rango_observado: {
        min: Number(r.rango.min.toFixed(1)),
        max: Number(r.rango.max.toFixed(1)),
      },
    };
    console.log(
      `   ${r.width}×${r.height} px · ${(r.bytes / 1024).toFixed(0)} KB · ` +
        `tierra ${(r.cobertura * 100).toFixed(0)}% · ` +
        `rango ${r.rango.min.toFixed(1)}–${r.rango.max.toFixed(1)} ${spec.unidad}`,
    );
  }

  const meta = {
    fuente: 'WorldClim 2.1 — variables bioclimáticas',
    cita: 'Fick, S.E. & Hijmans, R.J. (2017). WorldClim 2: new 1-km spatial resolution climate surfaces for global land areas. International Journal of Climatology 37(12): 4302-4315.',
    periodo: '1970-2000 (climatología)',
    resolucion: '2.5 minutos de arco (≈4,6 km en el ecuador)',
    licencia: 'CC BY 4.0',
    url_fuente: 'https://www.worldclim.org/data/worldclim21.html',
    url_descarga: ZIP_URL,
    paquete: {
      archivo: 'wc2.1_2.5m_bio.zip',
      bytes: ZIP_BYTES,
      contiene:
        'Las 19 variables bioclimáticas (bio_1 … bio_19) en un solo ZIP. No existe descarga por variable individual.',
    },
    nota: 'Superficie interpolada desde estaciones meteorológicas, no una medición del predio: es contexto regional, no dato de sitio.',
    recorte: 'Chile continental',
    boundsWgs84: bounds,
    variables,
    generado: new Date().toISOString().slice(0, 10),
  };

  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`\n✅ Manifiesto en ${META_FILE}`);
  console.log(
    `   bounds: ${bounds.oeste.toFixed(4)}, ${bounds.sur.toFixed(4)} → ` +
      `${bounds.este.toFixed(4)}, ${bounds.norte.toFixed(4)}\n`,
  );
}

buildBioclima().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
