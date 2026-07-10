#!/usr/bin/env node
/**
 * ETL reproducible — Capa de Límites Comunales de Chile (DPA 2023).
 *
 * Descarga el dataset oficial de la División Político-Administrativa 2023
 * publicado por SUBDERE en geoportal.cl (Grupo de Trabajo DPA: SUBDERE, IGM,
 * DIFROL, INE; escala 1:50.000; circulación autorizada por Resolución N°50 de
 * 2019 de DIFROL). El zip (~311 MB) trae shapefiles de comunas, provincias y
 * regiones; este script toma el de COMUNAS, lo reproyecta a WGS84, conserva
 * solo los atributos públicos útiles y simplifica con mapshaper (Visvalingam,
 * topología preservada) para producir un GeoJSON liviano apto para el
 * navegador, junto con un manifiesto de procedencia.
 *
 * Uso:  npm run data:build:comunas
 *
 * El zip crudo y los shapefiles extraídos quedan en scripts/.cache/ (ignorado
 * por git). Solo se versiona la salida simplificada.
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
const CACHE = join(__dirname, '.cache');
const EXTRACT_DIR = join(CACHE, 'dpa-2023');
const OUT_DIR = join(ROOT, 'public', 'data');

// --- Fuente oficial -------------------------------------------------------
const SOURCE = {
  name: 'SUBDERE — División Político-Administrativa de Chile 2023 (Comunas)',
  portal: 'geoportal.cl (IDE Chile, Catálogo Nacional de Información Geoespacial)',
  url: 'https://geoportal.cl/geoportal/catalog/download/912598ad-ac92-35f6-8045-098f214bd9c2',
  catalog:
    'https://geoportal.cl/geoportal/catalog/36391/Divisi%C3%B3n%20Pol%C3%ADtica%20Administrativa%202023',
  license:
    'Dato público institucional (Estado de Chile). Circulación autorizada por Resolución N°50/2019 de DIFROL.',
};

// Atributos a conservar del dataset oficial (nombres originales de la fuente).
const KEEP_FIELDS = ['CUT_REG', 'CUT_PROV', 'CUT_COM', 'REGION', 'PROVINCIA', 'COMUNA', 'SUPERFICIE'];

// La línea comunal se mira a todos los zooms; el litoral de fiordos del sur es
// extremadamente detallado, así que se simplifica fuerte pero preservando
// topología (sin huecos entre comunas vecinas) y formas (keep-shapes).
const SIMPLIFY = 'visvalingam weighted 1.5% keep-shapes';
const PRECISION = 0.00001;

const ZIP_PATH = join(CACHE, 'DPA_2023.zip');
const OUT_GEOJSON = join(OUT_DIR, 'limites-comunales.geojson');
const OUT_META = join(OUT_DIR, 'limites-comunales.meta.json');

const log = (...a) => console.log('[limites-comunales]', ...a);

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
  log('descargando DPA 2023 desde geoportal.cl (~311 MB)…');
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
  execFileSync('unzip', ['-o', ZIP_PATH, '-d', EXTRACT_DIR], { stdio: 'inherit' });
}

/** Busca recursivamente el shapefile de comunas dentro del zip extraído. */
async function findComunasShp(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findComunasShp(p);
      if (found) return found;
    } else if (/comuna/i.test(entry.name) && entry.name.toLowerCase().endsWith('.shp')) {
      return p;
    }
  }
  return null;
}

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
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

function mapshaperVersion() {
  try {
    const require = createRequire(import.meta.url);
    return require('mapshaper/package.json').version;
  } catch {
    return 'desconocida';
  }
}

async function writeMeta(featureCount) {
  const meta = {
    source: SOURCE.name,
    source_url: SOURCE.url,
    catalog_url: SOURCE.catalog,
    portal: SOURCE.portal,
    license: SOURCE.license,
    downloaded_at: new Date().toISOString().slice(0, 10),
    feature_count: featureCount,
    crs: 'EPSG:4326 (reproyectado con mapshaper desde el CRS de la fuente)',
    fields: KEEP_FIELDS,
    processing: `mapshaper -proj wgs84 -filter-fields ${KEEP_FIELDS.join(',')} -simplify ${SIMPLIFY} precision=${PRECISION}`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato público oficial (SUBDERE, Grupo de Trabajo DPA: SUBDERE/IGM/DIFROL/INE, escala 1:50.000). ' +
      'Geometría simplificada solo para visualización web: los límites mostrados son referenciales ' +
      'y no reemplazan a los límites oficiales del Estado de Chile (DIFROL). Para análisis usar la fuente original.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await download();
  await unzip();

  const shp = await findComunasShp(EXTRACT_DIR);
  if (!shp) throw new Error(`No se encontró el shapefile de comunas dentro de ${EXTRACT_DIR}`);
  log(`shapefile de comunas: ${shp}`);

  simplify(shp);

  const gj = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  const count = gj.features?.length ?? 0;
  await writeMeta(count);

  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${count} comunas · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[limites-comunales] ERROR:', err.message);
  process.exit(1);
});
