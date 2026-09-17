#!/usr/bin/env node
/**
 * Prototipo de investigación — Fase 5.2 (serie temporal de NDVI por punto).
 * NO forma parte del build ni de `data:build`. Sirve para medir antes de
 * decidir la arquitectura: cuánto tarda, cuántas peticiones y cuántos bytes
 * cuesta armar la curva mensual de un lugar desde Sentinel-2 L2A.
 *
 * Uso:  node scripts/research/ndvi-serie.mjs <lat> <lng> [radio_m] [desde] [hasta] [etiqueta]
 *
 * Fuente: catálogo STAC de Element 84 (colección sentinel-2-l2a), assets COG
 * leídos por HTTP range request con `geotiff`: solo la ventana del buffer.
 */

// Contador de red: se instala ANTES de importar geotiff para que sus lecturas
// por rango también pasen por aquí.
const red = { requests: 0, bytes: 0, stac: 0, cog: 0 };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const res = await fetchOriginal(input, init);
  const url = typeof input === 'string' ? input : input.url;
  red.requests++;
  if (url.includes('earth-search')) red.stac++;
  else red.cog++;
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len)) red.bytes += len;
  return res;
};

const { fromUrl } = await import('geotiff');

const STAC = 'https://earth-search.aws.element84.com/v1/search';

// Clases SCL descartadas: 0 nodata, 1 saturado/defectuoso, 3 sombra de nube,
// 8-9 nubes (media/alta probabilidad), 10 cirros, 11 nieve.
const SCL_INVALIDAS = new Set([0, 1, 3, 8, 9, 10, 11]);

// Filtro adicional medido en la costa valdiviana: Sen2Cor etiqueta bosque bajo
// neblina como agua o suelo, pero el azul lo delata (0,14 vs 0,03 despejado).
// AZUL=0 lo desactiva para comparar.
const AZUL_UMBRAL = Number(process.env.AZUL ?? 0.1);

// Umbral para dar por buena una escena en el buffer; si no se alcanza se
// prueba la siguiente menos nublada del mes, hasta MAX_INTENTOS.
const FRACCION_VALIDA_MIN = 0.5;
const MAX_INTENTOS = 3;
const CONCURRENCIA = 6;

// ── UTM (WGS84), Krüger — suficiente al centímetro para ventanas de 10 m ──
function lonLatToUtm(lon, lat, zone) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const φ = (lat * Math.PI) / 180, λ = (lon * Math.PI) / 180;
  const λ0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - λ0);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * φ
    - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * φ)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * φ)
    - ((35 * e6) / 3072) * Math.sin(6 * φ));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(φ) * (A * A / 2
    + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

function percentil(ordenado, p) {
  if (!ordenado.length) return null;
  const i = (ordenado.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (i - lo);
}

async function buscarEscenas(lng, lat, desde, hasta) {
  const items = [];
  let body = {
    collections: ['sentinel-2-l2a'],
    intersects: { type: 'Point', coordinates: [lng, lat] },
    datetime: `${desde}T00:00:00Z/${hasta}T23:59:59Z`,
    limit: 100,
  };
  let url = STAC;
  let paginas = 0;
  for (;;) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`STAC ${res.status}`);
    const j = await res.json();
    paginas++;
    items.push(...j.features);
    const next = (j.links || []).find((l) => l.rel === 'next');
    if (!next) break;
    url = next.href;
    body = next.body ? { ...body, ...next.body } : body;
    if (next.method === 'GET') { body = undefined; }
  }
  return { items, paginas };
}

const cacheTiff = new Map();
async function abrir(href) {
  // blockSize 256 KB: con el valor por defecto (64 KB) geotiff parte cada tile
  // de 1 MB en ~8 requests; medido, 256 KB lo deja en 2 y baja el tiempo a la mitad.
  if (!cacheTiff.has(href)) cacheTiff.set(href, fromUrl(href, { blockSize: 1 << 18 }).then((t) => t.getImage()));
  return cacheTiff.get(href);
}

/** Lee la ventana de una banda con SU propio transform (trampa b). */
async function leerVentana(asset, x, y, radio) {
  const [px, , x0, , py, y0] = asset['proj:transform'];
  const [alto, ancho] = asset['proj:shape'];
  const c0 = Math.max(0, Math.floor((x - radio - x0) / px));
  const c1 = Math.min(ancho, Math.ceil((x + radio - x0) / px));
  const f0 = Math.max(0, Math.floor((y + radio - y0) / py));
  const f1 = Math.min(alto, Math.ceil((y - radio - y0) / py));
  const img = await abrir(asset.href);
  const [datos] = await img.readRasters({ window: [c0, f0, c1, f1] });
  return { datos, c0, f0, ancho: c1 - c0, x0, y0, px, py };
}

