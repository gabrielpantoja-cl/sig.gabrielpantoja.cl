#!/usr/bin/env node
/**
 * ETL reproducible — Líneas de transmisión eléctrica de Chile.
 *
 * Descarga la capa oficial «Línea de Transmisión» de IDE Energía del
 * Ministerio de Energía. La geometría espacial es proporcionada por el
 * Coordinador Eléctrico Nacional e incorpora además los sistemas medianos de
 * Aysén y Magallanes publicados por sus empresas eléctricas.
 *
 * IMPORTANTE: las polilíneas son ejes cartográficos referenciales. No son
 * polígonos de servidumbre, no informan el ancho de una franja y no acreditan
 * gravámenes prediales. Los planos especiales de servidumbre se tramitan por
 * proyecto/concesión y no existe una cobertura vectorial nacional abierta en
 * IDE Energía o SEC.
 *
 * Uso: npm run data:build:lineas-transmision
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache', 'lineas-transmision');
const OUT_DIR = join(ROOT, 'public', 'data');

const SERVICE_URL =
  'https://ide-energia.minenergia.cl/server/rest/services/IDE_Energia/Visor_IDE_Energ%C3%ADa/MapServer/10';
const CATALOG_URL =
  'https://geoportal.cl/geoportal/catalog/35012/L%C3%ADneas%20de%20transmisi%C3%B3n';
const PAGE_SIZE = 1000;
// La fuente contiene un tramo informado de solo 0,00001554 km; precisiones
// cartográficas habituales (1e-5/1e-6) lo colapsan. 1e-8 preserva ese registro
// y sigue reduciendo el ruido decimal del REST sin simplificar el trazado.
const PRECISION = 0.00000001;
const SOURCE_CRS = 'EPSG:5360 / latestWkid 9184 (SIRGAS-Chile)';

const QUERY_FIELDS = [
  'OBJECTID',
  'NOMBRE',
  'TRAMO',
  'CIRCUITO',
  'TIPO',
  'F_OPERACIO',
  'LONG_KM',
  'PROPIEDAD',
  'TENSION_KV',
  'RCA',
  'SIST_ELECT',
  'ESTADO',
  'FUENTE_BAS',
  'FECH_ACT',
];
const FINAL_FIELDS = QUERY_FIELDS.filter((field) => field !== 'OBJECTID');

const RAW_GEOJSON = join(CACHE, 'lineas-transmision.raw.geojson');
const VALID_GEOJSON = join(CACHE, 'lineas-transmision.valid.geojson');
const OUT_GEOJSON = join(OUT_DIR, 'lineas-transmision.geojson');
const OUT_META = join(OUT_DIR, 'lineas-transmision.meta.json');

const log = (...args) => console.log('[lineas-transmision]', ...args);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, label) {
  const delays = [0, 2000, 5000, 10000];
  let lastError;
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message || 'ArcGIS REST devolvió un error');
      return body;
    } catch (error) {
      lastError = error;
      log(`${label}: intento fallido (${error.message})`);
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'sin respuesta'}`);
}

function queryUrl(params) {
  return `${SERVICE_URL}/query?${new URLSearchParams(params)}`;
}

function isoDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

async function download() {
  if (await exists(RAW_GEOJSON)) {
    log('GeoJSON crudo ya en caché, omitiendo descarga');
    return JSON.parse(await readFile(RAW_GEOJSON, 'utf8'));
  }

  const countBody = await fetchJson(
    queryUrl({ where: '1=1', returnCountOnly: 'true', f: 'json' }),
    'conteo',
  );
  const expectedCount = Number(countBody.count);
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    throw new Error(`Conteo inválido de la fuente: ${countBody.count}`);
  }

  const features = [];
  const objectIds = new Set();
  for (let offset = 0; offset < expectedCount; offset += PAGE_SIZE) {
    log(`descargando ${offset + 1}–${Math.min(offset + PAGE_SIZE, expectedCount)} de ${expectedCount}…`);
    const page = await fetchJson(
      queryUrl({
        where: '1=1',
        outFields: QUERY_FIELDS.join(','),
        returnGeometry: 'true',
        outSR: '4326',
        orderByFields: 'OBJECTID',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
        f: 'geojson',
      }),
      `página offset=${offset}`,
    );

    if (!Array.isArray(page.features) || page.features.length === 0) {
      throw new Error(`Página vacía inesperada en offset=${offset}`);
    }
    for (const feature of page.features) {
      if (!['LineString', 'MultiLineString'].includes(feature.geometry?.type)) {
        throw new Error(`Geometría inesperada: ${feature.geometry?.type ?? 'null'}`);
      }
      const objectId = feature.properties?.OBJECTID;
      if (!Number.isInteger(objectId) || objectIds.has(objectId)) {
        throw new Error(`OBJECTID inválido o duplicado: ${objectId}`);
      }
      objectIds.add(objectId);
      feature.properties.F_OPERACIO = isoDate(feature.properties.F_OPERACIO);
      feature.properties.FECH_ACT = isoDate(feature.properties.FECH_ACT);
      features.push(feature);
    }
  }

  if (features.length !== expectedCount) {
    throw new Error(`Descarga incompleta: ${features.length} de ${expectedCount} features`);
  }

  const geojson = { type: 'FeatureCollection', features };
  await writeFile(RAW_GEOJSON, JSON.stringify(geojson));
  return geojson;
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

function processGeojson() {
  log(`normalizando precisión (${PRECISION}) y descartando OBJECTID…`);
  execFileSync(
    'node',
    [
      mapshaperBin(),
      VALID_GEOJSON,
      '-filter-fields',
      FINAL_FIELDS.join(','),
      '-o',
      'force',
      `precision=${PRECISION}`,
      'format=geojson',
      OUT_GEOJSON,
    ],
    { stdio: 'inherit' },
  );
}

function hasDrawableGeometry(feature) {
  if (feature.geometry?.type === 'LineString') {
    return Array.isArray(feature.geometry.coordinates) && feature.geometry.coordinates.length >= 2;
  }
  if (feature.geometry?.type === 'MultiLineString') {
    return feature.geometry.coordinates?.some((line) => Array.isArray(line) && line.length >= 2) ?? false;
  }
  return false;
}

async function prepareValidGeojson() {
  const raw = JSON.parse(await readFile(RAW_GEOJSON, 'utf8'));
  const validFeatures = raw.features.filter(hasDrawableGeometry);
  const excludedCount = raw.features.length - validFeatures.length;
  if (excludedCount) {
    log(`excluyendo ${excludedCount} feature sin coordenadas dibujables`);
  }
  await writeFile(VALID_GEOJSON, JSON.stringify({ type: 'FeatureCollection', features: validFeatures }));
  return { sourceFeatureCount: raw.features.length, excludedCount };
}

async function writeMeta(geojson, sourceFeatureCount, excludedCount) {
  const updateDates = geojson.features
    .map((feature) => feature.properties?.FECH_ACT)
    .filter(Boolean)
    .sort();
  const tensions = geojson.features
    .map((feature) => Number(feature.properties?.TENSION_KV))
    .filter(Number.isFinite);
  const meta = {
    source: 'Ministerio de Energía — IDE Energía — Línea de Transmisión',
    spatial_data_provider: 'Coordinador Eléctrico Nacional (CEN); sistemas medianos según FUENTE_BAS',
    source_url: SERVICE_URL,
    catalog_url: CATALOG_URL,
    terms:
      'Cobertura cartográfica institucional para uso público. El servicio oficial permite acceso, descarga, integración y procesamiento; no declara una licencia estándar en sus metadatos. Atribución obligatoria al Ministerio de Energía e IDE Energía.',
    downloaded_at: new Date().toISOString().slice(0, 10),
    vintage: updateDates.at(-1) ?? null,
    source_feature_count: sourceFeatureCount,
    feature_count: geojson.features.length,
    excluded_features_without_coordinates: excludedCount,
    geometry_types: [...new Set(geojson.features.map((feature) => feature.geometry?.type))],
    source_crs: SOURCE_CRS,
    crs: 'EPSG:4326 (reproyectado por ArcGIS REST con outSR=4326)',
    fields: FINAL_FIELDS,
    tension_kv_range: tensions.length ? [Math.min(...tensions), Math.max(...tensions)] : null,
    processing:
      `ArcGIS REST paginado (${PAGE_SIZE}/request, orderByFields=OBJECTID, reintentos 2-5-10 s) → ` +
      `normalización de F_OPERACIO/FECH_ACT a YYYY-MM-DD → mapshaper -filter-fields ${FINAL_FIELDS.join(',')} ` +
      `precision=${PRECISION}. Sin simplificación geométrica: el archivo queda dentro del presupuesto web y conserva el trazado oficial.`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Ejes cartográficos referenciales de líneas de transmisión. NO representan fajas de seguridad, polígonos de servidumbre ni gravámenes prediales; no permiten determinar su ancho, vigencia o afectación jurídica. Para uso normativo se deben consultar la concesión, los planos especiales de servidumbre y las inscripciones de cada proyecto.',
  };
  await writeFile(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });
  await download();
  const { sourceFeatureCount, excludedCount } = await prepareValidGeojson();
  processGeojson();

  const geojson = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  if (!Array.isArray(geojson.features) || geojson.features.length === 0) {
    throw new Error('La salida no contiene features');
  }
  const invalidGeometry = geojson.features.find(
    (feature) => !['LineString', 'MultiLineString'].includes(feature.geometry?.type),
  );
  if (invalidGeometry) {
    throw new Error(`La salida contiene geometría inválida: ${invalidGeometry.geometry?.type ?? 'null'}`);
  }
  await writeMeta(geojson, sourceFeatureCount, excludedCount);
  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${geojson.features.length} tramos · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((error) => {
  console.error('[lineas-transmision] ERROR:', error.message);
  process.exit(1);
});
