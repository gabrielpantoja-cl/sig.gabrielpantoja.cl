#!/usr/bin/env node
/**
 * Carga las capas oficiales en PostGIS (esquema `capas`) para los geoprocesos
 * de la ficha del predio (`/api/analisis/predio`).
 *
 *   npm run data:load:postgis               → todas las capas
 *   npm run data:load:postgis -- comunas    → solo una (o varias, separadas)
 *
 * Requiere ETL_DATABASE_URL (rol `etl_writer`, ver db/capas.sql) en el entorno
 * o en .env.local. Nunca usa NEON_DATABASE_URL: ese rol es de solo lectura.
 *
 * Diferencia clave con los `build-*.mjs`: aquí la geometría va SIN SIMPLIFICAR.
 * El GeoJSON de public/data está simplificado para DIBUJAR (Visvalingam
 * 1,5-5 %); para MEDIR la superficie de una intersección eso introduce errores
 * del orden de hectáreas en predios rurales. Se parte del dato crudo que los
 * build-*.mjs dejan en scripts/.cache/: si falta, se pide correr el build.
 *
 * Carga atómica: cada capa va en UNA transacción que escribe
 * `capas.<tabla>__carga`, la valida y recién al final borra la vigente y la
 * renombra, junto con su fila en `capas.fuentes` (fuente, licencia, fecha de
 * descarga → trazabilidad de la ficha). La tabla vigente solo se bloquea en
 * ese último paso; si algo falla antes, ROLLBACK y queda intacta.
 *
 * Cada polígono se guarda TROCEADO con ST_Subdivide (≤ 256 vértices por fila,
 * `fid` = feature original). Un parque marino o un litoral de fiordos tiene
 * millones de vértices: intersectarlo entero contra un predio en cada consulta
 * cuesta segundos, mientras que el índice GiST sobre trozos chicos descarta
 * casi todo y ST_Intersection trabaja con unos pocos cientos de vértices. Los
 * trozos no se solapan, así que sumar áreas por `fid` da el área exacta.
 *
 * Node 22 (`nvm use`): el Pool usa el WebSocket global de Node.
 */

import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const DATA = join(ROOT, 'public', 'data');

/** ~1e-6° ≈ 10 cm: muy por debajo del error de cualquier fuente oficial. */
const PRECISION = 0.000001;
/**
 * Tamaño objetivo de cada INSERT (JSON). Un solo polígono puede pesar más (las
 * áreas protegidas con litoral de fiordos llegan a ~44 MB sin simplificar):
 * ese va solo. Por eso la carga usa el Pool por WebSocket (protocolo Postgres)
 * y no el driver HTTP, que no acepta cuerpos de ese tamaño.
 */
const BATCH_BYTES = 8_000_000;
/** Vértices máximos por trozo (ST_Subdivide). 256 es el punto dulce habitual. */
const MAX_VERTICES = 256;

const log = (...a) => console.log('[load-postgis]', ...a);

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Busca recursivamente el shapefile de comunas dentro del zip extraído. */
async function findShp(dir, pattern) {
  if (!(await exists(dir))) return null;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findShp(p, pattern);
      if (found) return found;
    } else if (pattern.test(entry.name) && entry.name.toLowerCase().endsWith('.shp')) {
      return p;
    }
  }
  return null;
}

/**
 * Catálogo de capas. `columns` mapea propiedad de la fuente → columna SQL; los
 * nombres son constantes de este archivo (nunca datos), así que interpolarlos
 * en el SQL es seguro. Los VALORES siempre van parametrizados.
 */
