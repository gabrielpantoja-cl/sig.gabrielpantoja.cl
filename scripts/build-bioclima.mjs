#!/usr/bin/env node

/**
 * Bioclima (WorldClim 2.1) — variables bioclimáticas
 *
 * WorldClim publica las 19 variables bioclimáticas en UN SOLO ZIP por
 * resolución, no un archivo por variable. `wc2.1_2.5m_bio.zip` (658 MB)
 * contiene `wc2.1_2.5m_bio_1.tif` … `_bio_19.tif`. De esas 19 este SIG usa dos:
 *
 * - BIO1  — temperatura media anual (°C, float32)
 * - BIO12 — precipitación total anual (mm, float32)
 *
 * Climatología 1970-2000 (WorldClim v2.1). La resolución 2.5 min ≈ 4,6 km en
 * el ecuador; en la latitud de Chile continental la celda es más angosta en
 * longitud que en latitud, así que NO es un cuadrado de 4,6 km.
 *
 * El ZIP queda en `.research/worldclim/` (gitignored): son 658 MB que no
 * pertenecen al repositorio. Este script descarga, extrae solo los dos TIF
 * que interesan y emite el manifiesto de procedencia.
 *
 * @see docs/roadmap.md § 5.1
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';

const RESEARCH_DIR = '.research/worldclim';
const META_FILE = 'public/data/bioclima.meta.json';

const ZIP_URL =
  'https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip';
const ZIP_FILE = `${RESEARCH_DIR}/wc2.1_2.5m_bio.zip`;
const ZIP_BYTES = 658405521;

/** Las dos variables que este SIG usa, de las 19 del paquete. */
const WANTED = {
  bio_1: {
    file: 'wc2.1_2.5m_bio_1.tif',
    unidad: '°C',
    descripcion: 'Temperatura media anual',
  },
  bio_12: {
    file: 'wc2.1_2.5m_bio_12.tif',
    unidad: 'mm',
    descripcion: 'Precipitación total anual',
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

async function buildBioclima() {
  console.log('🌍 Bioclima — WorldClim 2.1 (19 variables, 2.5 min)\n');

  await fs.mkdir(RESEARCH_DIR, { recursive: true });

  // 1. Descargar el paquete completo si aún no está.
  if (!(await exists(ZIP_FILE))) {
    console.log(`⬇️  Descargando ${ZIP_URL}`);
    console.log(`   (${(ZIP_BYTES / 1024 / 1024).toFixed(0)} MB — las 19 variables vienen juntas)\n`);
    execSync(`curl -L --progress-bar -o "${ZIP_FILE}" "${ZIP_URL}"`, {
      stdio: 'inherit',
    });
  }

  const stat = await fs.stat(ZIP_FILE).catch(() => null);
  if (!stat || stat.size < ZIP_BYTES * 0.99) {
    console.error(
      `\n❌ ${ZIP_FILE} pesa ${stat ? stat.size : 0} bytes; se esperaban ~${ZIP_BYTES}.`,
    );
    console.error('   Descarga incompleta o respuesta de error. Borra el archivo y reintenta.\n');
    process.exit(1);
  }

  // 2. Extraer SOLO los dos TIF que se usan (el resto son 17 variables que
  //    este SIG no muestra y que ocuparían disco sin motivo).
  console.log('\n📦 Extrayendo BIO1 y BIO12 del paquete…');
  for (const { file } of Object.values(WANTED)) {
    if (await exists(`${RESEARCH_DIR}/${file}`)) {
      console.log(`   ya presente: ${file}`);
      continue;
    }
    execSync(`unzip -o -j "${ZIP_FILE}" "${file}" -d "${RESEARCH_DIR}"`, {
      stdio: 'pipe',
    });
    console.log(`   ✅ ${file}`);
  }

  // 3. Manifiesto de procedencia.
  const variables = {};
  for (const [key, v] of Object.entries(WANTED)) {
    const path = `${RESEARCH_DIR}/${v.file}`;
    const s = await fs.stat(path).catch(() => null);
    variables[key] = {
      ...v,
      presente: Boolean(s),
      bytes: s ? s.size : null,
    };
  }

  const todasPresentes = Object.values(variables).every((v) => v.presente);

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
    variables,
    estado: todasPresentes ? 'RASTER_DESCARGADO' : 'INCOMPLETO',
    pendiente: todasPresentes
      ? [
          'Recortar a Chile continental y reproyectar a Web Mercator para el overlay',
          'Renderizar PNG por viewport en /api/bioclima/export (hoy devuelve un placeholder 1×1)',
          'Montar el L.ImageOverlay en MapView (hoy el toggle del panel no dibuja nada)',
        ]
      : ['Completar la descarga y extracción del paquete WorldClim'],
    boundsWgs84: { oeste: -75.7, sur: -56.0, este: -66.4, norte: -17.5 },
  };

  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`\n✅ Manifiesto en ${META_FILE}`);
  console.log(`   estado: ${meta.estado}`);

  if (todasPresentes) {
    console.log('\n📋 Falta para que la capa se vea en el mapa:');
    meta.pendiente.forEach((p) => console.log(`   • ${p}`));
    console.log();
  }
}

buildBioclima().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