async function ndviEscena(item, lng, lat, radio) {
  const zona = item.properties['mgrs:utm_zone'];
  const [x, y] = lonLatToUtm(lng, lat, zona);
  const [red10, nir10, scl20, azul10] = await Promise.all([
    leerVentana(item.assets.red, x, y, radio),
    leerVentana(item.assets.nir, x, y, radio),
    leerVentana(item.assets.scl, x, y, radio),
    AZUL_UMBRAL ? leerVentana(item.assets.blue, x, y, radio) : null,
  ]);
  // Trampa a: el DN ya viene sin el offset BOA; reflectancia = DN × 1e-4 y NO
  // se resta 0,1 aunque raster:bands lo declare.
  // Trampa e (medida en este prototipo): la bandera
  // earthsearch:boa_offset_applied viene en false en ~4 % de las escenas
  // (nov-2024 a mar-2025) que igual tienen el offset aplicado — el rojo de una
  // viña vale DN ≈ 250, no ≈ 1.250. Restar 1.000 por confiar en ella dio NDVI
  // 3,39. Por eso no se consulta; se registra solo como dato.
  const boa = item.properties['earthsearch:boa_offset_applied'] === true;
  const restar = 0;

  const valores = [];
  let enCirculo = 0;
  const clases = {};
  let descAzul = 0;
  for (let i = 0; i < red10.datos.length; i++) {
    const col = i % red10.ancho, fil = Math.floor(i / red10.ancho);
    const cx = red10.x0 + (red10.c0 + col + 0.5) * red10.px;
    const cy = red10.y0 + (red10.f0 + fil + 0.5) * red10.py;
    if ((cx - x) ** 2 + (cy - y) ** 2 > radio * radio) continue;
    enCirculo++;
    // Píxel SCL que contiene el centro del píxel de 10 m, con el transform de SCL.
    const sc = Math.floor((cx - scl20.x0) / scl20.px) - scl20.c0;
    const sf = Math.floor((cy - scl20.y0) / scl20.py) - scl20.f0;
    const clase = sc >= 0 && sf >= 0 && sc < scl20.ancho ? scl20.datos[sf * scl20.ancho + sc] : 0;
    clases[clase] = (clases[clase] || 0) + 1;
    if (clase === undefined || SCL_INVALIDAS.has(clase)) continue;
    const r = red10.datos[i], n = nir10.datos[i];
    if (!r || !n) continue;
    if (azul10 && azul10.datos[i] * 1e-4 > AZUL_UMBRAL) { descAzul++; continue; }
    const rr = (r - restar) * 1e-4, nn = (n - restar) * 1e-4;
    if (rr + nn <= 0) continue;
    valores.push((nn - rr) / (nn + rr));
  }
  valores.sort((a, b) => a - b);
  // Guardia de escala: un NDVI fuera de [-1, 1] solo puede salir de una
  // reflectancia mal escalada. La escena entera se descarta, no el píxel.
  const fueraDeRango = valores.length && (valores[0] < -1 || valores[valores.length - 1] > 1);
  if (fueraDeRango) valores.length = 0;
  return {
    fueraDeRango: Boolean(fueraDeRango),
    id: item.id,
    fecha: item.properties.datetime.slice(0, 10),
    nubesEscena: Math.round(item.properties['eo:cloud_cover']),
    enCirculo,
    n: valores.length,
    fraccion: enCirculo ? valores.length / enCirculo : 0,
    mediana: percentil(valores, 0.5),
    p25: percentil(valores, 0.25),
    p75: percentil(valores, 0.75),
    min: valores[0] ?? null,
    max: valores[valores.length - 1] ?? null,
    clases,
    descAzul,
    boa,
  };
}

async function conLimite(tareas, limite) {
  const out = new Array(tareas.length);
  let i = 0;
  await Promise.all(Array.from({ length: limite }, async () => {
    while (i < tareas.length) { const k = i++; out[k] = await tareas[k](); }
  }));
  return out;
}

const [lat, lng] = [Number(process.argv[2]), Number(process.argv[3])];
const radio = Number(process.argv[4] || 100);
const desde = process.argv[5] || '2023-09-01';
const hasta = process.argv[6] || '2026-08-31';
const etiqueta = process.argv[7] || `${lat},${lng}`;
if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('uso: node scripts/research/ndvi-serie.mjs <lat> <lng> [radio_m] [desde] [hasta] [etiqueta]');
  process.exit(1);
}

const t0 = performance.now();
const { items, paginas } = await buscarEscenas(lng, lat, desde, hasta);
const tStac = performance.now() - t0;

