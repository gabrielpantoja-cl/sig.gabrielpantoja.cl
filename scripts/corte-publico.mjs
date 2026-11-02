#!/usr/bin/env node
/**
 * corte-publico.mjs — Construye el corte público verificable del registro CBR.
 *
 * Genera un paquete autocontenido con los datos sin PII, un manifiesto con el
 * SHA-256 de cada archivo y la raíz de Merkle de las filas, y lo compara con el
 * corte anterior para detectar modificaciones silenciosas.
 *
 * Diseño en docs/preservacion-datos.md.
 *
 *   node scripts/corte-publico.mjs [--salida <dir>] [--limite N]
 *
 * Requiere NEON_DATABASE_URL (se lee de .env.local si no está en el entorno).
 *
 * Lee la tabla completa, asi que es un trabajo PERIODICO (mensual o trimestral),
 * no continuo. Usa --limite para probar el pipeline sin leerla entera.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

// --- configuración ---------------------------------------------------------

/**
 * Columnas del corte. El orden es parte del contrato de canonicalización:
 * cambiarlo cambia la raíz de Merkle de todas las filas. Si alguna vez hay que
 * añadir una columna, va AL FINAL y se sube la versión del corte.
 *
 * `id` se publica a propósito: sin un identificador estable no se puede emitir
 * una prueba de inclusión para una fila concreta.
 *
 * Nunca se incluyen comprador, vendedor, rut, userId ni observaciones
 * (Ley 19.628). `rol` sí es público: identificador del SII, no dato personal.
 */
const COLUMNAS = [
  'id', 'lat', 'lng', 'monto', 'montoUf', 'anio', 'comuna', 'predio',
  'superficie', 'rol', 'destino', 'fechaEscritura', 'fechaInscripcion',
  'fojas', 'numero', 'conservador',
];

const VERSION_CORTE = 1;

const SQL_REFERENCIALES = `
  SELECT r.id,
         r.lat, r.lng, r.monto, r."montoUf", r.anio, r.comuna, r.predio,
         r."superficieTerreno" AS superficie, r.rol, r.destino,
         r.fechaescritura::text     AS "fechaEscritura",
         r."fechaInscripcion"::text AS "fechaInscripcion",
         r.fojas, r.numero,
         c.nombre AS conservador
  FROM referenciales r
  LEFT JOIN conservadores c ON c.id = r."conservadorId"
  ORDER BY r.id
`;

const SQL_CONSERVADORES = `
  SELECT id, nombre, comuna, region
  FROM conservadores
  ORDER BY id
`;

// --- canonicalización ------------------------------------------------------

/**
 * Serializa un valor de forma determinista e inyectiva.
 *
 * Reglas, y la razón de cada una:
 * - NULL y undefined → `\N`. Un NULL y la cadena vacía NO son lo mismo.
 * - Números: `Number.prototype.toString()` tras normalizar el -0 a 0. Produce
 *   la representación decimal más corta que round-trips exactamente, así que es
 *   estable entre versiones de Node y entre plataformas.
 * - Texto: se escapan `\` y los separadores, para que ningún contenido pueda
 *   fabricar un límite de campo falso (si no, dos filas distintas podrían
 *   canonicalizarse igual y la raíz dejaría de ser inyectiva).
 */
function canonizarValor(v) {
  if (v === null || v === undefined) return '\\N';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`valor numérico no finito: ${v}`);
    return Object.is(v, -0) ? '0' : String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 't' : 'f';
  return String(v)
    .replaceAll('\\', '\\\\')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

/** Fila canónica: columnas en orden fijo, separadas por tabulador. */
export function canonizarFila(fila, columnas = COLUMNAS) {
  return columnas.map((c) => canonizarValor(fila[c])).join('\t');
}

const sha256 = (dato) => createHash('sha256').update(dato).digest();

/** Hoja del árbol: SHA-256 de la fila canónica en UTF-8. */
export function hoja(fila, columnas = COLUMNAS) {
  return sha256(Buffer.from(canonizarFila(fila, columnas), 'utf8'));
}

/**
 * Raíz de Merkle binaria sobre las hojas, en orden.
 *
 * Un nivel impar DUPLICA el último nodo (patrón de Bitcoin). Es conocido que
 * esto permite colisiones de árbol (CVE-2012-2459) cuando el número de hojas no
 * está fijado; acá no es explotable porque el manifiesto publica `n_filas`
 * junto a la raíz, así que el número de hojas es parte de lo que se verifica.
 */
