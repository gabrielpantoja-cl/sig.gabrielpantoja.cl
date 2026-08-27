/**
 * Superficie de calor continua a partir de muestras de valor.
 *
 * Convierte las medianas de $/m² por celda (las que calcula `/api/hexbins` en
 * Neon) en un raster suave, sin costuras ni huecos, del tipo que se espera de
 * un heatmap en un SIG: bordes difusos, transición continua de color y una
 * caída natural a transparente donde no hay datos.
 *
 * ## Por qué NO es un heatmap de densidad
 *
 * El heatmap clásico (`Leaflet.heat`, `deck.gl` con `aggregation: 'SUM'`)
 * ACUMULA: donde hay más puntos, más rojo. Con transacciones CBR eso dibuja
 * dónde hay más rotación inmobiliaria, no dónde el suelo vale más.
 *
 * Aquí se acumulan DOS buffers y se dividen:
 *
 *     num[px] = Σ  w(d) · valor_i          ← numerador ponderado
 *     den[px] = Σ  w(d)                    ← suma de pesos
 *     valor(px) = num[px] / den[px]        ← MEDIA PONDERADA del valor
 *     alfa(px)  = f(den[px])               ← cuánto dato sostiene ese píxel
 *
 * El cociente es una interpolación tipo Shepard con kernel gaussiano: el color
 * NO depende de cuántas transacciones hay cerca, solo de cuánto valen. La
 * densidad se va al canal alfa, que es donde corresponde: un píxel lejos de
 * toda transacción se desvanece en vez de inventar un valor.
 *
 * ## El pipeline completo, y por qué es defendible
 *
 *   puntos CBR  →  MEDIANA por hexágono (en Postgres)  →  interpolación
 *                  ↑ robusta a outliers                    ↑ continua y suave
 *
 * Interpolar las medianas y no los puntos crudos es lo que mantiene honesta la
 * superficie: la mediana ya absorbió los montos extremos (promedio/mediana del
 * monto es 5,06× en esta base, ver `docs/estadisticas.md`), y recién sobre ese
 * dato ya robusto se aplica el suavizado. Interpolar los puntos crudos habría
 * dejado que una sola inscripción anómala tiñera un barrio entero.
 *
 * ## Coste
 *
 * El kernel se «salpica» (splat) sobre la huella de cada muestra en vez de
 * recorrer todos los píxeles por cada muestra: el coste es
 * `muestras × área_del_kernel`, no `muestras × píxeles`. Además se calcula a
 * resolución reducida y se reescala con interpolación bilineal del canvas, lo
 * que además aporta gratis parte del difuminado final.
 */

import { HEXBIN_RAMPS, type HexbinRampId } from '@/lib/hexbins';

/** Una celda agregada, ya proyectada a píxeles del lienzo de trabajo. */
export interface HeatSample {
  /** Posición en píxeles del lienzo a escala completa. */
  x: number;
  y: number;
  /** Mediana de $/m² de la celda. */
  value: number;
  /** Transacciones que sostienen esa mediana. */
  n: number;
}

/**
 * Factor de reducción del lienzo de cálculo. El raster se computa a 1/4 y se
 * reescala: cuadruplica la velocidad y el filtrado bilineal del `drawImage`
 * suaviza los bordes de clase sin un blur explícito.
 */
const DOWNSCALE = 4;

/** Techo del lienzo de trabajo. Protege pantallas 4K de un raster gigante. */
const MAX_WORK_PX = 520;

/** Opacidad máxima de la superficie: el mapa base debe seguir leyéndose. */
const MAX_ALPHA = 0.72;

/**
 * Umbrales de cobertura sobre `den` (suma de pesos del kernel, donde una
 * muestra a distancia cero aporta 1,0). Bajo `DEN_MIN` el píxel queda
 * transparente — es territorio sin transacciones y no se pinta. Sobre
 * `DEN_FULL` la superficie va a opacidad plena.
 *
 * `DEN_MIN` se subió de 0,06 a 0,14 al calibrar contra Valdivia: con el umbral
 * bajo, los píxeles del extremo del halo quedaban dominados por UNA sola celda
 * lejana y aparecían manchas de color intenso sin nada que las sostuviera.
 */