// Una misma pasada puede venir repetida por solape de cuadrículas MGRS o por
// reprocesos; se agrupa por mes y se ordena por nubosidad de la escena.
const porMes = new Map();
for (const it of items) {
  const mes = it.properties.datetime.slice(0, 7);
  if (!porMes.has(mes)) porMes.set(mes, []);
  porMes.get(mes).push(it);
}
for (const lista of porMes.values()) lista.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']);

const meses = [...porMes.keys()].sort();
const tareas = meses.map((mes) => async () => {
  const candidatas = porMes.get(mes);
  const intentos = [];
  // MVC=2: se evalúan hasta 2 escenas que superen el umbral y se queda la de
  // mayor mediana (compuesto de máximo valor, como MOD13): la neblina que la
  // máscara no atrapa siempre baja el NDVI.
  const MVC = Number(process.env.MVC || 1);
  let aceptadas = 0;
  for (const item of candidatas.slice(0, MAX_INTENTOS + MVC - 1)) {
    const t = performance.now();
    try {
      const r = await ndviEscena(item, lng, lat, radio);
      r.ms = Math.round(performance.now() - t);
      intentos.push(r);
      if (r.fraccion >= FRACCION_VALIDA_MIN && ++aceptadas >= MVC) break;
    } catch (e) {
      intentos.push({ id: item.id, error: e.message });
    }
  }
  const buenos = intentos.filter((r) => !r.error && r.n > 0);
  const validos = buenos.filter((r) => r.fraccion >= FRACCION_VALIDA_MIN);
  const elegido = validos.length
    ? validos.sort((a, b) => b.mediana - a.mediana)[0]
    : buenos.sort((a, b) => b.fraccion - a.fraccion)[0] || null;
  return { mes, candidatas: candidatas.length, intentos, elegido };
});

const tLect0 = performance.now();
const serie = await conLimite(tareas, CONCURRENCIA);
const tLect = performance.now() - tLect0;
const total = performance.now() - t0;

const fmt = (v) => (v == null ? '  —  ' : v.toFixed(3));
console.log(`\n# ${etiqueta}  (${lat}, ${lng})  radio ${radio} m  ${desde}→${hasta}`);
console.log(`filtro azul: ${AZUL_UMBRAL || 'desactivado'}`);
console.log('mes      esc  int  fecha       nub%  n/círc   fracc  P25    med    P75   (desc. azul)');
let conDato = 0, sinDato = 0, lecturas = 0;
const boaValores = new Set();
for (const m of serie) {
  lecturas += m.intentos.filter((r) => !r.error).length;
  m.intentos.forEach((r) => r.boa !== undefined && boaValores.add(r.boa));
  const e = m.elegido;
  const ok = e && e.fraccion >= FRACCION_VALIDA_MIN;
  if (ok) conDato++;
  else sinDato++;
  console.log(
    `${m.mes}  ${String(m.candidatas).padStart(3)}  ${String(m.intentos.length).padStart(3)}  ` +
      (e
        ? `${e.fecha}  ${String(e.nubesEscena).padStart(3)}  ${String(e.n).padStart(3)}/${String(e.enCirculo).padEnd(3)}  ${e.fraccion.toFixed(2)}   ${fmt(e.p25)}  ${fmt(e.mediana)}  ${fmt(e.p75)}${e.descAzul ? '  az:' + e.descAzul : ''}${ok ? '' : '   ← hueco (fracción < umbral)'}`
        : '—  sin lectura válida  ← hueco'),
  );
}
const errores = serie.flatMap((m) => m.intentos.filter((r) => r.error));
console.log('\nresumen');
console.log(`  escenas en catálogo : ${items.length} (${paginas} páginas STAC, ${(tStac / 1000).toFixed(1)} s)`);
console.log(`  meses con dato      : ${conDato} / ${meses.length}  (huecos: ${sinDato})`);
console.log(`  escenas leídas      : ${lecturas}  (≈${(lecturas / meses.length).toFixed(2)} por mes)`);
console.log(`  lectura COG         : ${(tLect / 1000).toFixed(1)} s con concurrencia ${CONCURRENCIA}`);
console.log(`  TOTAL               : ${(total / 1000).toFixed(1)} s`);
console.log(`  requests            : ${red.requests}  (STAC ${red.stac}, COG ${red.cog})`);
console.log(`  bytes descargados   : ${(red.bytes / 1048576).toFixed(1)} MB`);
console.log(`  boa_offset_applied  : ${[...boaValores].join(', ')}`);
console.log(`  errores             : ${errores.length}${errores.length ? ' → ' + errores.slice(0, 3).map((e) => e.error).join(' | ') : ''}`);
