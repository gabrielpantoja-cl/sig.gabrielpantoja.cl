/**
 * Capa «Mapa de calor de valor» — superficie continua de $/m² sobre las
 * transacciones CBR.
 *
 * A diferencia de un heatmap clásico (kernel de densidad tipo Leaflet.heat),
 * que pinta DÓNDE HAY MÁS PUNTOS, esta capa pinta CUÁNTO VALE EL SUELO.
 *
 * El pipeline tiene dos etapas y el orden es lo que lo hace defendible:
 *
 *   1. **Agregación robusta en Neon** (`/api/hexbins`): las transacciones del
 *      viewport se agrupan en una malla hexagonal (`ST_HexagonGrid`, PostGIS
 *      3.1+) y de cada celda sale la MEDIANA de `monto / superficieTerreno`.
 *      La mediana absorbe los montos extremos — promedio/mediana del monto es
 *      5,06× en esta base (`docs/estadisticas.md`).
 *   2. **Interpolación continua en el cliente** (`lib/heat-surface.ts`): esas
 *      medianas se suavizan con un kernel gaussiano hacia un raster sin
 *      costuras ni huecos.
 *
 * Interpolar las medianas y no los puntos crudos es la diferencia entre una
 * superficie honesta y una donde una sola inscripción anómala tiñe un barrio.
 *
 * Este módulo aporta la parte declarativa (escalera de muestreo, rampas,
 * cortes de cuantiles para la leyenda, códigos de destino, advertencias); la
 * rasterización vive en `lib/heat-surface.ts`.
 *
 * Dos reglas más que sostienen la lectura:
 *
 *  - **Escala por cuantiles, no lineal.** Los deciles de $/m² habitacional van
 *    de $68.837 (p10) a $1.194.774 (p98). Una rampa lineal deja el 90 % del
 *    mapa en el primer color.
 *  - **La opacidad codifica cobertura, no valor.** Donde no hay transacciones
 *    cerca, la superficie se desvanece en vez de inventar un valor.
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
 * todo Chile.
 *
 * La malla NO se dibuja: es la retícula de MUESTREO que alimenta la
 * interpolación de `lib/heat-surface.ts`. Por eso es más fina de lo que sería
 * razonable para teselas visibles — una celda con 2 ó 3 transacciones sería un
 * hexágono poco defendible, pero como muestra de una superficie que después
 * promedia decenas de celdas vecinas es exactamente lo que se quiere: más
 * muestras, mejor resuelto el gradiente.
 */
export function hexEdgeForZoom(zoom: number): number {
  if (zoom <= 8) return 4000;
  if (zoom <= 10) return 1500;
  if (zoom <= 11) return 800;
  if (zoom <= 12) return 500;
  if (zoom <= 13) return 350;
  if (zoom <= 14) return 250;
  if (zoom <= 15) return 150;
  if (zoom <= 16) return 100;
  return 60;
}

/** Etiqueta humana de la resolución vigente, para la leyenda. */
export function hexEdgeLabel(edgeM: number): string {
  return edgeM >= 1000 ? `${edgeM / 1000} km` : `${edgeM} m`;
}

/* ---------- Rampas de color ---------- */

export type HexbinRampId = 'plasma' | 'tasacion';

/**
 * Las seis paradas de cada rampa son ANCLAS, no clases: `heat-surface.ts`
 * interpola entre ellas para producir un degradado continuo. Ninguna usa el
 * eje rojo↔verde, que es el que se pierde en deuteranopia/protanopia.
 *
 * La rampa se elige por tema, y cada una corre en el sentido que le conviene a
 * su fondo. La leyenda rotula el sentido, así que no hay ambigüedad:
 *
 * - `plasma` (oscuro → claro) sobre el mapa base oscuro. El valor alto es el
 *   amarillo brillante, que es lo que destaca contra un fondo negro.
 * - `tasacion` (claro → oscuro) sobre el mapa base claro, siguiendo la
 *   convención habitual de los mapas de valor de suelo chilenos: amarillo el
 *   suelo barato, pasando por naranja y rojo, hasta azul marino el más caro.
 *   Invertir el sentido aquí es lo correcto: sobre fondo blanco lo que
 *   destaca es lo OSCURO, y el valor alto debe ser lo que salta a la vista.
 *
 * Se descartó viridis para el tema claro: su extremo bajo (#440154) sobre
 * fondo blanco y con transparencia queda en un gris violáceo sin fuerza, y el
 * mapa entero se veía lavado.
 */
export const HEXBIN_RAMPS: Record<HexbinRampId, readonly string[]> = {
  plasma: ['#0d0887', '#6a00a8', '#b12a90', '#e16462', '#fca636', '#f0f921'],
  tasacion: ['#ffeda0', '#feb24c', '#fd8d3c', '#e31a1c', '#7a0177', '#253494'],
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
 * Mínimo de transacciones para que una celda entre como muestra.
 *
 * El default es 2 y no 3 porque estas celdas ya no se dibujan una a una: cada
 * píxel de la superficie final es una media ponderada de DECENAS de celdas
 * vecinas, así que el tamaño de muestra efectivo por píxel es mucho mayor que
 * el de una celda suelta. Subirlo a 4–6 produce un mapa más conservador (menos
 * superficie pintada, cada tramo sostenido por más ventas); el slider queda en
 * la UI y el valor vigente se imprime en la leyenda.
 */
export const HEXBIN_MIN_N_DEFAULT = 2;
export const HEXBIN_MIN_N_MAX = 50;

/** Tope de celdas por respuesta — protege el payload y el render en canvas. */
export const HEXBIN_MAX_CELLS = 4000;

/* ---------- Estado operacional para la UI ---------- */

export type HexbinStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'empty'; meta: HexbinMeta }
  | {
      kind: 'ready';
      meta: HexbinMeta;
      /** Cortes de cuantiles con los que se rotula la leyenda. */
      breaks: number[];
      /** Escala completa (de `quantileScale`) — la leyenda la necesita para
       *  posicionar cada marca con la misma funcion que colorea el raster. */
      scale: number[];
      ramp: HexbinRampId;
    }
  | { kind: 'error' };

export const HEXBINS_ATTRIBUTION =
  'Elaboración propia sobre inscripciones del Servicio de Conservadores de Bienes Raíces (Ley 20.285)';

/**
 * Advertencia obligatoria en la leyenda. Dos motivos, no uno: la mediana de un
 * puñado de ventas no es un valor de mercado, y además la superficie que se ve
 * está INTERPOLADA — entre muestras el color es una estimación, no un dato
 * medido. Esto va en la leyenda, no en el pie de página.
 */
export const HEXBINS_DISCLAIMER =
  'Superficie interpolada desde medianas de $/m² de TERRENO. Señal de mercado, no tasación: el color de un punto cualquiera es una estimación suavizada, no el precio de ese predio.';

/** Color representativo de la capa (swatch del panel y cajetín del PNG). */
export const HEXBINS_COLOR = '#b12a90';
