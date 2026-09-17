/**
 * Serie temporal de NDVI (Sentinel-2 L2A) consultable por punto o polígono.
 *
 * Tipos, límites y textos compartidos entre el route handler y la UI. El
 * cálculo vive en `ndvi-serie.ts` (solo servidor). Diseño y cifras medidas en
 * `docs/roadmap.md` § 5.2.
 *
 * No es una capa ráster: no se dibuja NDVI sobre el mapa. Una sola fecha de
 * NDVI es engañosa —separa nativo de plantación con ~70 % de exactitud
 * balanceada en la costa valdiviana—; lo informativo es la curva estacional
 * de un lugar, con su variabilidad y la calidad del dato de cada mes.
 */

export type NdviGeometria =
  | { tipo: 'punto'; lat: number; lng: number; radio: number }
  | { tipo: 'poligono'; anillos: number[][][] };

export type NdviEstadoMes = 'ok' | 'hueco' | 'sin-escenas' | 'tiempo';

export interface NdviMes {
  /** `YYYY-MM`. */
  mes: string;
  /**
   * - `ok`: una escena con al menos `NDVI_FRACCION_MINIMA` del área válida.
   * - `hueco`: hubo escenas, pero ninguna dejó suficiente área despejada.
   * - `sin-escenas`: el catálogo no tiene pasadas utilizables ese mes.
   * - `tiempo`: no alcanzó a procesarse dentro del presupuesto de la consulta.
   */
  estado: NdviEstadoMes;
  /** Fecha (UTC) de la escena elegida, si la hubo. */
  fecha: string | null;
  escena: string | null;
  /** Nubosidad declarada para la cuadrícula completa de la escena (%). */
  nubesEscena: number | null;
  /** Elevación del sol en la escena (°). Bajo ~25° las sombras recortan área
   *  y la lectura corresponde a copas iluminadas. */
  elevacionSol: number | null;
  /** Píxeles de 10 m dentro del área consultada. */
  pixeles: number;
  /** Píxeles válidos tras la máscara SCL y el filtro de neblina. */
  validos: number;
  /** % del área descartada en la escena elegida (nube, sombra, neblina…). */
  descartado: number | null;
  p25: number | null;
  mediana: number | null;
  p75: number | null;
  /** Escenas del mes que se leyeron / que había en el catálogo. */
  leidas: number;
  disponibles: number;
}

export interface NdviSerie {
  geometria: NdviGeometria;
  desde: string;
  hasta: string;
  meses: NdviMes[];
  /** Años de adquisición presentes, para la atribución Copernicus. */
  anios: number[];
  resumen: {
    conDato: number;
    huecos: number;
    escenasLeidas: number;
    ms: number;
  };
}

/** Ventana de la serie: los últimos 36 meses completos. */
export const NDVI_MESES = 36;

/** Radio por defecto del buffer al consultar un punto (m). */
export const NDVI_RADIO_DEFECTO = 100;
export const NDVI_RADIO_MIN = 50;
export const NDVI_RADIO_MAX = 250;

/**
 * Tope del polígono: lado mayor de su caja en metros. Un predio de hasta
 * ~900 ha cabe; más grande obliga a leer varias baldosas COG por banda y
 * escena, y la consulta deja de caber en el tiempo de una función.
 */
export const NDVI_POLIGONO_LADO_MAX_M = 3000;
/** La máscara se calcula una vez por zona UTM, así que los vértices ya no
 *  multiplican por escena; un rodal CONAF de 105 ha trae 3.256. */
export const NDVI_POLIGONO_VERTICES_MAX = 20000;

/** Por debajo de esta elevación solar la UI advierte sombra de invierno. */
export const NDVI_SOL_BAJO = 25;

/** Fracción mínima del área que debe quedar válida para aceptar una escena. */
export const NDVI_FRACCION_MINIMA = 0.5;

export const NDVI_DESCARGO =
  'El NDVI mide verdor, no especie ni origen. No usar para identificar bosque nativo; para eso, capa de Recursos vegetacionales (CONAF).';

export const NDVI_FUENTE_URL = 'https://registry.opendata.aws/sentinel-2-l2a-cogs/';

/** Atribución exigida por la licencia de Copernicus, con los años de los datos. */
export function ndviAtribucion(anios: number[]): string {
  const rango = anios.length
    ? anios.length > 1
      ? `${anios[0]}–${anios[anios.length - 1]}`
      : String(anios[0])
    : '';
  return `Contiene datos modificados de Copernicus Sentinel${rango ? ` ${rango}` : ''}, vía Element 84 Earth Search / AWS Open Data`;
}

/**
 * Redondea la coordenada a 4 decimales (~11 m) antes de consultar: es la
 * misma precisión en cliente y servidor, así un segundo clic a pocos metros
 * reutiliza la respuesta cacheada en la CDN.
 */
export const redondearCoordenada = (v: number): number => Math.round(v * 1e4) / 1e4;
