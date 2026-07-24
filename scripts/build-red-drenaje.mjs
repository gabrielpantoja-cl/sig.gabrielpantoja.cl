#!/usr/bin/env node
/**
 * ETL reproducible — Capa Red de Drenaje de Chile (DGA, MOP).
 *
 * Descarga las dos capas oficiales de la Dirección General de Aguas del
 * Ministerio de Obras Públicas — `Ríos` y `Esteros` — desde su FeatureServer
 * ArcGIS REST (services3.arcgis.com/aSoEm9TBK2shtWjP), las combina en un
 * único FeatureCollection nacional y simplifica con mapshaper para producir
 * un GeoJSON liviano apto para el navegador, junto con un manifiesto de
 * procedencia.
 *
 * Nota sobre la fuente: la DGA también publica el mismo dato en su Mapoteca
 * Digital (dga.mop.gob.cl/estudiospublicaciones/mapoteca/) como shapefile
 * descargable. Pero esa URL devuelve 404 desde 2026 (el portal HTML está
 * caído en todo momento de captura, julio-2026), y el FeatureServer ArcGIS
 * es el único canal estable para consumir el dato. Ambos exponen la misma
 * base BNA: prefijamos `tipo` para distinguir origen, conservamos el TIPO
 * original DGA por si la capa se cruza con otra fuente.
 *
 * Paginación: cada FeatureServer limita a 1.000 features con geometría por
 * consulta. El conteo actual es 22.869 Ríos + 12.683 Esteros → 36 requests
 * de 1.000 features. La fuente soporta `resultRecordCount` + `resultOffset`
 * correctamente. Backoff incremental (2-5-10 s) entre páginas para no
 * colapsar el server estatal — la misma regla aplicada al resto de las
 * fuentes del proyecto (ver docs/fuentes-gis-chile.md § Hallazgo transversal).
 *
 * Uso:  npm run data:build:red-drenaje
 *
 * Los GeoJSON crudos por FeatureServer y por página se guardan en
 * scripts/.cache/red-drenaje/ (gitignored). Solo se versiona la salida
 * simplificada.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache', 'red-drenaje');
const OUT_DIR = join(ROOT, 'public', 'data');

const BASE_URL = 'https://services3.arcgis.com/aSoEm9TBK2shtWjP/ArcGIS/rest/services';
const PAGE_SIZE = 1000;
const BACKOFF_MS = [2000, 5000, 10000];

// Atributos a conservar (nombres originales de la fuente). El ETL agrega
// además el campo `tipo` normalizado (`rio` | `estero`) en cada feature para
// que la app filtre/estilice sin parsear el TIPO textual original.
const KEEP_FIELDS = ['NOMBRE', 'TIPO', 'COD_CUEN', 'COD_SUBC', 'COD_SSUBC', 'NOM_REG', 'REGION_NUM'];

const SOURCES = [
  {
    tipo: 'rio',
    label: 'Ríos',
    name: 'Dirección General de Aguas (DGA) — Ríos (Banco Nacional de Aguas)',
    service: `${BASE_URL}/R%C3%ADos/FeatureServer/0`,
  },
  {
    tipo: 'estero',
    label: 'Esteros',
    name: 'Dirección General de Aguas (DGA) — Esteros (Banco Nacional de Aguas)',
    service: `${BASE_URL}/Esteros/FeatureServer/0`,
  },
];

// Red de drenaje nacional: ~35k features con LineString/MultiLineString. Se
// mira a todos los zooms pero a zoom nacional el ojo solo capta la red
// principal; simplificación agresiva (visvalingam weighted 8%) baja el peso
// a ~25-35 MB sin perder el trazado reconocible.
const SIMPLIFY = 'visvalingam weighted 8% keep-shapes';
const PRECISION = 0.00001;

const RAW_DIR = join(CACHE, 'pages');
const COMBINED_RAW = join(CACHE, 'red-drenaje-raw.geojson');
const OUT_GEOJSON = join(OUT_DIR, 'red-drenaje.geojson');
const OUT_META = join(OUT_DIR, 'red-drenaje.meta.json');

const log = (...a) => console.log('[red-drenaje]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Trae el conteo total de features del FeatureServer. */
async function fetchCount(serviceUrl) {
  const url = `${serviceUrl}/query?where=1%3D1&returnCountOnly=true&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Conteo falló: HTTP ${res.status}`);
  const j = await res.json();
  if (typeof j.count !== 'number') throw new Error(`Respuesta inesperada: ${JSON.stringify(j)}`);
  return j.count;
}

/**
 * Trae UNA página de features del FeatureServer. Devuelve el array de features
 * (geometría + propiedades). Aplica backoff incremental si el server empieza
 * a fallar, para no tumbar un servicio que ya probamos frágil bajo ráfaga.
 */
async function fetchPage(serviceUrl, offset, attempt = 0) {
  const url =
    `${serviceUrl}/query?where=1%3D1` +
    `&outFields=${KEEP_FIELDS.join(',')}` +
    `&outSR=4326&f=geojson` +
    `&resultRecordCount=${PAGE_SIZE}` +
    `&resultOffset=${offset}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    if (attempt < BACKOFF_MS.length) {
      log(`fetch offset=${offset} reventó (${e.message}); backoff ${BACKOFF_MS[attempt]} ms`);
      await sleep(BACKOFF_MS[attempt]);
      return fetchPage(serviceUrl, offset, attempt + 1);
    }
    throw e;
  }
  if (!res.ok) {
    if (attempt < BACKOFF_MS.length) {
      log(`fetch offset=${offset} HTTP ${res.status}; backoff ${BACKOFF_MS[attempt]} ms`);
      await sleep(BACKOFF_MS[attempt]);
      return fetchPage(serviceUrl, offset, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} tras reintentos`);
  }
  const j = await res.json();
  if (j.error) {
    if (attempt < BACKOFF_MS.length) {
      log(`fetch offset=${offset} error del server; backoff ${BACKOFF_MS[attempt]} ms`);
      await sleep(BACKOFF_MS[attempt]);
      return fetchPage(serviceUrl, offset, attempt + 1);
    }
    throw new Error(`Server: ${JSON.stringify(j.error)}`);
  }
  return Array.isArray(j.features) ? j.features : [];
}

