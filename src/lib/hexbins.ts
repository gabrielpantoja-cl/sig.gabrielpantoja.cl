/**
 * Capa «Mapa de calor de valor» — hexbins de $/m² sobre las transacciones CBR.
 *
 * A diferencia de un heatmap clásico (kernel de densidad tipo Leaflet.heat),
 * que pinta DÓNDE HAY MÁS PUNTOS, esta capa pinta CUÁNTO VALE EL SUELO: el
 * servidor agrupa las transacciones del viewport en una malla hexagonal
 * (`ST_HexagonGrid`, PostGIS 3.1+) y devuelve la MEDIANA de `monto /
 * superficieTerreno` por celda. Ver `docs/plan-mapa-de-calor.md`.
 *
 * Tres decisiones que sostienen la lectura:
 *
 *  1. **Mediana, no promedio.** La razón es la misma del panel de estadísticas
 *     (`docs/estadisticas.md`): promedio/mediana del monto es 5,06× en esta
 *     base, y un promedio de razones da el mismo peso a un sitio de 5 m² que a
 *     un fundo de 200 ha.
 *  2. **Escala por cuantiles, no lineal.** Los deciles de $/m² habitacional van
 *     de $68.837 (p10) a $1.194.774 (p98). Una rampa lineal deja el 90 % del
 *     mapa en el primer color.
 *  3. **La opacidad codifica confianza, no valor.** Una celda con 3 ventas se
 *     dibuja translúcida; una con 40, sólida. Nunca se pinta fuerte lo que no
 *     se sabe.
 *
 * El `destino` es OBLIGATORIO en la consulta: medido el 2026-08-27, la mediana
 * de $/m² es $348.997 en habitacional (`H`) y $1.337 en agrícola (`A`) — 261×.
 * Una escala compartida entre destinos deja la ciudad en rojo saturado y el
 * campo en azul plano.
 */

/** Ruta same-origin del endpoint de agregación (pasa por security.ts). */
export const HEXBINS_URL = '/api/hexbins';

/** Propiedades que el endpoint adjunta a cada hexágono. */
export interface HexbinProps {
  /** Transacciones con monto y superficie válidos dentro de la celda. */
  n: number;
  /** $/m² típico de la celda: mediana de las razones monto/superficie. */
  mediana_ppm2: number;
  p25: number;
  p75: number;
  /** Mediana del monto absoluto (CLP) — contexto, no se usa para el color. */
  mediana_monto: number | null;
}

/** Metadatos que el endpoint agrega como foreign members del FeatureCollection. */
export interface HexbinMeta {
  /** Arista del hexágono en metros (derivada del zoom en el servidor). */
  edge_m: number;
  destino: string;
  min_n: number;
  cells: number;
  /** Transacciones efectivamente agregadas (suma de `n`). */
  points: number;
}

/**
 * Escalera zoom → arista del hexágono, en metros (EPSG:3857).
 *
 * Se resuelve en el SERVIDOR a partir del `z` que manda el cliente, no se
 * acepta un tamaño en metros arbitrario: así nadie pide celdas de 10 m sobre
 * todo Chile. Los tamaños se calibraron contra producción el 2026-08-27
 * (Santiago a 250 m: 606 celdas / 3.047 puntos en 224 ms).
 */
export function hexEdgeForZoom(zoom: number): number {
  if (zoom <= 8) return 10000;
  if (zoom <= 10) return 5000;
  if (zoom <= 12) return 2000;
  if (zoom <= 14) return 500;
  if (zoom <= 16) return 250;
  return 100;
}

/** Etiqueta humana de la resolución vigente, para la leyenda. */
export function hexEdgeLabel(edgeM: number): string {
  return edgeM >= 1000 ? `${edgeM / 1000} km` : `${edgeM} m`;
}

/* ---------- Rampas de color ---------- */

export type HexbinRampId = 'plasma' | 'viridis';

/**
 * Seis clases por rampa (una por cuantil). Ambas son perceptualmente
 * uniformes y legibles por daltónicos: ninguna usa el eje rojo↔verde, que es
 * el que se pierde en deuteranopia/protanopia.
 *
 * `plasma` es la rampa por defecto sobre el mapa base oscuro (CARTO Dark
 * Matter) y `viridis` sobre el claro (CARTO Positron): el extremo bajo de
 * plasma (#0d0887) desaparece contra un fondo blanco.
 */
export const HEXBIN_RAMPS: Record<HexbinRampId, readonly string[]> = {
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  viridis: ['#440154', '#414487', '#2a788e', '#22a884', '#7ad151', '#fde725'],
};

export const HEXBIN_CLASSES = 6;

/**
 * Cortes por cuantiles sobre los valores visibles: devuelve los 5 límites que
 * separan las 6 clases. Se calculan en el CLIENTE y sobre lo que hay en
 * pantalla, así el contraste se re-normaliza al hacer zoom a una comuna en vez
 * de aplastarse contra la escala nacional.
 *
 * Los cortes se deduplican: con pocas celdas (o muchas iguales) dos cuantiles
 * pueden coincidir, y un corte repetido dejaría una clase vacía en la leyenda.
 */
