#!/usr/bin/env node
/**
 * ETL reproducible — Capa Red Caminera de Chile (Dirección de Vialidad, MOP).
 *
 * Descarga la Red Vial Nacional publicada por la Dirección de Vialidad del
 * Ministerio de Obras Públicas en su portal de descargas oficial
 * (mapasvialidad.mop.gob.cl, UGIT-DV — el mismo dato del visor
 * www.mapas.mop.cl). El zip trae el shapefile completo (~14.100 tramos,
 * SIRGAS/coordenadas geográficas) con la toponimia oficial (NOMBRE_CAMINO),
 * el ROL de Vialidad, la clasificación funcional, el tipo de carpeta y si el
 * tramo está concesionado.
 *
 * Nota: existe también el servicio ArcGIS REST
 * (rest-sit.mop.gob.cl/arcgis/rest/services/VIALIDAD/Red_Vial_Chile), pero es
 * ArcGIS 10.21 sin `f=geojson` ni paginación, limita a 1.000 registros por
 * consulta y se degrada bajo descarga sostenida (500 «Error performing query
 * operation» durante largo rato). La descarga directa del shapefile es la vía
 * robusta y trae vintage explícito en el nombre del archivo.
 *
 * El DBF del shapefile trunca los nombres de campo a 10 caracteres
 * (NOMBRE_CAM, CLASIFICAC, CONCESIONA); el ETL los renombra a los nombres
 * canónicos del esquema REST de la fuente (NOMBRE_CAMINO, CLASIFICACION,
 * CONCESIONADO) para que la app consuma el esquema oficial completo.
 *
 * Uso:  npm run data:build:red-vial
 *
 * El zip crudo y el shapefile extraído quedan en scripts/.cache/red-vial/
 * (ignorado por git). Solo se versiona la salida simplificada.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache', 'red-vial');
const EXTRACT_DIR = join(CACHE, 'shp');
const OUT_DIR = join(ROOT, 'public', 'data');

// --- Fuente oficial -------------------------------------------------------
// Vintage en el nombre del archivo; actualizar aquí cuando Vialidad publique
// una versión nueva en mapasvialidad.mop.gob.cl/descargas/.
const VINTAGE = '2026_06_30';

const SOURCE = {
  name: `Dirección de Vialidad, Ministerio de Obras Públicas — Red Vial Nacional (${VINTAGE.replaceAll('_', '-')})`,
  portal: 'mapasvialidad.mop.gob.cl (UGIT-DV, descargas oficiales) · visor: www.mapas.mop.cl',
  url: `https://mapasvialidad.mop.gob.cl/archivos/sites/10/2026/07/Red_Vial_${VINTAGE}_shp.zip`,
  catalog: 'https://mapasvialidad.mop.gob.cl/descargas/',
  license:
    'Dato público institucional (Estado de Chile, Dirección de Vialidad MOP), de carácter referencial. Atribución: "Dirección de Vialidad, Ministerio de Obras Públicas".',
};

// Campos del DBF a conservar (truncados a 10 caracteres por el formato) y su
// renombre al nombre canónico del esquema REST oficial de la fuente. REGION y
// KM_I/KM_F se descartan a propósito: con 14k tramos las propiedades pesan
// tanto como la geometría, y ese presupuesto se gasta mejor en calidad de
// trazado (REGION además es evidente por la posición en el mapa).
const KEEP_FIELDS = ['NOMBRE_CAM', 'ROL', 'CLASIFICAC', 'CARPETA', 'CONCESIONA'];
const RENAME_FIELDS = ['NOMBRE_CAMINO=NOMBRE_CAM', 'CLASIFICACION=CLASIFICAC', 'CONCESIONADO=CONCESIONA'];
const FINAL_FIELDS = ['NOMBRE_CAMINO', 'ROL', 'CLASIFICACION', 'CARPETA', 'CONCESIONADO'];

// La red vial se mira a todos los zooms pero el levantamiento GNSS original
// (1:10.000) trae cientos de vértices por tramo: se simplifica fuerte para
// caber en el presupuesto de peso (< 6 MB) manteniendo el trazado reconocible
// (visvalingam weighted prioriza conservar curvas y ángulos pronunciados).
const SIMPLIFY = 'visvalingam weighted 0.7% keep-shapes';
const PRECISION = 0.00001;

const ZIP_PATH = join(CACHE, `Red_Vial_${VINTAGE}_shp.zip`);
const OUT_GEOJSON = join(OUT_DIR, 'red-vial.geojson');
const OUT_META = join(OUT_DIR, 'red-vial.meta.json');

const log = (...a) => console.log('[red-vial]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download() {
  if (await exists(ZIP_PATH)) {
    log('zip ya en caché, omitiendo descarga');
    return;
  }
  log(`descargando Red Vial ${VINTAGE} desde mapasvialidad.mop.gob.cl (~214 MB)…`);
  const res = await fetch(SOURCE.url);
  if (!res.ok) throw new Error(`Descarga falló: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(ZIP_PATH));
  log('descarga completa');
}

async function unzip() {
  if (await exists(EXTRACT_DIR)) {
    log('zip ya extraído, omitiendo unzip');
    return;
  }
  log('descomprimiendo…');
  execFileSync('unzip', ['-o', '-q', ZIP_PATH, '-d', EXTRACT_DIR], { stdio: 'inherit' });
}

/** Busca recursivamente el shapefile de la red vial dentro del zip extraído. */
async function findShp(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findShp(p);
      if (found) return found;
    } else if (/red_vial/i.test(entry.name) && entry.name.toLowerCase().endsWith('.shp')) {
      return p;
    }
  }
  return null;
}

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
}

