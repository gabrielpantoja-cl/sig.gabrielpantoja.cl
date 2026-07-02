#!/usr/bin/env node
/**
 * ETL reproducible — Capa de Límite Urbano (PRC) de Chile.
 *
 * Consulta el servicio oficial ArcGIS REST del MINVU (Instrumentos de
 * Planificación Territorial, capa Limites_Urbanos_PRC: límites urbanos de los
 * Planes Reguladores Comunales, 601 polígonos a nivel nacional). La consulta
 * pide GeoJSON reproyectado a WGS84 server-side (outSR=4326), por lo que no
 * hay zip ni reproyección local. Luego simplifica suavemente con mapshaper
 * (los límites urbanos se miran a zoom alto: simplificar de más se nota) y
 * escribe el GeoJSON liviano más un manifiesto de procedencia.
 *
 * Uso:  npm run data:build:urban
 *
 * El GeoJSON crudo se guarda en scripts/.cache/ (ignorado por git). Solo se
 * versiona la salida simplificada.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const OUT_DIR = join(ROOT, 'public', 'data');

// Atributos a conservar del dataset oficial (nombres originales de la fuente).
const KEEP_FIELDS = ['REG', 'COM', 'NOM', 'INSTRUM', 'ADMIN', 'P_DO', 'N_DO', 'T_DO'];

// --- Fuente oficial -------------------------------------------------------
const SOURCE = {
  name: 'Ministerio de Vivienda y Urbanismo (MINVU) — Límites Urbanos PRC (IPT)',
  portal: 'IDE MINVU / geoide.minvu.cl',
  url:
    'https://geoide.minvu.cl/server/rest/services/IPT/Limites_Urbanos/FeatureServer/0/query' +
    `?where=1%3D1&outFields=${KEEP_FIELDS.join(',')}&outSR=4326&f=geojson`,
  license: 'Dato público institucional (Estado de Chile)',
  crs: 'EPSG:4326 (reproyectado server-side desde EPSG:32719 vía outSR)',
};

// Simplificación más suave que la de áreas protegidas (1.5%): el límite
// urbano se consulta a zoom alto, donde la línea debe seguir siendo fiel.
const SIMPLIFY = 'visvalingam weighted 5% keep-shapes';
const PRECISION = 0.00001;

const RAW_GEOJSON = join(CACHE, 'limite-urbano-raw.geojson');
const OUT_GEOJSON = join(OUT_DIR, 'limite-urbano.geojson');
const OUT_META = join(OUT_DIR, 'limite-urbano.meta.json');

const log = (...a) => console.log('[limite-urbano]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download() {
  if (await exists(RAW_GEOJSON)) {
    log('GeoJSON crudo ya en caché, omitiendo descarga');
    return;
  }
  log('consultando servicio ArcGIS REST del MINVU…');
  const res = await fetch(SOURCE.url);
  if (!res.ok) throw new Error(`Descarga falló: HTTP ${res.status}`);
  const gj = await res.json();
  if (gj.error) throw new Error(`El servicio respondió error: ${JSON.stringify(gj.error)}`);
  if (!Array.isArray(gj.features) || gj.features.length === 0) {
    throw new Error('La respuesta no trae features');
  }
  // El servicio limita a 2000 registros por consulta; hoy son 601 features.
  if (gj.exceededTransferLimit) {
    throw new Error('exceededTransferLimit: el dataset creció y ahora requiere paginación');
  }
  await writeFile(RAW_GEOJSON, JSON.stringify(gj));
  log(`descarga completa: ${gj.features.length} features`);
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
    crs: 'EPSG:4326',
    fields: KEEP_FIELDS,
    processing: `mapshaper -filter-fields ${KEEP_FIELDS.join(',')} -simplify ${SIMPLIFY} precision=${PRECISION}`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato público oficial del MINVU (límites urbanos de Planes Reguladores Comunales). ' +
      'Geometría simplificada solo para visualización web; el límite normativo vigente ' +
      'es el del instrumento publicado en el Diario Oficial — consultar el municipio respectivo.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await download();
  simplify();

  const gj = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  const count = gj.features?.length ?? 0;
  await writeMeta(count);

  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${count} límites urbanos · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[limite-urbano] ERROR:', err.message);
  process.exit(1);
});