export function raizMerkle(hojas) {
  if (hojas.length === 0) return Buffer.alloc(32);
  let nivel = hojas;
  while (nivel.length > 1) {
    const siguiente = [];
    for (let i = 0; i < nivel.length; i += 2) {
      const izq = nivel[i];
      const der = i + 1 < nivel.length ? nivel[i + 1] : izq;
      siguiente.push(sha256(Buffer.concat([izq, der])));
    }
    nivel = siguiente;
  }
  return nivel[0];
}

/** Prueba de inclusión de la hoja `indice`: los hermanos desde la hoja a la raíz. */
export function pruebaInclusion(hojas, indice) {
  const ruta = [];
  let nivel = hojas;
  let i = indice;
  while (nivel.length > 1) {
    const esDerecho = i % 2 === 1;
    const hermanoIdx = esDerecho ? i - 1 : Math.min(i + 1, nivel.length - 1);
    ruta.push({ lado: esDerecho ? 'izq' : 'der', hash: nivel[hermanoIdx].toString('hex') });
    const siguiente = [];
    for (let j = 0; j < nivel.length; j += 2) {
      const izq = nivel[j];
      const der = j + 1 < nivel.length ? nivel[j + 1] : izq;
      siguiente.push(sha256(Buffer.concat([izq, der])));
    }
    nivel = siguiente;
    i = Math.floor(i / 2);
  }
  return ruta;
}

/** Verifica una prueba de inclusión. Lo que correría un tercero. */
export function verificarInclusion(hashHoja, ruta, raizHex) {
  let acc = Buffer.from(hashHoja, 'hex');
  for (const { lado, hash } of ruta) {
    const otro = Buffer.from(hash, 'hex');
    acc = sha256(lado === 'izq' ? Buffer.concat([otro, acc]) : Buffer.concat([acc, otro]));
  }
  return acc.toString('hex') === raizHex;
}

// --- salida ----------------------------------------------------------------

function aCsv(filas, columnas) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lineas = [columnas.join(',')];
  for (const f of filas) lineas.push(columnas.map((c) => esc(f[c])).join(','));
  return lineas.join('\n') + '\n';
}

function aGeoJson(filas) {
  return {
    type: 'FeatureCollection',
    features: filas
      .filter((f) => f.lat != null && f.lng != null)
      .map((f) => {
        const props = {};
        for (const c of COLUMNAS) if (c !== 'lat' && c !== 'lng') props[c] = f[c];
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [Number(f.lng), Number(f.lat)] },
          properties: props,
        };
      }),
  };
}

/** Normaliza lo que entrega el driver a tipos JS estables antes de canonizar. */
function normalizar(f) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return {
    id: f.id ?? null,
    lat: num(f.lat), lng: num(f.lng),
    monto: num(f.monto), montoUf: num(f.montoUf), anio: num(f.anio),
    comuna: f.comuna ?? null, predio: f.predio ?? null,
    superficie: num(f.superficie),
    rol: f.rol ?? null, destino: f.destino ?? null,
    fechaEscritura: f.fechaEscritura ?? null,
    fechaInscripcion: f.fechaInscripcion ?? null,
    fojas: f.fojas ?? null, numero: f.numero ?? null,
    conservador: f.conservador ?? null,
  };
}

async function escribir(dir, nombre, contenido, manifiesto) {
  const buf = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8');
  await writeFile(path.join(dir, nombre), buf);
  manifiesto.archivos[nombre] = {
    bytes: buf.length,
    sha256: sha256(buf).toString('hex'),
  };
  console.log(`  ${nombre.padEnd(26)} ${String(buf.length).padStart(12)} B`);
}

// --- principal -------------------------------------------------------------

