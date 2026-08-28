#!/usr/bin/env node

/**
 * Derechos de aprovechamiento de aguas (DGA) — Catastro Público de Aguas
 *
 * Fuentes exploradas:
 * - SNIA Observatorio Hidrométrico: https://snia.mop.gob.cl/observatorio/
 * - DGA Catastro Público: https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/
 * - Visualizador Hidrométrico Nacional: https://vipnet.mop.gob.cl/
 *
 * Los derechos individuales (expedientes) no tienen endpoint masivo público.
 * Esta capa comienza con GLACIARES (SNIA, WFS) como "contexto hídrico"
 * y puede ampliarse a cuencas + acuíferos si se encuentran endpoints.
 *
 * Esfuerzo: L (bajo) — esta primera entrega es validación de fuente.
 *
 * @see docs/roadmap.md § 2.2
 */

import { promises as fs } from 'fs';

const META_FILE = 'public/data/derechos-agua.meta.json';
const GEOJSON_FILE = 'public/data/derechos-agua.geojson';

/**
 * Investigar y descargar datos de derechos de agua desde DGA/SNIA.
 *
 * Fase 1: Glaciares (SNIA, WFS disponible)
 */
async function buildDerechosAgua() {
  console.log('📊 Investigando fuentes DGA de derechos de agua...\n');

  // Glaciares SNIA — el único WFS confirmadamente público
  // https://snia.mop.gob.cl/observatorio/
  const glaciaresUrl = 'https://ide.snia.cl/geoserver/wfs'; // Hipótesis basada en patrón IDE Chile
  const glaciaresLayer = 'glaciares'; // Layer name a confirmar

  console.log(`🔍 Intentando WFS SNIA Glaciares...`);
  console.log(`   URL: ${glaciaresUrl}`);
  console.log(`   Layer: ${glaciaresLayer}\n`);

  // Este es un stub: la descarga real requiere:
  // 1. Confirmar endpoint WFS correcto
  // 2. Paginar si es necesario
  // 3. Reproject a EPSG:4326
  // 4. Simplify geometries
  // 5. Emitir metadatos

  const meta = {
    fuente: 'SNIA / DGA — Catastro Público de Aguas',
    fecha_levantamiento: 'Por determinar (glaciares)',
    licencia: 'CC-BY o similar (SNIA)',
    url_fuente: 'https://snia.mop.gob.cl/observatorio/',
    observaciones: [
      'Primera entrega: contexto hídrico (glaciares)',
      'Derechos individuales no tienen endpoint masivo — quedan como link-out',
      'Acuíferos, cuencas y estaciones fluviométricas: investigar disponibilidad',
    ],
    features_count: 0, // Placeholder
    boundsWgs84: null,
    estado: 'INVESTIGACIÓN',
  };

  console.log('⚠️  ESTADO: Investigación de fuente\n');
  console.log('Próximos pasos:');
  console.log('  1. Confirmar endpoint WFS correcto de SNIA Glaciares');
  console.log('  2. Evaluar cobertura y actualidad de datos');
  console.log('  3. Adaptar patron de descarga (ver build-red-drenaje.mjs)');
  console.log('  4. Decidir: ¿solo glaciares, o agregar cuencas/acuíferos?\n');

  // Guardar stub de metadatos
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`✅ Metadatos stub en ${META_FILE}`);

  // GeoJSON stub vacío (features: [], para que el mapa no rompa)
  const geojsonStub = {
    type: 'FeatureCollection',
    features: [],
    properties: {
      status: 'INVESTIGACIÓN — endpoint WFS no confirmado aún',
      message: 'Ver build-derechos-agua.mjs y docs/roadmap.md § 2.2',
    },
  };
  await fs.writeFile(GEOJSON_FILE, JSON.stringify(geojsonStub, null, 2));
  console.log(`✅ GeoJSON stub en ${GEOJSON_FILE}\n`);

  console.log('📖 Documentación:\n');
  console.log('  • Roadmap: docs/roadmap.md § 2.2');
  console.log('  • Fuentes: docs/fuentes-gis-chile.md § DGA');
  console.log('  • Referencias: https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/\n');
}

buildDerechosAgua().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
