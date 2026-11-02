#!/usr/bin/env node
/**
 * construir-espejo.mjs — Arma el espejo estatico del corte publico.
 *
 * Toma el paquete que produce corte-publico.mjs y genera un sitio autocontenido,
 * sin servidor ni base de datos, apto para cualquier hosting estatico y para
 * IPFS. Ver docs/preservacion-datos.md.
 *
 *   node scripts/construir-espejo.mjs [--origen espejo/datos] [--salida espejo/sitio]
 *
 * TODAS las rutas del sitio son RELATIVAS: las gateways de IPFS sirven bajo
 * /ipfs/<cid>/, asi que una barra inicial romperia el sitio entero.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ORIGEN = path.resolve(arg('--origen', 'espejo/datos'));
const SALIDA = path.resolve(arg('--salida', 'espejo/sitio'));

const kb = (b) => (b / 1024).toFixed(0) + ' KB';
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';

// --- 1. leer el corte ------------------------------------------------------

const manifiesto = JSON.parse(readFileSync(path.join(ORIGEN, 'MANIFIESTO.json'), 'utf8'));
const csv = readFileSync(path.join(ORIGEN, 'referenciales.csv'), 'utf8');

/** Parser de CSV mínimo que respeta comillas dobles y "" escapadas. */
function parseCsv(texto) {
  const filas = [];
  let campo = '', fila = [], enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else enComillas = false;
      } else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

const [cabecera, ...cuerpo] = parseCsv(csv).filter((f) => f.length > 1);
const col = Object.fromEntries(cabecera.map((c, i) => [c, i]));

// --- 2. formato columnar compacto para el mapa -----------------------------

/**
 * El GeoJSON del corte pesa decenas de MB: inviable para un navegador y para
 * IPFS. El mapa solo necesita posicion y unos pocos atributos, asi que se emite
 * en columnas, con las cadenas repetidas sustituidas por un indice a un
 * diccionario. Comprime mucho mejor que un array de objetos y se parsea de una.
 *
 * Las coordenadas se redondean a 5 decimales (~1 m), mas que suficiente para
 * un punto de inscripcion y bastante mas liviano que 15 decimales.
 */
const dicComuna = [], dicDestino = [], idxComuna = new Map(), idxDestino = new Map();
const indexar = (dic, mapa, v) => {
  const k = v || '';
  if (!mapa.has(k)) { mapa.set(k, dic.length); dic.push(k); }
  return mapa.get(k);
};

const lat = [], lng = [], monto = [], anio = [], comuna = [], destino = [], rol = [];
let descartadas = 0;

for (const f of cuerpo) {
  const la = Number(f[col.lat]), ln = Number(f[col.lng]);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) { descartadas++; continue; }
  lat.push(Math.round(la * 1e5) / 1e5);
  lng.push(Math.round(ln * 1e5) / 1e5);
  monto.push(f[col.monto] === '' ? null : Number(f[col.monto]));
  anio.push(f[col.anio] === '' ? null : Number(f[col.anio]));
  comuna.push(indexar(dicComuna, idxComuna, f[col.comuna]));
  destino.push(indexar(dicDestino, idxDestino, f[col.destino]));
  rol.push(f[col.rol] || '');
}

const puntos = {
  n: lat.length,
  generado_en: manifiesto.generado_en,
  merkle_raiz: manifiesto.merkle.raiz,
  dic: { comuna: dicComuna, destino: dicDestino },
  lat, lng, monto, anio, comuna, destino, rol,
};

// --- 3. armar el sitio -----------------------------------------------------

mkdirSync(path.join(SALIDA, 'datos'), { recursive: true });
mkdirSync(path.join(SALIDA, 'vendor'), { recursive: true });

const escribir = (rel, contenido) => {
  const p = path.join(SALIDA, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, contenido);
  console.log(`  ${rel.padEnd(34)} ${mb(statSync(p).size).padStart(9)}`);
};

escribir('datos/puntos.json', JSON.stringify(puntos));
escribir('datos/referenciales.csv', csv);
escribir('datos/conservadores.csv', readFileSync(path.join(ORIGEN, 'conservadores.csv')));
escribir('datos/MANIFIESTO.json', JSON.stringify(manifiesto, null, 2));

// Leaflet se copia desde node_modules: nada de CDN. El sitio no debe depender de
// un tercero para arrancar, que es justamente lo que se quiere evitar.
const leafletDist = path.resolve('node_modules/leaflet/dist');
if (!existsSync(leafletDist)) {
  console.error('Falta node_modules/leaflet. Corre npm install.');
  process.exit(1);
}
for (const f of ['leaflet.js', 'leaflet.css']) {
  cpSync(path.join(leafletDist, f), path.join(SALIDA, 'vendor', f));
  console.log(`  ${('vendor/' + f).padEnd(34)} ${kb(statSync(path.join(SALIDA, 'vendor', f)).size).padStart(9)}`);
}
cpSync(path.join(leafletDist, 'images'), path.join(SALIDA, 'vendor', 'images'), { recursive: true });

// El visor y los textos de procedencia viven en la plantilla, no incrustados aca.
const plantilla = path.resolve('scripts/plantilla-espejo');
for (const f of ['index.html', 'LEEME.md']) {
  const src = path.join(plantilla, f);
  if (existsSync(src)) {
    cpSync(src, path.join(SALIDA, f));
    console.log(`  ${f.padEnd(34)} ${kb(statSync(path.join(SALIDA, f)).size).padStart(9)}`);
  }
}

console.log(`\n  ${puntos.n} puntos · ${descartadas} sin coordenadas descartadas`);
console.log(`  comunas: ${dicComuna.length} · destinos: ${dicDestino.length}`);
console.log(`\nSitio en ${SALIDA}`);
