#!/usr/bin/env node
/**
 * ETL reproducible — Capa Catastro Frutícola de Chile (CIREN-ODEPA).
 *
 * Consulta el servicio público ArcGIS REST que CIREN hospeda en su portal IDE
 * Minagri (esri.ciren.cl), concretamente el MapServer "CATASTRO_FRUTICOLA" del
 * directorio IDEMINAGRI: 14 capas regionales (una por región de Chile) de
 * PRODUCTORES FRUTÍCOLAS con la geometría (polígono) del huerto y la especie
 * declarada (1 a 4 especies por potrero, con sus respectivos campos
 * `especie_01` … `especie_04`). El servicio soporta `f=geojson` + `outSR=4326`,
 * así que la reproyección se hace server-side y no hace falta zip local.
 *
 * Cada consulta ArcGIS REST devuelve como máximo 2000 features
 * (`maxRecordCount=2000`), por lo que el ETL pagina con `resultOffset`
 * iterando hasta agotar la capa (`exceededTransferLimit` o batch incompleto).
 * Las 14 capas se concatenan en un único FeatureCollection, extrayendo el
 * vintage (año CIREN, p.ej. 2024) del nombre del layer — esa información no
 * viene en los atributos, solo en el nombre — y se lo agrega como propiedad
 * `vintage` de cada feature para que el popup y el panel puedan mostrarla.
 *
 * Luego mapshaper simplifica preservando topología (los polígonos vecinos
 * siguen calzando) y filtra atributos a los útiles: códigos SUBDERE (región,
 * provincia, comuna), nombre de comuna, ROL del predio y hasta 4 especies
 * declaradas. El archivo final se sirve como `public/data/catastro-fruticola
 * .geojson` con su manifiesto de procedencia en `meta.json`.
 *
 * Uso:  npm run data:build:catastro-fruticola
 *
 * El FeatureCollection crudo concatenado queda en scripts/.cache/
 * (ignorado por git). Solo se versionan la salida simplificada y el meta.
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

// --- Fuente oficial -------------------------------------------------------
// Servicio público de CIREN/IDE Minagri (access:"public"). MapServer con un
// grupo "PRODUCTORES FRUTÍCOLAS" (parentLayerId 54) y 14 sublayers regionales
// (ids 55–68). El endpoint `layers?f=json` los enumera — ver `discoverLayers`.
const SERVICE_BASE = 'https://esri.ciren.cl/server/rest/services/IDEMINAGRI/CATASTRO_FRUTICOLA/MapServer';

const SOURCE = {
  name: 'CIREN — Catastro Frutícola (CIREN-ODEPA), productores frutícolas',
  portal: 'IDE Minagri (esri.ciren.cl)',
  url: SERVICE_BASE,
  license:
    'Dato público oficial del Estado de Chile (CIREN, Centro de Información de Recursos Naturales — Ministerio de Agricultura). ' +
    'Levantamiento conjunto CIREN-ODEPA, cobertura regional rotativa. El shapefile empaquetado se comercializa por CIREN; ' +
    'el servicio público MapServer del IDE Minagri se publica en línea y es de libre consulta.',
};

// Atributos a conservar del dataset oficial (nombres originales de la fuente,
// en minúsculas como los entrega el servicio CIREN). `objectid`/`mslink` se
// descartan a propósito: son ids internos sin valor para el usuario. El
// `vintage` se inyecta desde el nombre del layer (no viene en atributos).
//
// Cada capa regional tiene su propio esquema: algunas traen `especie_02/03/04`,
// otras sólo `especie_01` (Atacama, La Araucanía, Los Ríos, Los Lagos). El
// endpoint exige outFields exacto y rechaza campos inexistentes con HTTP 400,
// así que se conserva el mínimo común (BASE) y se agrega cada especie
// opcional solo cuando la capa la expone. El campo `especie_01` (la especie
// principal del potrero) está en las 14 capas y es el pivote del popup.
const KEEP_FIELDS_BASE = [
  'desccomu',
  'rolpredi',
  'especie_01',
  'regidere',
  'comudere',
  'provdere',
  'vintage',
];
const KEEP_FIELDS_OPTIONAL = ['especie_02', 'especie_03', 'especie_04'];
// KEEP_FIELDS_BASE siempre presente; los OPTIONAL se agregan solo cuando la
// capa los trae — la intersección la hace discoverLayers() por capa.
const KEEP_FIELDS = KEEP_FIELDS_BASE;

// Cada productor es un potrero o grupo de potreros — los polígonos pueden
// ser pequeños (huertos de pocos ha con curvas suaves). Con ~95k features
// nacionales el 1.5% queda en ~30 MB (sobre el techo del proyecto); 3%
// preservando topología cabe en ~10–15 MB manteniendo formas reconocibles
// a los zooms de uso (~10–16). Si se quiere aún más compacto, evaluar
// partición regional (cargar por viewport como CIREN-Suelos).
const SIMPLIFY = 'visvalingam weighted 3% keep-shapes';
const PRECISION = 0.00001;

// El servicio limita a 2000 features por consulta; se pagina con este offset.
const PAGE_SIZE = 2000;
const RETRY_AFTER_MS = 5000;
const MAX_RETRIES = 4;

const RAW_GEOJSON = join(CACHE, 'catastro-fruticola-raw.geojson');
const OUT_GEOJSON = join(OUT_DIR, 'catastro-fruticola.geojson');
const OUT_META = join(OUT_DIR, 'catastro-fruticola.meta.json');

const log = (...a) => console.log('[catastro-fruticola]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Pausa entre reintentos (los servidores CIREN/MOP se degradan bajo ráfaga). */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Descubre los sublayers del grupo "PRODUCTORES FRUTÍCOLAS" (parentLayerId 54)
 * y devuelve un array ordenado por id con `{ id, name, vintage, fields }`. El
 * vintage se extrae del nombre del layer con regex `(CIREN YYYY)` — el patrón
 * que usa CIREN en este servicio. `fields` es la intersección de KEEP_FIELDS
 * con los campos que efectivamente expone la capa (cada regional tiene su
 * propio esquema: algunas traen especie_03/04, otras no; sin outFields el
 * endpoint responde HTTP 400). Usa el endpoint raíz del MapServer (que
 * expone la jerarquía completa con `parentLayerId`); el endpoint
 * `/layers?f=json` devuelve otra forma sin ese campo.
 */