/** Descarga paginada de un FeatureServer, guardando cada página en cache. */
async function downloadService(src) {
  await mkdir(RAW_DIR, { recursive: true });

  const total = await fetchCount(src.service);
  log(`${src.label}: ${total} features declarados`);

  const pages = Math.ceil(total / PAGE_SIZE);
  const features = [];
  for (let p = 0; p < pages; p++) {
    const offset = p * PAGE_SIZE;
    const pagePath = join(RAW_DIR, `${src.tipo}-${String(p).padStart(3, '0')}.geojson`);
    let pageFeatures;
    if (await exists(pagePath)) {
      pageFeatures = JSON.parse(await readFile(pagePath, 'utf8'));
      log(`${src.label}: página ${p + 1}/${pages} (${pageFeatures.length} features) — desde caché`);
    } else {
      pageFeatures = await fetchPage(src.service, offset);
      await writeFile(pagePath, JSON.stringify(pageFeatures));
      log(`${src.label}: página ${p + 1}/${pages} (${pageFeatures.length} features) — descargada`);
      // Pausa corta entre páginas para no quemar el server estatal.
      if (p < pages - 1) await sleep(500);
    }
    // Inyectamos `tipo` en cada feature (el ETL lo agrega, no viene del server).
    for (const f of pageFeatures) {
      if (f.properties) f.properties.tipo = src.tipo;
      features.push(f);
    }
  }
  return features;
}

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
}

function simplify() {
  log(`simplificando (${SIMPLIFY}, precision=${PRECISION})…`);
  const fields = [...KEEP_FIELDS, 'tipo'].join(',');
  const args = [
    mapshaperBin(),
    COMBINED_RAW,
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

async function writeMeta(featureCount, counts) {
  const meta = {
    sources: SOURCES.map((s) => s.name),
    portal: 'DGA — ArcGIS REST (services3.arcgis.com/aSoEm9TBK2shtWjP)',
    service_urls: SOURCES.map((s) => s.service),
    catalog: 'https://dga.mop.gob.cl/',
    license:
      'Dato público institucional (Estado de Chile, Dirección General de Aguas MOP). ' +
      'La DGA distribuye los datos en cumplimiento de la Ley 20.285 (Transparencia); ' +
      'atribución obligatoria a la DGA en popup, panel y este manifiesto.',
    downloaded_at: new Date().toISOString().slice(0, 10),
    feature_count: featureCount,
    counts_by_tipo: counts,
    crs: 'EPSG:4326 (reproyectado server-side desde EPSG:32719 vía outSR)',
    fields: [...KEEP_FIELDS, 'tipo'],
    processing:
      `paginación ${PAGE_SIZE} features/request con backoff ${BACKOFF_MS.join('/')} ms sobre ` +
      `${SOURCES.length} FeatureServers de la DGA (Ríos + Esteros); combinado en un único ` +
      `FeatureCollection con campo derivado \`tipo\` ∈ {rio, estero}; ` +
      `mapshaper -filter-fields ${[...KEEP_FIELDS, 'tipo'].join(',')} ` +
      `-simplify ${SIMPLIFY} precision=${PRECISION}.`,
    mapshaper_version: mapshaperVersion(),
    note:
      'Dato público oficial (Dirección General de Aguas, Ministerio de Obras Públicas — ' +
      'Banco Nacional de Aguas, ríos y esteros con nombre oficial). Geometría simplificada ' +
      'solo para visualización web: el trazado mostrado es referencial. La DGA publica el mismo ' +
      'dato en su Mapoteca Digital (portal HTML en dga.mop.gob.cl), pero esa URL devuelve 404 ' +
      'desde 2026 — el FeatureServer ArcGIS es la única vía estable hoy. Para análisis o uso ' +
      'normativo, consultar la fuente original.',
  };
  await writeFile(OUT_META, JSON.stringify(meta, null, 2) + '\n');
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  let allFeatures;
  if (await exists(COMBINED_RAW)) {
    log(`combinado crudo ya en caché, omitiendo descarga`);
    allFeatures = JSON.parse(await readFile(COMBINED_RAW, 'utf8')).features ?? [];
  } else {
    const all = [];
    const counts = {};
    for (const src of SOURCES) {
      const features = await downloadService(src);
      counts[src.tipo] = features.length;
      all.push(...features);
    }
    const fc = { type: 'FeatureCollection', features: all };
    await writeFile(COMBINED_RAW, JSON.stringify(fc));
    allFeatures = all;
    log(`combinado: ${allFeatures.length} features`);
    Object.entries(counts).forEach(([t, n]) => log(`  ${t}: ${n}`));
  }

  simplify();

  const gj = JSON.parse(await readFile(OUT_GEOJSON, 'utf8'));
  const counts = {};
  for (const f of gj.features ?? []) {
    const t = f.properties?.tipo ?? '?';
    counts[t] = (counts[t] ?? 0) + 1;
  }
  await writeMeta(gj.features?.length ?? 0, counts);

  const { size } = await stat(OUT_GEOJSON);
  log(`listo: ${gj.features.length} tramos · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[red-drenaje] ERROR:', err.message);
  process.exit(1);
});