const DEN_MIN = 0.14;
const DEN_FULL = 0.9;

/* ---------- Escala de color continua por cuantiles ---------- */

/**
 * Escala de cuantiles: `steps + 1` umbrales que reparten los valores en
 * `steps` tramos equiprobables. Con 24 tramos la rampa queda continua a la
 * vista (no se distinguen los saltos) pero el color sigue repartido de forma
 * pareja sobre la distribución real, que es lo que evita que una cola larga
 * deje el 90 % del mapa en el primer tono.
 */
export function quantileScale(values: number[], steps = 24): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const pos = (i / steps) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    out.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
  }
  return out;
}

/**
 * Peso del componente de cuantiles frente al logarítmico en la posición de
 * color. Ver `rampPosition`.
 */
const QUANTILE_WEIGHT = 0.6;

/**
 * Posición [0,1] de un valor en la rampa: mezcla de dos escalas.
 *
 * - **Cuantil** reparte el color de forma pareja sobre la distribución. Solo,
 *   satura: como estira cada tramo hasta ocupar 1/24 de la rampa, dos celdas
 *   vecinas que difieren en un 5 % pueden salir moradas y amarillas. Sobre una
 *   superficie donde el ruido local es real (la mediana de 2–3 ventas en 250 m
 *   no es estable) eso se ve como moteado psicodélico, no como un gradiente.
 * - **Logarítmica** respeta las distancias reales entre valores, así que las
 *   transiciones salen graduales. Sola, la cola larga de los $/m² deja casi
 *   todo el mapa en el primer tercio de la rampa.
 *
 * La mezcla 60/40 conserva el reparto de color de los cuantiles y le devuelve
 * la gradualidad de la escala logarítmica. Se usa log y no lineal porque el
 * valor de suelo es multiplicativo: la distancia entre $100k y $200k/m² es la
 * misma que entre $300k y $600k.
 *
 * La leyenda posiciona sus marcas llamando a esta misma función, así el color
 * que se ve en el mapa y el que se ve en la leyenda coinciden por
 * construcción, sean cuales sean los pesos.
 */
export function rampPosition(value: number, scale: number[]): number {
  const last = scale.length - 1;
  if (last < 1) return 0.5;
  const min = scale[0];
  const max = scale[last];
  if (value <= min) return 0;
  if (value >= max) return 1;

  // Componente de cuantiles: búsqueda binaria del tramo que contiene al valor.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (value >= scale[mid]) lo = mid;
    else hi = mid;
  }
  const span = scale[hi] - scale[lo];
  const tQuantile = (lo + (span > 0 ? (value - scale[lo]) / span : 0)) / last;

  // Componente logarítmica. Con valores no positivos (imposible en $/m² pero
  // defendible ante datos sucios) cae a lineal.
  let tLog: number;
  if (min > 0 && max > min) {
    const lMin = Math.log(min);
    tLog = (Math.log(value) - lMin) / (Math.log(max) - lMin);
  } else {
    tLog = (value - min) / (max - min);
  }

  return QUANTILE_WEIGHT * tQuantile + (1 - QUANTILE_WEIGHT) * tLog;
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Rampa continua: interpola linealmente entre los colores de la paleta. Las
 * paletas de `hexbins.ts` son perceptualmente uniformes, así que el lerp en
 * RGB entre tonos contiguos no introduce bandas ni tonos muertos.
 */
export function buildRampLut(ramp: HexbinRampId, size = 256): Uint8ClampedArray {
  const stops = HEXBIN_RAMPS[ramp].map(hexToRgb);
  const lut = new Uint8ClampedArray(size * 3);
  const segments = stops.length - 1;
  for (let i = 0; i < size; i++) {
    const t = (i / (size - 1)) * segments;
    const idx = Math.min(segments - 1, Math.floor(t));
    const f = t - idx;
    const a = stops[idx];
    const b = stops[idx + 1];
    lut[i * 3] = a[0] + (b[0] - a[0]) * f;
    lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
  }
  return lut;
}