function mapshaperVersion() {
  try {
    const require = createRequire(import.meta.url);
    return require('mapshaper/package.json').version;
  } catch {
    return 'desconocida';
  }
}

function simplify(shpPath) {
  log(`simplificando (${SIMPLIFY}, precision=${PRECISION})…`);
  const args = [
    mapshaperBin(),
    shpPath,
    '-proj',
    'wgs84',
    '-filter-fields',
    KEEP_FIELDS.join(','),
    '-rename-fields',
    RENAME_FIELDS.join(','),
    '-simplify',
    ...SIMPLIFY.split(' '),
    '-o',
    'force',
    `precision=${PRECISION}`,
    'format=geojson',
    OUT_GEOJSON,
  ];
  execFileSync('node', args, { stdio: 'inherit' });
}

async function writeMeta(featureCount) {
  const meta = {
    source: SOURCE.name,
    source_url: SOURCE.url,
    catalog_url: SOURCE.catalog,
    portal: SOURCE.portal,
    license: SOURCE.license,
    downloaded_at: new Date().toISOString().slice(0, 10),
    vintage: VINTAGE.replaceAll('_', '-'),
    feature_count: featureCount,
    crs: 'EPSG:4326 (la fuente viene en SIRGAS/coordenadas geográficas; reproyectado con mapshaper)',
    fields: FINAL_FIELDS,
    processing:
      `mapshaper -proj wgs84 -filter-fields ${KEEP_FIELDS.join(',')} -rename-fields ${RENAME_FIELDS.join(',')} ` +
      `-simplify ${SIMPLIFY} precision=${PRECISION}. Los nombres de campo del DBF (truncados a 10 caracteres) ` +
      `se renombran al esquema canónico del servicio REST oficial de la fuente.`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato público oficial (Dirección de Vialidad, Ministerio de Obras Públicas — Red Vial Nacional, ' +
      'descarga oficial de mapasvialidad.mop.gob.cl, el mismo dato del visor www.mapas.mop.cl). Geometría ' +
      'simplificada solo para visualización web: el trazado mostrado es referencial. La toponimia ' +
      '(NOMBRE_CAMINO) y el ROL son los oficiales de Vialidad. Para análisis o uso normativo, consultar la fuente original.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await download();
  await unzip();

  const shp = await findShp(EXTRACT_DIR);
  if (!shp) throw new Error(`No se encontró el shapefile de la red vial dentro de ${EXTRACT_DIR}`);
  log(`shapefile: ${shp}`);

  simplify(shp);

  const gj = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  const count = gj.features?.length ?? 0;
  await writeMeta(count);

  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${count} tramos · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[red-vial] ERROR:', err.message);
  process.exit(1);
});
