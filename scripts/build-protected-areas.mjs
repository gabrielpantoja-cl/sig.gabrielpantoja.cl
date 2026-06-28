#!/usr/bin/env node
/**
 * ETL reproducible — Capa de Áreas Protegidas de Chile.
 *
 * Descarga el dataset oficial del Ministerio del Medio Ambiente (MMA),
 * Registro Nacional de Áreas Protegidas (RNAP), publicado como dato abierto
 * CC0 en el portal "Líneas de Base Públicas", lo simplifica preservando la
 * topología (mapshaper / Visvalingam) y produce un GeoJSON liviano apto para
 * el navegador, junto con un manifiesto de procedencia.
 *
 * Uso:  npm run data:build
 *
 * El zip crudo (~95 MB) y el GeoJSON sin simplificar (~275 MB) se descargan a
 * scripts/.cache/ (ignorado por git). Solo se versiona la salida simplificada.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const OUT_DIR = join(ROOT, 'public', 'data');

// --- Fuente oficial -------------------------------------------------------
const SOURCE = {
  name: 'Ministerio del Medio Ambiente (MMA) — Registro Nacional de Áreas Protegidas (RNAP)',
  portal: 'Líneas de Base Públicas',
  url: 'https://lineasdebasepublicas.mma.gob.cl/datos_abiertos/dataset/b08586a7-04b9-4fc8-abe2-9febcd570f2c/resource/0939fd5f-47ca-4e76-9a5e-0ddcf2e457c6/download/areas-protegidas_geojson.zip',
  license: 'CC0 1.0 (dominio público)',
  crs: 'EPSG:4326',
};

// Parámetros de simplificación (topología preservada).
const SIMPLIFY = 'visvalingam weighted 1.5% keep-shapes';
const PRECISION = 0.00001;

// Atributos a conservar del dataset oficial.
const KEEP_FIELDS = ['cod_rnap', 'nombre_ap', 'region', 'designacion_ap', 'ha', 'url_fuente'];

const ZIP_PATH = join(CACHE, 'areas-protegidas.zip');
const RAW_GEOJSON = join(CACHE, 'Areas Protegidas.geojson');
const OUT_GEOJSON = join(OUT_DIR, 'areas-protegidas.geojson');
const OUT_META = join(OUT_DIR, 'areas-protegidas.meta.json');

const log = (...a) => console.log('[areas-protegidas]', ...a);

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
  log('descargando dataset oficial del MMA (~95 MB)…');
  const res = await fetch(SOURCE.url);
  if (!res.ok) throw new Error(`Descarga falló: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(ZIP_PATH));
  log('descarga completa');
}

function unzip() {
  try {
    statSync(RAW_GEOJSON);
    log('GeoJSON crudo ya extraído, omitiendo unzip');
    return;
  } catch {
    // no extraído aún
  }
  log('descomprimiendo…');
  execFileSync('unzip', ['-o', ZIP_PATH, '-d', CACHE], { stdio: 'inherit' });
}

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
}

function simplify() {
  log(`simplificando (${SIMPLIFY}, precision=${PRECISION})…`);
  const fields = KEEP_FIELDS.join(',');
  const args = [
    mapshaperBin(),
    RAW_GEOJSON,
    '-filter-fields',
    fields,
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
    portal: SOURCE.portal,
    license: SOURCE.license,
    downloaded_at: new Date().toISOString().slice(0, 10),
    feature_count: featureCount,
    crs: SOURCE.crs,
    fields: KEEP_FIELDS,
    processing: `mapshaper -filter-fields ${KEEP_FIELDS.join(',')} -simplify ${SIMPLIFY} precision=${PRECISION}`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato abierto oficial del Estado de Chile (CC0). Cada área enlaza a su ficha en SIMBIO vía url_fuente. ' +
      'Geometría simplificada solo para visualización web; para análisis usar la fuente original.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await download();
  unzip();
  simplify();

  const gj = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  const count = gj.features?.length ?? 0;
  await writeMeta(count);

  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${count} áreas · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[areas-protegidas] ERROR:', err.message);
  process.exit(1);
});