async function discoverLayers() {
  const rootRes = await fetch(`${SERVICE_BASE}?f=json`);
  if (!rootRes.ok) throw new Error(`discoverLayers root HTTP ${rootRes.status}`);
  const root = await rootRes.json();
  const producers = (root.layers || []).filter(
    (l) => l.parentLayerId === 54 && l.geometryType === 'esriGeometryPolygon',
  );
  const wanted = new Set([...KEEP_FIELDS_BASE, ...KEEP_FIELDS_OPTIONAL]);
  // Para cada capa, fetch su metadata (/{id}?f=json) e intersectar fields.
  const out = [];
  for (const l of producers) {
    const m = /CIREN\s+(\d{4})/.exec(l.name || '');
    const metaRes = await fetch(`${SERVICE_BASE}/${l.id}?f=json`);
    if (!metaRes.ok) {
      log(`  metadata capa ${l.id}: HTTP ${metaRes.status}, saltando`);
      continue;
    }
    const meta = await metaRes.json();
    const available = new Set((meta.fields || []).map((f) => f.name));
    const fields = [...wanted].filter((k) => available.has(k));
    out.push({ id: l.id, name: l.name, vintage: m ? Number(m[1]) : null, fields });
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Pagina una capa regional con `resultOffset` hasta agotar features. Devuelve
 * el array de features (geometría + propiedades) ya en WGS84. Reintenta con
 * backoff si el servicio responde 5xx o se degrada.
 *
 * `outFields` se calcula por capa en discoverLayers() intersectando con el
 * esquema efectivo: cada regional CIREN tiene su propio set (algunas con
 * especie_03/04, otras no). Pedir un campo inexistente devuelve HTTP 400.
 */
async function fetchLayer(layerId, vintage, outFields) {
  const features = [];
  let offset = 0;
  for (;;) {
    let attempt = 0;
    let batch;
    while (attempt < MAX_RETRIES) {
      attempt++;
      const params = new URLSearchParams({
        where: '1=1',
        outFields: outFields.join(','),
        outSR: '4326',
        f: 'geojson',
        resultRecordCount: String(PAGE_SIZE),
        resultOffset: String(offset),
      });
      const url = `${SERVICE_BASE}/${layerId}/query?${params}`;
      const res = await fetch(url);
      if (!res.ok) {
        log(`  capa ${layerId}: HTTP ${res.status} (intento ${attempt}/${MAX_RETRIES})`);
        await sleep(RETRY_AFTER_MS * attempt);
        continue;
      }
      batch = await res.json();
      if (batch.error) {
        log(`  capa ${layerId}: error ${JSON.stringify(batch.error)} (intento ${attempt})`);
        await sleep(RETRY_AFTER_MS * attempt);
        continue;
      }
      break;
    }
    if (!batch || !Array.isArray(batch.features)) {
      throw new Error(`capa ${layerId}: respuesta inválida tras ${MAX_RETRIES} reintentos`);
    }
    for (const f of batch.features) {
      f.properties = { ...(f.properties || {}), vintage };
    }
    features.push(...batch.features);
    const got = batch.features.length;
    if (got < PAGE_SIZE || !batch.exceededTransferLimit) break;
    offset += got;
    log(`  capa ${layerId}: +${got} (acumulado ${features.length})…`);
    await sleep(150);
  }
  return features;
}

async function download() {
  if (await exists(RAW_GEOJSON)) {
    log('GeoJSON crudo ya en caché, omitiendo descarga');
    return;
  }
  log('descubriendo capas regionales en el servicio CIREN…');
  const layers = await discoverLayers();
  if (layers.length === 0) {
    throw new Error('No se encontraron sublayers del grupo PRODUCTORES FRUTÍCOLAS');
  }
  log(`encontradas ${layers.length} capas regionales (vintages: ${layers.map((l) => l.vintage).join(', ')})`);

  const allFeatures = [];
  for (const layer of layers) {
    log(`capa ${layer.id} (CIREN ${layer.vintage}, fields=${layer.fields.join(',')}): descargando…`);
    const feats = await fetchLayer(layer.id, layer.vintage, layer.fields);
    log(`capa ${layer.id}: ${feats.length} productores`);
    allFeatures.push(...feats);
    await sleep(300);
  }

  const collection = {
    type: 'FeatureCollection',
    features: allFeatures,
  };
  await writeFile(RAW_GEOJSON, JSON.stringify(collection));
  log(`descarga completa: ${allFeatures.length} productores en total`);
}

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
}

function simplify() {
  log(`simplificando (${SIMPLIFY}, precision=${PRECISION})…`);
  const args = [
    mapshaperBin(),
    RAW_GEOJSON,
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
    portal: SOURCE.portal,
    license: SOURCE.license,
    downloaded_at: new Date().toISOString().slice(0, 10),
    feature_count: featureCount,
    crs: 'EPSG:4326 (reproyectado server-side desde EPSG:102100 vía outSR=4326)',
    fields: KEEP_FIELDS,
    field_notes:
      'regidere/comudere/provdere son los códigos oficiales SUBDERE. rolpredi es el ROL del predio (pivote con CBR). ' +
      'especie_01 es la especie principal declarada por potrero; especie_02/03/04 existen sólo en algunas capas ' +
      'regionales (Atacama, La Araucanía, Los Ríos y Los Lagos sólo traen especie_01) y se omiten aquí para ' +
      'mantener un esquema uniforme. vintage es el año CIREN del catastro regional.',
    processing:
      `MapServer CIREN /query paginado con resultOffset (PAGE_SIZE=${PAGE_SIZE}) sobre los 14 sublayers ` +
      `del grupo PRODUCTORES FRUTÍCOLAS (parentLayerId 54); vintage extraído del nombre de cada layer con regex ` +
      `(CIREN YYYY) e inyectado como propiedad; mapshaper -filter-fields ${KEEP_FIELDS.join(',')} ` +
      `-simplify ${SIMPLIFY} precision=${PRECISION}.`,
    mapshaper_version: mapshaperVersion(),
    coverage:
      '14 regiones administrativas de Chile (Arica y Parinacota a Aysén; Magallanes y la Antártica Chilena sin catastro frutícola). ' +
      'Cobertura rotativa: cada región se levanta cada ~5 años; los vintages por región se conservan en cada feature.',
    pii:
      'No contiene PII (Ley 19.628): solo ROL público (SII), códigos SUBDERE y nombres de especie. ' +
      'El "Productor con razón social" que CIREN incluye en su producto comercial NO está en esta capa.',
    note:
      'Dato público oficial (CIREN, IDE Minagri). Geometría simplificada solo para visualización web. ' +
      'Para uso normativo o análisis detallado, consultar el producto "Catastro Frutícola" en ciren.cl.',
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
  log(`listo: ${count} productores · ${(size / 1024 / 1024).toFixed(1)} MB`);
  log(`salida: ${OUT_GEOJSON}`);
  log(`manifiesto: ${OUT_META}`);
}

main().catch((err) => {
  console.error('[catastro-fruticola] ERROR:', err.message);
  process.exit(1);
});