/* ---------- Rasterización ---------- */

export interface HeatSurfaceOptions {
  /** Tamaño del lienzo de salida, en píxeles de pantalla. */
  width: number;
  height: number;
  samples: HeatSample[];
  /** Radio del kernel gaussiano en píxeles de pantalla. */
  radiusPx: number;
  ramp: HexbinRampId;
  /** Escala de cuantiles (de `quantileScale`) para mapear valor → color. */
  scale: number[];
}

/**
 * Devuelve un `<canvas>` de `width × height` con la superficie ya pintada, o
 * `null` si no hay nada que dibujar.
 */
export function renderHeatSurface(opts: HeatSurfaceOptions): HTMLCanvasElement | null {
  const { width, height, samples, radiusPx, ramp, scale } = opts;
  if (width <= 0 || height <= 0 || samples.length === 0 || scale.length < 2) return null;

  // Lienzo de trabajo reducido; si aun así es enorme, se reduce más.
  const extra = Math.max(1, Math.ceil(Math.max(width, height) / DOWNSCALE / MAX_WORK_PX));
  const step = DOWNSCALE * extra;
  const w = Math.max(1, Math.ceil(width / step));
  const h = Math.max(1, Math.ceil(height / step));
  const radius = Math.max(1, radiusPx / step);

  const num = new Float32Array(w * h);
  const den = new Float32Array(w * h);

  // Kernel gaussiano con soporte compacto: w(d) = exp(-k·(d/r)²), truncado en
  // d = r. `k = 4` deja el peso en ~1,8 % en el borde, así que el corte no se
  // nota pero la huella se mantiene acotada.
  const k = 4;
  const r2 = radius * radius;
  const iRadius = Math.ceil(radius);

  for (const s of samples) {
    if (!Number.isFinite(s.value)) continue;
    const cx = s.x / step;
    const cy = s.y / step;
    const x0 = Math.max(0, Math.floor(cx - iRadius));
    const x1 = Math.min(w - 1, Math.ceil(cx + iRadius));
    const y0 = Math.max(0, Math.floor(cy - iRadius));
    const y1 = Math.min(h - 1, Math.ceil(cy + iRadius));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        const weight = Math.exp((-k * d2) / r2);
        num[row + x] += weight * s.value;
        den[row + x] += weight;
      }
    }
  }

  const lut = buildRampLut(ramp);
  const lutMax = lut.length / 3 - 1;
  const work = document.createElement('canvas');
  work.width = w;
  work.height = h;
  const workCtx = work.getContext('2d');
  if (!workCtx) return null;
  const image = workCtx.createImageData(w, h);
  const data = image.data;

  for (let i = 0; i < num.length; i++) {
    const d = den[i];
    if (d <= DEN_MIN) continue; // sin dato: se deja transparente, no se inventa
    const value = num[i] / d;
    const t = rampPosition(value, scale);
    const c = Math.round(t * lutMax) * 3;
    // La cobertura (cuánto dato sostiene el píxel) va al alfa; el exponente
    // 0,75 alarga el degradado del borde para que la caída se vea suave.
    const coverage = Math.min(1, (d - DEN_MIN) / (DEN_FULL - DEN_MIN));
    const o = i * 4;
    data[o] = lut[c];
    data[o + 1] = lut[c + 1];
    data[o + 2] = lut[c + 2];
    data[o + 3] = Math.round(255 * MAX_ALPHA * Math.pow(coverage, 0.75));
  }
  workCtx.putImageData(image, 0, 0);

  // Reescalado con filtrado bilineal: además de devolver el raster al tamaño
  // de pantalla, es lo que borra el escalonado de los píxeles de trabajo.
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(work, 0, 0, w, h, 0, 0, width, height);
  return out;
}