export function quantileBreaks(values: number[]): number[] {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks: number[] = [];
  for (let i = 1; i < HEXBIN_CLASSES; i++) {
    const pos = (i / HEXBIN_CLASSES) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const value = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    if (breaks.length === 0 || value > breaks[breaks.length - 1]) breaks.push(value);
  }
  return breaks;
}

/** Índice de clase (0…HEXBIN_CLASSES-1) de un valor según los cortes. */
export function classIndex(value: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return i;
}

export function hexbinColor(value: number, breaks: number[], ramp: HexbinRampId): string {
  const colors = HEXBIN_RAMPS[ramp];
  const idx = classIndex(value, breaks);
  // Con cortes deduplicados puede haber menos de 6 clases: repartimos los
  // colores disponibles sobre las clases reales para no dejar la leyenda con
  // dos tonos idénticos.
  const classes = breaks.length + 1;
  if (classes >= colors.length) return colors[Math.min(idx, colors.length - 1)];
  const step = (colors.length - 1) / Math.max(1, classes - 1);
  return colors[Math.round(idx * step)];
}

/**
 * Opacidad por confianza: log(n) normalizado contra el máximo visible.
 * Nunca baja de 0,25 (la celda debe verse) ni sube de 0,85 (el mapa base debe
 * seguir leyéndose debajo).
 */
export function hexbinOpacity(n: number, nMax: number): number {
  if (nMax <= 1) return 0.6;
  const t = Math.log(Math.max(1, n)) / Math.log(nMax);
  return Math.min(0.85, Math.max(0.25, 0.25 + 0.6 * t));
}

/* ---------- Destino (código SII) ---------- */

/**
 * Códigos de destino presentes en la base, con su conteo y la mediana de
 * superficie de terreno — medidos contra producción el 2026-08-27.
 *
 * La base NO trae el diccionario oficial de destinos del SII (no hay tabla de
 * lookup en Neon), así que solo se rotulan los códigos cuya lectura es
 * inequívoca: `H` (mediana 152 m² de terreno y 60 m² construidos = vivienda
 * urbana). Los demás se muestran con su código crudo y la mediana de
 * superficie como desambiguador, en vez de inventarles un nombre.
 *
 * `min_n` no aplica aquí: este arreglo solo alimenta el selector de la UI.
 */
export interface DestinoOption {
  code: string;
  /** Rótulo solo cuando la lectura del código es inequívoca. */
  label: string | null;
  n: number;
  /** Mediana de `superficieTerreno` (m²) — desambiguador en el selector. */
  medianaSup: number;
}

export const DESTINO_OPTIONS: readonly DestinoOption[] = [
  { code: 'H', label: 'Habitacional', n: 48734, medianaSup: 152 },
  { code: 'W', label: null, n: 18031, medianaSup: 5000 },
  { code: 'A', label: null, n: 8599, medianaSup: 12500 },
  { code: 'L', label: null, n: 878, medianaSup: 525 },
  { code: 'C', label: null, n: 862, medianaSup: 336 },
  { code: 'Z', label: null, n: 646, medianaSup: 254 },
  { code: 'O', label: null, n: 228, medianaSup: 349 },
  { code: 'V', label: null, n: 120, medianaSup: 935 },
  { code: 'I', label: null, n: 111, medianaSup: 2236 },
  { code: 'E', label: null, n: 53, medianaSup: 775 },
  { code: 'G', label: null, n: 27, medianaSup: 1145 },
];

/** El default es habitacional: es el 57 % de la base y el caso urbano. */
export const DESTINO_DEFAULT = 'H';

export function destinoLabel(code: string): string {
  const found = DESTINO_OPTIONS.find((d) => d.code === code);
  if (!found) return `Destino ${code}`;
  return found.label ?? `Destino ${code} · mediana ${found.medianaSup.toLocaleString('es-CL')} m²`;
}

/* ---------- Umbral de celdas ---------- */

/**
 * Mínimo de transacciones para dibujar una celda. 3 es el mínimo defendible
 * para una mediana; con 5 el mapa queda más limpio y más honesto. Queda como
 * parámetro y se imprime en la leyenda.
 */
export const HEXBIN_MIN_N_DEFAULT = 3;
export const HEXBIN_MIN_N_MAX = 50;

/** Tope de celdas por respuesta — protege el payload y el render en canvas. */
export const HEXBIN_MAX_CELLS = 4000;

/* ---------- Estado operacional para la UI ---------- */

export type HexbinStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty'; meta: HexbinMeta }
  | { kind: 'ready'; meta: HexbinMeta; breaks: number[]; ramp: HexbinRampId }
  | { kind: 'error' };

export const HEXBINS_ATTRIBUTION =
  'Elaboración propia sobre inscripciones del Servicio de Conservadores de Bienes Raíces (Ley 20.285)';

/**
 * Advertencia obligatoria en la leyenda. La mediana de un puñado de ventas en
 * una celda de 250 m no es un valor de mercado: es una señal. Esto va en la
 * leyenda, no en el pie de página.
 */
export const HEXBINS_DISCLAIMER =
  'Mediana de $/m² de TERRENO por celda. Señal de mercado, no tasación: no reemplaza un informe pericial.';

/** Color representativo de la capa (swatch del panel y cajetín del PNG). */
export const HEXBINS_COLOR = '#b12a90';
