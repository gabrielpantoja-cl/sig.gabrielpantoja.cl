#!/usr/bin/env node

/**
 * Bioclima (WORLDCLIM 2.1) — Descarga automática de rasters
 *
 * Descarga datos bioclimáticos de WORLDCLIM (1981-2010, 2.5 min ~5 km):
 * - BIO1: Temperatura media anual (°C × 10)
 * - BIO12: Precipitación total anual (mm)
 *
 * Rasters se descargan como ZIP desde S3, se extraen y guardan en .research/worldclim/
 * (excluido de git). Luego se procesan con gdal para recortar a Chile.
 *
 * @see docs/roadmap.md § 5.1
 */

import { promises as fs, createWriteStream } from 'fs';
import { execSync } from 'child_process';
import https from 'https';

const RESEARCH_DIR = '.research/worldclim';
const META_FILE = 'public/data/bioclima.meta.json';

// URLs de WORLDCLIM via CIAT (servidor robusto del Global Biodiversity Information Facility)
// Nota: Las URLs directas cambian frecuentemente; si fallan, visitar:
// https://www.worldclim.org/data/worldclim21.html y descargar manualmente
// Luego colocar en .research/worldclim/ y extraer
const SOURCES = {
  bio1: {
    url: 'http://www.worldclim.org/Version2/tiled/wc2.1_2.5m_bio_1.zip',
    file: 'wc2.1_2.5m_bio_1.tif',
    name: 'Temperatura media anual',
    size: '~10 MB',
  },
  bio12: {
    url: 'http://www.worldclim.org/Version2/tiled/wc2.1_2.5m_bio_12.zip',
    file: 'wc2.1_2.5m_bio_12.tif',
    name: 'Precipitación total anual',
    size: '~10 MB',
  },
};

/**
 * Descargar archivo desde URL via HTTPS.
 */
async function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    console.log(`⬇️  Descargando: ${url.split('/').pop()}`);
    https.get(url, (response) => {
      if (response.statusCode === 200) {
        const file = createWriteStream(destination);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`   ✅ Guardado en ${destination}`);
          resolve();
        });
        file.on('error', reject);
      } else {
        reject(new Error(`HTTP ${response.statusCode}`));
      }
    }).on('error', reject);
  });
}

/**
 * Extraer ZIP con unzip (requiere: unzip disponible en PATH).
 */
async function unzipFile(zipPath, outputDir) {
  try {
    console.log(`📦 Extrayendo ${zipPath}...`);
    execSync(`unzip -o "${zipPath}" -d "${outputDir}"`, { stdio: 'pipe' });
    console.log(`   ✅ Extracción completada`);
  } catch {
    // Si unzip falla, intentar con Node.js (más lento)
    console.log('   (unzip no disponible, usando método alternativo)');
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(outputDir, true);
  }
}

/**
 * Recortar raster a Chile usando gdal_translate.
 * Chile bounding box: -75.7 W, -56 S, -66.4 E, -17 N
 */
async function clipToChile(inputTif, outputTif) {
  console.log(`✂️  Recortando a Chile: ${inputTif} → ${outputTif}`);
  try {
    execSync(
      `gdal_translate -projwin -75.7 -17 -66.4 -56 "${inputTif}" "${outputTif}"`,
      { stdio: 'pipe' },
    );
    console.log(`   ✅ Recorte completado`);
  } catch {
    console.warn(`   ⚠️  gdal_translate no disponible o falló (instala gdal o descarga manual)`);
    console.warn(`      Copiar ${inputTif} a ${outputTif} manualmente si lo necesitas`);
  }
}

async function buildBioclima() {
  console.log('🌍 Construyendo capa bioclimática WORLDCLIM v2.1...\n');

  // Crear directorio de investigación
  try {
    await fs.mkdir(RESEARCH_DIR, { recursive: true });
  } catch {
    // Ya existe
  }

  const meta = {
    fuente: 'WORLDCLIM v2.1 (1981-2010)',
    resolucion: '2.5 minutos (~5 km)',
    fecha_levantamiento: '1981-2010 (climatología)',
    licencia: 'CC-BY-4.0 (WORLDCLIM Project)',
    url_fuente: 'https://www.worldclim.org/data/worldclim21.html',
    variables: {},
    estado: 'DESCARGA_EN_CURSO',
    archivos_descargados: [],
    archivos_procesados: [],
  };

  console.log('📥 Descargando rasters...\n');

  // Descargar BIO1 y BIO12
  for (const [key, source] of Object.entries(SOURCES)) {
    const zipPath = `${RESEARCH_DIR}/${source.file.replace('.tif', '.zip')}`;
    const tifPath = `${RESEARCH_DIR}/${source.file}`;
    const chiletifPath = `${RESEARCH_DIR}/${source.file.replace('.tif', '_chile.tif')}`;

    try {
      // Descargar ZIP
      if (!(await fileExists(zipPath))) {
        await downloadFile(source.url, zipPath);
      }

      // Extraer ZIP
      await unzipFile(zipPath, RESEARCH_DIR);

      // Recortar a Chile
      if (await fileExists(tifPath)) {
        await clipToChile(tifPath, chiletifPath);
        meta.archivos_procesados.push(chiletifPath);
      }

      meta.archivos_descargados.push(zipPath);
      meta.variables[key] = {
        unidad: key === 'bio1' ? '°C × 10' : 'mm',
        descripcion: source.name,
        file: source.file,
        chile_file: `${source.file.replace('.tif', '_chile.tif')}`,
        url: source.url,
      };
    } catch (error) {
      console.error(`❌ Error descargando ${key}: ${error.message}`);
    }
  }

  console.log('\n✅ Descargas completadas');
  console.log(`   Archivos guardados en: ${RESEARCH_DIR}/`);
  console.log(`   Archivos descargados: ${meta.archivos_descargados.length}`);
  console.log(`   Archivos procesados: ${meta.archivos_procesados.length}`);

  meta.estado = 'DESCARGADO';
  meta.boundsWgs84 = {
    north: '-17°',
    south: '-56°',
    east: '-66.4°',
    west: '-75.7°',
    descripcion: 'Cubierta de Chile continental',
  };

  // Guardar metadatos
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`\n✅ Metadatos actualizados en ${META_FILE}`);

  console.log('\n📖 Próximos pasos:');
  console.log('  1. Los rasters descargados están en: .research/worldclim/');
  console.log('  2. Versión recortada a Chile: *_chile.tif');
  console.log('  3. Implementar /api/bioclima/export (renderizar PNG desde raster)');
  console.log('  4. Integrar en LayersControl con selector de variable\n');
}

/**
 * Verificar si archivo existe.
 */
async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

buildBioclima().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
