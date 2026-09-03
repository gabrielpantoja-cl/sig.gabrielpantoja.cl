#!/usr/bin/env node

/**
 * Bioclima (WORLDCLIM 2.1)
 *
 * Descarga datos bioclimáticos de WORLDCLIM (1981-2010, 2.5 min resolución ~5 km)
 * para toda Chile. Genera rasters de:
 * - Precipitación anual (BIO12, mm)
 * - Temperatura media anual (BIO1, °C × 10)
 * - Índice de aridez derivado (1 - (precip / pet_estimado))
 *
 * Versión 2.1 de WORLDCLIM es la última estable; datos accesibles vía
 * https://www.worldclim.org/data/worldclim21.html con descarga directa de tiles.
 *
 * Para Chile usamos los tiles regionalizados (sur de Sudamérica):
 * wc2.1_2.5m_bio_[1,12].tif (variables bioclimáticas 1 y 12)
 *
 * Esfuerzo: L (bajo) — descargar, reproject a EPSG:4326 si es necesario,
 * mapear colores, emitir GeoJSON stub + meta.json.
 *
 * @see docs/roadmap.md § 5.1
 */

import { promises as fs } from 'fs';

const META_FILE = 'public/data/bioclima.meta.json';

/**
 * Descarga y procesa datos bioclimáticos WORLDCLIM.
 *
 * Por ahora genera un stub de metadatos. La descarga real de los rasters
 * requiere gdal_translate + validación local de espacio en disco (~150 MB por variable).
 * Se deja como tarea manual la primera vez, documentada abajo.
 */
async function buildBioclima() {
  console.log('🌍 Construyendo capa bioclimática WORLDCLIM...\n');

  // Metadata stub con la receta de descarga
  const meta = {
    fuente: 'WORLDCLIM v2.1 (1981-2010)',
    resolucion: '2.5 minutos (~5 km)',
    fecha_levantamiento: '1981-2010 (climatología)',
    licencia: 'CC-BY-4.0 (WORLDCLIM Project)',
    url_fuente: 'https://www.worldclim.org/data/worldclim21.html',
    variables: {
      bio1_temp_media_anual: {
        unidad: '°C × 10',
        descripcion: 'Temperatura media anual (escala 1/10 °C)',
        file: 'wc2.1_2.5m_bio_1.tif',
        url: 'https://www.worldclim.org/data/worldclim21.html',
      },
      bio12_precip_anual: {
        unidad: 'mm',
        descripcion: 'Precipitación total anual',
        file: 'wc2.1_2.5m_bio_12.tif',
        url: 'https://www.worldclim.org/data/worldclim21.html',
      },
    },
    observaciones: [
      'Primera entrega: bioclima observado (climatología 1981-2010)',
      'Próxima: proyecciones climáticas futuras (CMIP6 2050, 2070)',
      'Resolución 2.5 min es gruesa para predios individuales; útil para contexto regional',
      'Los datos crudos de WORLDCLIM son GeoTIFF en EPSG:4326 (listo para usar)',
    ],
    estado: 'INVESTIGACIÓN',
    pasos_descarga: [
      '1. Descargar BIO1 (temp media anual) desde https://www.worldclim.org/data/worldclim21.html',
      '2. Descargar BIO12 (precip anual) desde la misma fuente',
      '3. Reproducir con gdal: gdal_translate -projwin -75.7 -17 -66.4 -56 wc2.1_2.5m_bio_1.tif bioclima_temp_chile.tif',
      '4. Convertir a GeoJSON con gdal_translate -of GeoJSON o usar raster2pgsql para PostGIS',
      '5. Generar PNG por viewport en /api/bioclima/export (similar a /api/suelos/export)',
    ],
    features_count: null,
    boundsWgs84: {
      north: '-17°',
      south: '-56°',
      east: '-66.4°',
      west: '-75.7°',
      descripcion: 'Cubierta de Chile continental',
    },
  };

  console.log('📖 Receta de descarga e integración:\n');
  meta.pasos_descarga.forEach((paso) => {
    console.log(`   ${paso}`);
  });

  console.log('\n⚠️  ESTADO: Investigación (stub de metadatos)\n');
  console.log('Próximos pasos:');
  console.log('  1. Descargar GeoTIFF de WORLDCLIM (manual primera vez, ~150 MB)');
  console.log('  2. Validar cobertura de Chile (bounding box)');
  console.log('  3. Crear /api/bioclima/export route handler (PNG por viewport)');
  console.log('  4. Diseñar leyenda (divergente: azul frío = húmedo, rojo = árido)');
  console.log('  5. Integrar en LayersControl con toggle\n');

  // Guardar metadatos
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2));
  console.log(`✅ Metadatos stub en ${META_FILE}`);

  console.log('\n📚 Referencias:');
  console.log('  • WORLDCLIM Project: https://www.worldclim.org/');
  console.log('  • Documentación: https://www.worldclim.org/data/worldclim21.html');
  console.log('  • Roadmap: docs/roadmap.md § 5.1');
  console.log('  • Arquitectura: docs/arquitectura-capas.md § Capas dinámicas remotas\n');
}

buildBioclima().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