const CAPAS = {
  comunas: {
    table: 'comunas',
    meta: 'limites-comunales.meta.json',
    build: 'npm run data:build:comunas',
    raw: () => findShp(join(CACHE, 'dpa-2023'), /comuna/i),
    reproject: true,
    columns: [
      ['CUT_COM', 'cut_com', 'text'],
      ['COMUNA', 'comuna', 'text'],
      ['CUT_PROV', 'cut_prov', 'text'],
      ['PROVINCIA', 'provincia', 'text'],
      ['CUT_REG', 'cut_reg', 'text'],
      ['REGION', 'region', 'text'],
    ],
  },
  'limite-urbano': {
    table: 'limite_urbano',
    meta: 'limite-urbano.meta.json',
    build: 'npm run data:build:urban',
    raw: async () => {
      const p = join(CACHE, 'limite-urbano-raw.geojson');
      return (await exists(p)) ? p : null;
    },
    reproject: false,
    columns: [
      ['COM', 'comuna', 'text'],
      ['NOM', 'nombre', 'text'],
      ['INSTRUM', 'instrumento', 'text'],
      ['ADMIN', 'administra', 'text'],
      ['P_DO', 'publicacion_do', 'text'],
      ['N_DO', 'numero_do', 'text'],
      ['T_DO', 'tipo_do', 'text'],
    ],
  },
  'areas-protegidas': {
    table: 'areas_protegidas',
    meta: 'areas-protegidas.meta.json',
    build: 'npm run data:build:protected',
    raw: async () => {
      const p = join(CACHE, 'Areas Protegidas.geojson');
      return (await exists(p)) ? p : null;
    },
    reproject: false,
    columns: [
      ['cod_rnap', 'cod_rnap', 'text'],
      ['nombre_ap', 'nombre', 'text'],
      ['designacion_ap', 'designacion', 'text'],
      ['region', 'region', 'text'],
      ['ha', 'ha_oficial', 'double precision'],
      ['url_fuente', 'url_fuente', 'text'],
    ],
  },
};

function mapshaperBin() {
  const require = createRequire(import.meta.url);
  return require.resolve('mapshaper/bin/mapshaper');
}

/** Dato crudo → NDJSON en WGS84, con solo los campos del catálogo, sin simplificar. */
function toNdjson(capa, rawPath, outPath) {
  const args = [mapshaperBin(), rawPath];
  if (capa.reproject) args.push('-proj', 'wgs84');
  args.push(
    '-filter-fields',
    capa.columns.map(([src]) => src).join(','),
    '-o',
    'force',
    'format=geojson',
    'ndjson',
    `precision=${PRECISION}`,
    outPath,
  );
  execFileSync('node', ['--max-old-space-size=8192', ...args], { stdio: 'inherit' });
}

async function* batches(path) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let batch = [];
  let bytes = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    if (bytes + line.length > BATCH_BYTES && batch.length > 0) {
      yield batch;
      batch = [];
      bytes = 0;
    }
    batch.push(line);
    bytes += line.length;
  }
  if (batch.length > 0) yield batch;
}

