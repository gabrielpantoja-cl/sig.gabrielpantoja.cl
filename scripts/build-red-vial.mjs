#!/usr/bin/env node
/**
 * ETL reproducible — Capa Red Caminera de Chile (Dirección de Vialidad, MOP).
 *
 * Descarga la Red Vial Nacional publicada por la Dirección de Vialidad del
 * Ministerio de Obras Públicas en su servicio ArcGIS REST oficial
 * (rest-sit.mop.gob.cl, el backend del visor www.mapas.mop.cl). La capa 3 del
 * MapServer VIALIDAD/Red_Vial_Chile trae los ~14.100 tramos a escala
 * 1:10.000–1:25.000 con la toponimia oficial (NOMBRE_CAMINO), el ROL de
 * Vialidad, la clasificación funcional, el tipo de carpeta y si el tramo está
 * concesionado.
 *
 * El servidor es ArcGIS Server 10.21: no soporta `f=geojson` ni paginación
 * (`resultOffset`), así que el script pide la lista completa de OBJECTID,
 * consulta por rangos (maxRecordCount=1000) en esriJSON reproyectado a WGS84
 * (outSR=4326), convierte los polylines esriJSON → GeoJSON localmente y
 * simplifica con mapshaper para producir un GeoJSON liviano apto para el
 * navegador, junto con un manifiesto de procedencia.
 *
 * Uso:  npm run data:build:red-vial
 *
 * Los lotes crudos quedan cacheados en scripts/.cache/red-vial/ (ignorado por
 * git): re-ejecutar retoma donde quedó. Solo se versiona la salida simplificada.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache', 'red-vial');
const OUT_DIR = join(ROOT, 'public', 'data');

// --- Fuente oficial -------------------------------------------------------
const LAYER_URL =
  'https://rest-sit.mop.gob.cl/arcgis/rest/services/VIALIDAD/Red_Vial_Chile/MapServer/3';

const SOURCE = {
  name: 'Dirección de Vialidad, Ministerio de Obras Públicas — Red Vial Nacional',
  portal: 'www.mapas.mop.cl (visor) · rest-sit.mop.gob.cl (servicio ArcGIS REST)',
  url: `${LAYER_URL}/query`,
  catalog: 'https://www.mop.gob.cl/serviciosmop/red-vial-nacional/',
  license:
    'Dato público institucional (Estado de Chile, Dirección de Vialidad MOP). Atribución: "Dirección de Vialidad, Ministerio de Obras Públicas".',
};

// Atributos a conservar (nombres originales de la fuente, sin renombrar).
const KEEP_FIELDS = [
  'NOMBRE_CAMINO',
  'ROL',
  'CLASIFICACION',
  'CARPETA',
  'REGION',
  'CONCESIONADO',
  'KM_I',
  'KM_F',
];

// La red vial se mira a todos los zooms pero el levantamiento GNSS original
// (1:10.000) trae ~600 vértices por tramo: se simplifica fuerte para caber en
// el presupuesto de peso (< 6 MB) manteniendo el trazado reconocible.
const SIMPLIFY = 'visvalingam weighted 3% keep-shapes';
const PRECISION = 0.00001;

const BATCH_SIZE = 900; // maxRecordCount del servidor es 1000
const OUT_GEOJSON = join(OUT_DIR, 'red-vial.geojson');
const OUT_META = join(OUT_DIR, 'red-vial.meta.json');
const RAW_GEOJSON = join(CACHE, 'red-vial-raw.geojson');

const log = (...a) => console.log('[red-vial]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// El servidor MOP se degrada bajo carga sostenida (500 «Error performing
// query operation» incluso para consultas mínimas) y tarda varios minutos en
// recuperarse: backoff largo y progresivo entre reintentos.
async function fetchJson(url, tries = 5) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(`ArcGIS: ${JSON.stringify(data.error)}`);
      return data;
    } catch (err) {
      if (i >= tries) throw err;
      log(`reintento ${i}/${tries - 1} en ${30 * i} s tras error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 30_000 * i));
    }
  }
}

/** Lista completa de OBJECTID de la capa (cacheada). */
async function getObjectIds() {
  const cachePath = join(CACHE, 'object-ids.json');
  if (await exists(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  log('consultando lista de OBJECTID…');
  const data = await fetchJson(`${LAYER_URL}/query?where=1%3D1&returnIdsOnly=true&f=json`);
  const ids = (data.objectIds ?? []).sort((a, b) => a - b);
  await writeFile(cachePath, JSON.stringify(ids));
  return ids;
}

/** Descarga un lote de features por rango de OBJECTID (cacheado por lote). */
async function fetchBatch(idFrom, idTo, index, total) {
  const cachePath = join(CACHE, `batch-${String(index).padStart(3, '0')}.json`);
  if (await exists(cachePath)) {
    return JSON.parse(await readFile(cachePath, 'utf8'));
  }
  const params = new URLSearchParams({
    where: `OBJECTID BETWEEN ${idFrom} AND ${idTo}`,
    outFields: KEEP_FIELDS.join(','),
    outSR: '4326',
    f: 'json',
  });
  const data = await fetchJson(`${LAYER_URL}/query?${params}`);
  if (data.exceededTransferLimit) {
    throw new Error(`lote ${index}: exceededTransferLimit (rango ${idFrom}–${idTo} demasiado grande)`);
  }
  await writeFile(cachePath, JSON.stringify(data));
  log(`lote ${index}/${total}: ${data.features?.length ?? 0} tramos`);
  return data;
}

/** Convierte un polyline esriJSON (paths) a geometría GeoJSON. */
function esriPolylineToGeoJson(geometry) {
  const paths = geometry?.paths ?? [];
  if (paths.length === 0) return null;
  if (paths.length === 1) return { type: 'LineString', coordinates: paths[0] };
  return { type: 'MultiLineString', coordinates: paths };
}

async function downloadAndConvert() {
  const ids = await getObjectIds();
  log(`${ids.length} tramos en la fuente (OBJECTID ${ids[0]}–${ids[ids.length - 1]})`);

  const features = [];
  const totalBatches = Math.ceil(ids.length / BATCH_SIZE);
  for (let i = 0; i < totalBatches; i++) {
    const slice = ids.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const data = await fetchBatch(slice[0], slice[slice.length - 1], i + 1, totalBatches);
    for (const f of data.features ?? []) {
      const geometry = esriPolylineToGeoJson(f.geometry);
      if (!geometry) continue;
      const properties = {};
      for (const k of KEEP_FIELDS) properties[k] = f.attributes?.[k] ?? null;
      features.push({ type: 'Feature', properties, geometry });
    }
  }

  log(`convertidos ${features.length} tramos esriJSON → GeoJSON`);
  await writeFile(RAW_GEOJSON, JSON.stringify({ type: 'FeatureCollection', features }));
  return features.length;
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

function simplify() {
  log(`simplificando (${SIMPLIFY}, precision=${PRECISION})…`);
  const args = [
    mapshaperBin(),
    RAW_GEOJSON,
    '-simplify',
    ...SIMPLIFY.split(' '),
    '-o',
    'force',
    `precision=${PRECISION}`,
    'format=geojson',
    OUT_GEOJSON,
  ];
  execFileSync('node', args, { stdio: 'inherit', maxBuffer: 1024 * 1024 * 64 });
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
    crs: 'EPSG:4326 (reproyectado server-side con outSR=4326)',
    fields: KEEP_FIELDS,
    processing:
      `ArcGIS REST query por rangos de OBJECTID (esriJSON, outSR=4326) → conversión esriJSON→GeoJSON → ` +
      `mapshaper -simplify ${SIMPLIFY} precision=${PRECISION}`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato público oficial (Dirección de Vialidad, Ministerio de Obras Públicas — Red Vial Nacional, ' +
      'levantamiento GNSS 1:10.000–1:25.000, servicio del visor www.mapas.mop.cl). Geometría simplificada ' +
      'solo para visualización web: el trazado mostrado es referencial. La toponimia (NOMBRE_CAMINO) y el ' +
      'ROL son los oficiales de Vialidad. Para análisis o uso normativo, consultar la fuente original.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  await downloadAndConvert();
  simplify();

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