function cargarEnv() {
  if (process.env.NEON_DATABASE_URL) return;
  const env = path.resolve('.env.local');
  if (!existsSync(env)) return;
  for (const linea of readFileSync(env, 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const salida = path.resolve(args[args.indexOf('--salida') + 1] ?? 'corte');
  const limite = args.includes('--limite') ? Number(args[args.indexOf('--limite') + 1]) : null;

  cargarEnv();
  if (!process.env.NEON_DATABASE_URL) {
    console.error('Falta NEON_DATABASE_URL (entorno o .env.local).');
    process.exit(1);
  }

  const sql = neon(process.env.NEON_DATABASE_URL);
  await mkdir(salida, { recursive: true });

  console.log('Leyendo el registro...');
  const crudas = await sql.query(limite ? `${SQL_REFERENCIALES} LIMIT ${limite}` : SQL_REFERENCIALES);
  const filas = crudas.map(normalizar);
  const conservadores = await sql.query(SQL_CONSERVADORES);
  console.log(`  ${filas.length} transacciones · ${conservadores.length} conservadores`);

  console.log('Calculando hojas y raíz de Merkle...');
  const hojas = filas.map((f) => hoja(f));
  const raiz = raizMerkle(hojas).toString('hex');

  const geo = filas.filter((f) => f.lat != null && f.lng != null).length;
  const anios = filas.map((f) => f.anio).filter((a) => a != null);

  const manifiesto = {
    nombre: 'Registro de transacciones de suelo (CBR Chile) — corte público',
    version_corte: VERSION_CORTE,
    generado_en: new Date().toISOString(),
    fuente: 'https://sig.gabrielpantoja.cl',
    licencia: 'CC-BY-4.0',
    columnas: COLUMNAS,
    sin_pii: ['comprador', 'vendedor', 'rut', 'userId', 'observaciones'],
    conteos: {
      transacciones: filas.length,
      georreferenciadas: geo,
      conservadores: conservadores.length,
      comunas: new Set(filas.map((f) => f.comuna).filter(Boolean)).size,
      anio_min: anios.length ? Math.min(...anios) : null,
      anio_max: anios.length ? Math.max(...anios) : null,
    },
    merkle: {
      algoritmo: 'SHA-256',
      canonicalizacion: 'columnas en orden fijo, separador TAB, NULL = \\N, escape de \\ y separadores',
      duplica_impar: true,
      n_hojas: hojas.length,
      raiz: raiz,
    },
    archivos: {},
  };

  console.log('Escribiendo el paquete...');
  await escribir(salida, 'referenciales.csv', aCsv(filas, COLUMNAS), manifiesto);
  await escribir(salida, 'referenciales.geojson', JSON.stringify(aGeoJson(filas)), manifiesto);
  await escribir(salida, 'conservadores.csv',
    aCsv(conservadores, ['id', 'nombre', 'comuna', 'region']), manifiesto);
  await escribir(salida, 'hojas.txt', hojas.map((h) => h.toString('hex')).join('\n') + '\n', manifiesto);

  // El manifiesto se escribe al final: contiene los hashes de todo lo anterior.
  await writeFile(path.join(salida, 'MANIFIESTO.json'), JSON.stringify(manifiesto, null, 2) + '\n');

  console.log(`\nraíz de Merkle: ${raiz}`);

  // --- comparación con el corte anterior -----------------------------------
  const previoPath = path.join(salida, 'MANIFIESTO.anterior.json');
  const hojasPrevPath = path.join(salida, 'hojas.anterior.txt');
  if (existsSync(previoPath) && existsSync(hojasPrevPath)) {
    const prev = JSON.parse(await readFile(previoPath, 'utf8'));
    const antes = new Set((await readFile(hojasPrevPath, 'utf8')).trim().split('\n'));
    const ahora = new Set(hojas.map((h) => h.toString('hex')));
    const nuevas = [...ahora].filter((h) => !antes.has(h)).length;
    const desaparecidas = [...antes].filter((h) => !ahora.has(h)).length;

    console.log(`\nComparación con el corte del ${prev.generado_en}:`);
    console.log(`  filas nuevas o modificadas : ${nuevas}`);
    console.log(`  filas desaparecidas        : ${desaparecidas}`);
    if (desaparecidas > 0) {
      console.log('\n  ATENCIÓN: hay filas que ya no están o cambiaron de contenido.');
      console.log('  En un registro casi solo incremental esto NO es normal: revisar antes de publicar.');
      process.exitCode = 2;
    }
  } else {
    console.log('\n(primer corte: no hay anterior con qué comparar)');
  }

  console.log(`\nPaquete en ${salida}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('corte-publico.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