async function load(pool, key) {
  const capa = CAPAS[key];
  const rawPath = await capa.raw();
  if (!rawPath) {
    throw new Error(`[${key}] falta el dato crudo en scripts/.cache/. Corre primero: ${capa.build}`);
  }
  const meta = JSON.parse(await readFile(join(DATA, capa.meta), 'utf8'));

  await mkdir(CACHE, { recursive: true });
  const ndjson = join(CACHE, `postgis-${key}.ndjson`);
  log(`${key}: convirtiendo ${rawPath} (sin simplificar)…`);
  toNdjson(capa, rawPath, ndjson);

  const t = `capas.${capa.table}`;
  const staging = `capas.${capa.table}__carga`;
  const colDefs = capa.columns.map(([, col, type]) => `${col} ${type}`).join(', ');
  const colNames = capa.columns.map(([, col]) => col).join(', ');
  const colValues = capa.columns
    .map(([src, , type]) => {
      const v = `NULLIF(btrim(f->'properties'->>'${src}'), '')`;
      return type === 'text' ? v : `${v}::${type}`;
    })
    .join(', ');

  const client = await pool.connect();
  let n;
  try {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS ${staging}`);
    await client.query(
      `CREATE TABLE ${staging} (
         id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
         fid integer NOT NULL,
         ${colDefs},
         geom geometry(MultiPolygon, 4326) NOT NULL
       )`,
    );

    let leidas = 0;
    for await (const batch of batches(ndjson)) {
      // ST_MakeValid + CollectionExtract(…, 3): los polígonos oficiales traen
      // autointersecciones y anillos tocándose; sin repararlos, ST_Intersection
      // falla («TopologyException») justo en la consulta del usuario.
      await client.query(
        `INSERT INTO ${staging} (fid, ${colNames}, geom)
         SELECT fid, ${colValues}, ST_Multi(ST_Subdivide(g, ${MAX_VERTICES}))
         FROM (
           SELECT $2::int + ord::int AS fid, f,
                  ST_CollectionExtract(ST_MakeValid(
                    ST_SetSRID(ST_GeomFromGeoJSON(f->'geometry'), 4326)), 3) AS g
           FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS e(f, ord)
           WHERE jsonb_typeof(f->'geometry') = 'object'
         ) s
         WHERE NOT ST_IsEmpty(g)`,
        [`[${batch.join(',')}]`, leidas],
      );
      leidas += batch.length;
      process.stdout.write(`\r[load-postgis] ${key}: ${leidas} features enviadas`);
    }
    process.stdout.write('\n');

    ({ rows: [{ n }] } = await client.query(`SELECT count(DISTINCT fid)::int AS n FROM ${staging}`));
    if (n === 0) throw new Error(`[${key}] 0 filas cargadas; se conserva la tabla vigente`);
    if (n < leidas * 0.95) {
      throw new Error(`[${key}] solo ${n} de ${leidas} features con geometría válida; revisar la fuente`);
    }

    await client.query(`CREATE INDEX ${capa.table}__carga_geom_idx ON ${staging} USING gist (geom)`);
    await client.query(`CREATE INDEX ${capa.table}__carga_fid_idx ON ${staging} (fid)`);
    await client.query(`GRANT SELECT ON ${staging} TO web_readonly`);

    const procesamiento =
      `mapshaper ${capa.reproject ? '-proj wgs84 ' : ''}-filter-fields ` +
      `${capa.columns.map(([src]) => src).join(',')} precision=${PRECISION} (sin simplificar); ` +
      `PostGIS ST_MakeValid + ST_CollectionExtract(3) + ST_Subdivide(${MAX_VERTICES})`;

    await client.query(`CREATE TABLE IF NOT EXISTS capas.fuentes (
                          capa text PRIMARY KEY,
                          fuente text NOT NULL,
                          url text,
                          licencia text,
                          descargado date,
                          cargado timestamptz NOT NULL DEFAULT now(),
                          n integer NOT NULL,
                          procesamiento text
                        )`);
    await client.query('GRANT SELECT ON capas.fuentes TO web_readonly');
    await client.query(`DROP TABLE IF EXISTS ${t}`);
    await client.query(`ALTER TABLE ${staging} RENAME TO ${capa.table}`);
    await client.query(`ALTER INDEX capas.${capa.table}__carga_geom_idx RENAME TO ${capa.table}_geom_idx`);
    await client.query(`ALTER INDEX capas.${capa.table}__carga_fid_idx RENAME TO ${capa.table}_fid_idx`);
    await client.query(`ALTER TABLE ${t} RENAME CONSTRAINT ${capa.table}__carga_pkey TO ${capa.table}_pkey`);
    await client.query(
      `INSERT INTO capas.fuentes (capa, fuente, url, licencia, descargado, cargado, n, procesamiento)
       VALUES ($1, $2, $3, $4, $5::date, now(), $6, $7)
       ON CONFLICT (capa) DO UPDATE SET
         fuente = EXCLUDED.fuente, url = EXCLUDED.url, licencia = EXCLUDED.licencia,
         descargado = EXCLUDED.descargado, cargado = EXCLUDED.cargado,
         n = EXCLUDED.n, procesamiento = EXCLUDED.procesamiento`,
      [
        capa.table,
        meta.source,
        meta.source_url ?? null,
        meta.license ?? null,
        /^\d{4}-\d{2}-\d{2}$/.test(meta.downloaded_at ?? '') ? meta.downloaded_at : null,
        n,
        procesamiento,
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // ANALYZE fuera de la transacción: estadísticas frescas para el planificador.
  await pool.query(`ANALYZE ${t}`);
  const {
    rows: [{ mb }],
  } = await pool.query(`SELECT round(pg_total_relation_size('${t}') / 1048576.0, 1)::float AS mb`);
  log(`${key}: ${n} polígonos en ${t} (${mb} MB con índices)`);
}

async function databaseUrl() {
  if (process.env.ETL_DATABASE_URL) return process.env.ETL_DATABASE_URL;
  try {
    const env = await readFile(join(ROOT, '.env.local'), 'utf8');
    const m = env.match(/^ETL_DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    // sin .env.local
  }
  return null;
}

async function main() {
  const url = await databaseUrl();
  if (!url) {
    console.error('Falta ETL_DATABASE_URL (rol etl_writer, ver db/capas.sql).');
    process.exit(1);
  }
  const pedidas = process.argv.slice(2);
  const claves = pedidas.length > 0 ? pedidas : Object.keys(CAPAS);
  const desconocidas = claves.filter((k) => !(k in CAPAS));
  if (desconocidas.length > 0) {
    console.error(`Capa desconocida: ${desconocidas.join(', ')}. Opciones: ${Object.keys(CAPAS).join(', ')}`);
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  try {
    for (const key of claves) await load(pool, key);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
