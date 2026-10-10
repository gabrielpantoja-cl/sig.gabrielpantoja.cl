/**
 * Capa Humedales (MMA) — Inventario Nacional de Humedales + Humedales Urbanos
 * Declarados bajo la Ley 21.202.
 *
 * Ambas coberturas viven en el mismo MapServer oficial del Ministerio del
 * Medio Ambiente (`SIMBIO/SIMBIO_HUMEDALES`, ArcGIS 11.4, EPSG:32719):
 *
 * - Subcapa 0, **Inventario Nacional de Humedales**: 117.983 polígonos
 *   clasificados por ORDEN_1 (continentales, artificiales, marinos y
 *   costeros). Demasiado para un GeoJSON estático, así que se consume como
 *   CAPA DINÁMICA REMOTA: un PNG por viewport vía `/api/humedales/export` y
 *   consulta puntual vía `/api/humedales/identify`, igual que suelos CIREN.
 * - Subcapa 1, **Humedales Urbanos Declarados**: 137 polígonos con su
 *   resolución exenta de declaración. Es el dato con efecto normativo (la
 *   Ley 21.202 obliga a considerarlos en los instrumentos de planificación).
 *
 * Verificado el 2026-10-10: export de un viewport de comuna en ~0,5 s, de
 * escala regional (z8) en ~1,6 s; identify ~0,2 s. Sin CORS, así que el
 * proxy same-origin es obligatorio. Licencia: CC0 según el portal de Datos
 * Abiertos del MMA (lineasdebasepublicas.mma.gob.cl).
 *
 * La geometría es referencial: el inventario es un levantamiento
 * cartográfico, no un deslinde. La declaración de un humedal urbano solo
 * produce efectos según su resolución publicada; el popup enlaza a ella.
 */

/** Rutas same-origin: el servidor valida y normaliza las fallas del MMA. */
export const HUMEDALES_EXPORT_URL = '/api/humedales/export';
export const HUMEDALES_IDENTIFY_URL = '/api/humedales/identify';

/** Identificador humano estable mostrado cuando el proveedor no responde. */
export const HUMEDALES_SERVICE_NAME = 'MMA · SIMBIO_HUMEDALES · ArcGIS MapServer';

export const HUMEDALES_ATTRIBUTION =
  'Fuente: Ministerio del Medio Ambiente — Inventario Nacional de Humedales y Humedales Urbanos (Ley 21.202) · SIMBIO · CC0';
export const HUMEDALES_SOURCE_URL =
  'https://lineasdebasepublicas.mma.gob.cl/datos_abiertos/dataset/humedales-nacional';
export const HUMEDALES_DISCLAIMER =
  'Cartografía referencial: no es un deslinde. Los efectos de un humedal urbano dependen de su resolución de declaración.';

/** Zoom mínimo: a escala nacional el servidor rasteriza 118 mil polígonos. */
export const HUMEDALES_MIN_ZOOM = 8;
export const HUMEDALES_OPACITY = 0.75;

/** Swatch del panel: el tono de los humedales continentales del servicio. */
export const HUMEDALES_COLOR = '#41f0ca';

/** Simbología oficial (colores leídos de `/MapServer/legend` y del renderer). */
export const HUMEDALES_CLASSES: { label: string; color: string; description: string }[] = [
  { label: 'Continentales', color: '#41f0ca', description: 'Ríos, lagos, vegas, turberas, pantanos (96 % del inventario)' },
  { label: 'Artificiales', color: '#32aab8', description: 'Embalses, tranques y otros cuerpos construidos' },
  { label: 'Marinos y costeros', color: '#bff0f5', description: 'Estuarios, marismas, lagunas costeras' },
  { label: 'Sin clasificar', color: '#000000', description: 'Polígonos sin orden asignado en el inventario' },
];

/** Humedales urbanos declarados (Ley 21.202): relleno verde del servicio. */
export const HUMEDALES_URBANOS_COLOR = '#00fb37';

export type HumedalesOperation = 'export' | 'identify';

export type HumedalesStatus =
  | { kind: 'idle' }
  | { kind: 'zoom-required'; minZoom: number }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; service: string; operation: HumedalesOperation };

export interface HumedalesProxyErrorBody {
  error?: {
    code?: string;
    message?: string;
    service?: string;
    operation?: HumedalesOperation;
  };
}

/** Atributos públicos de un polígono del Inventario Nacional (subcapa 0). */
export interface HumedalInventarioProps {
  codigo: string | null;
  nombre: string | null;
  nombreMaster: string | null;
  orden1: string | null;
  orden2: string | null;
  orden3: string | null;
  orden4: string | null;
  orden5: string | null;
  hectareas: number | null;
  hectareasUrbanas: number | null;
  urlFicha: string | null;
}

/** Atributos públicos de un humedal urbano declarado (subcapa 1). */
export interface HumedalUrbanoProps {
  codigo: string | null;
  nombre: string | null;
  comuna: string | null;
  provincia: string | null;
  region: string | null;
  hectareas: number | null;
  proceso: string | null;
  resolucion: string | null;
  urlResolucion: string | null;
  urlExpediente: string | null;
}

export type HumedalIdentifyResult =
  | { kind: 'inventario'; attributes: HumedalInventarioProps }
  | { kind: 'urbano'; attributes: HumedalUrbanoProps };

/** Color de la clase ORDEN_1 tal como la devuelve `identify` («CONTINENTALES»…). */
export function humedalClassColor(orden1: string | null | undefined): string {
  const key = (orden1 ?? '').trim().toLocaleLowerCase('es-CL');
  const found = HUMEDALES_CLASSES.find((c) => c.label.toLocaleLowerCase('es-CL') === key);
  return found?.color ?? HUMEDALES_COLOR;
}
