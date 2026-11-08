import type { RemoteRasterStatus } from '@/lib/remote-raster';

/**
 * Capa Deslindes Prediales (SII) — polígonos de predios del Servicio de
 * Impuestos Internos servidos como WMS dinámico.
 *
 * La capa de polígonos CIREN (`Propiedades rurales`) a ratos se cae y está
 * desactualizada, así que esta capa consume directamente el WMS del SII como
 * una CAPA DINÁMICA REMOTA: un PNG por viewport mediante el proxy
 * `/api/sii-predios/export`, igual que suelos CIREN, CONAF, humedales MMA y
 * propiedades rurales CIREN. No hay GeoJSON local ni ETL; el proxy valida
 * parámetros, aplica timeout y normaliza fallas del servicio.
 *
 * El endpoint del SII (`wmsProxyService/call`) requiere autenticación de sesión
 * en su visor oficial; desde este SIG se consulta de forma anónima a través del
 * proxy same-origin, así que el servicio puede responder 401/403 o 400 según
 * el estado de su propio servidor. Esas fallas se reportan como `error` con el
 * nombre del servicio, nunca como «sin predios».
 *
 * La geometría es referencial: los deslindes del SII son un apoyo cartográfico,
 * no acreditan dominio ni vigencia registral. El ROL es el identificador
 * predial del SII (público, no PII bajo Ley 19.628).
 */

/** Ruta same-origin: el servidor valida y normaliza las fallas del SII. */
export const SII_PREDIOS_EXPORT_URL = '/api/sii-predios/export';

/** Identificador humano estable mostrado cuando el proveedor no responde. */
export const SII_PREDIOS_SERVICE_NAME =
  'SII · Deslindes Prediales · WMS (www4.sii.cl)';

/** Atribución visible en la leyenda y el panel de capas. */
export const SII_PREDIOS_ATTRIBUTION =
  'Fuente: Servicio de Impuestos Internos (SII) · Deslindes prediales WMS · Referencial';

/** Enlace al visor/oficial del SII para consultar la fuente. */
export const SII_PREDIOS_SOURCE_URL = 'https://www.sii.cl/';

/** Capa WMS por defecto. Se puede solicitar otra por comuna vía query `layer`. */
export const SII_PREDIOS_DEFAULT_LAYER = 'sii:BR_CART_PANGUIPULLI_WMS';

/** Mismo estado que las demás capas remotas por vista (`useViewportRaster`). */
export type SiiPrediosStatus = RemoteRasterStatus;

/** Opacidad del raster sobre el mapa base. */
export const SII_PREDIOS_OPACITY = 0.7;

/** Zoom mínimo: un WMS a escala nacional rasteriza toda la cobertura del país. */
export const SII_PREDIOS_MIN_ZOOM = 10;

/** Color del swatch del panel (tono tierra, distinto de CIREN/CONAF). */
export const SII_PREDIOS_COLOR = '#b45309';

export type SiiPrediosOperation = 'export';

export interface SiiPrediosProxyErrorBody {
  error?: {
    code?: string;
    message?: string;
    service?: string;
    operation?: SiiPrediosOperation;
  };
}
