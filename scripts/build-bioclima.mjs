#!/usr/bin/env node

/**
 * Bioclima (WORLDCLIM 2.1) — Descarga asistida de rasters
 *
 * Investiga disponibilidad de rasters WORLDCLIM y documenta pasos de descarga manual.
 *
 * ⚠️  ESTADO: Las URLs públicas de WORLDCLIM requieren descarga manual o uso de
 * herramientas especializadas (GIS software, osgeo4w, wgetrc con credenciales).
 *
 * Alternativa recomendada:
 * 1. Visitar https://www.worldclim.org/data/worldclim21.html
 * 2. Descargar wc2.1_2.5m_bio_1.zip y wc2.1_2.5m_bio_12.zip
 * 3. Extraer en .research/worldclim/
 * 4. Correr: `npm run data:build:bioclima` para procesar y metadatos
 *
 * @see docs/roadmap.md § 5.1
 */

import { promises as fs } from 'fs';

const RESEARCH_DIR = '.research/worldclim';
const META_FILE = 'public/data/bioclima.meta.json';

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
    variables: {
      bio1: {
        unidad: '°C × 10',
        descripcion: 'Temperatura media anual',
        file: 'wc2.1_2.5m_bio_1.tif',
        url_descarga: 'https://www.worldclim.org/data/worldclim21.html (manual)',
      },
      bio12: {
        unidad: 'mm',
        descripcion: 'Precipitación total anual',
        file: 'wc2.1_2.5m_bio_12.tif',
        url_descarga: 'https://www.worldclim.org/data/worldclim21.html (manual)',
      },
    },
    estado: 'INVESTIGACIÓN',
    archivos_encontrados: [],
    observaciones: [
      'Descarga manual requerida: worldclim.org no expone URLs públicas estables',
      'Usar navegador web para descargar desde https://www.worldclim.org/data/worldclim21.html',
      'Extraer ZIPs en .research/worldclim/',
      'Ejecutar npm run data:build:bioclima nuevamente para procesar',
      'Próximo: integración en LayersControl con /api/bioclima/export',
    ],
  };

  // Buscar archivos ya descargados/extraídos
  try {
    const files = await fs.readdir(RESEARCH_DIR);
    const tifs = files.filter((f) => f.endsWith('.tif'));
    if (tifs.length > 0) {
      console.log(`📁 Archivos encontrados en ${RESEARCH_DIR}:\n`);
      tifs.forEach((f) => console.log(`   ✅ ${f}`));
      meta.estado = 'DESCARGADO';
      meta.archivos_encontrados = tifs;
      console.log();
    }
  } catch {
    // Directorio vacío
  }

  // Guardar metadatos
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`✅ Metadatos en ${META_FILE}`);

  if (meta.estado === 'INVESTIGACIÓN') {
    console.log('\n📖 Pasos para completar descarga:\n');
    console.log('1. Abrir: https://www.worldclim.org/data/worldclim21.html');
    console.log('2. Descargar: wc2.1_2.5m_bio_1.zip (temperatura)');
    console.log('3. Descargar: wc2.1_2.5m_bio_12.zip (precipitación)');
    console.log(`4. Extraer en: ${RESEARCH_DIR}/`);
    console.log('5. Ejecutar: npm run data:build:bioclima\n');
  } else {
    console.log('\n✅ Rasters listos para procesar');
    console.log(`   Próximo paso: integrar en LayersControl\n`);
  }
}

buildBioclima().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
