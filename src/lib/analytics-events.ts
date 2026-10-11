/**
 * Catálogo de eventos de la analítica interna, compartido por el cliente
 * (`lib/analytics.ts`) y la ruta que los recibe (`app/api/analytics`).
 *
 * Es una lista CERRADA: el servidor descarta cualquier nombre que no esté
 * acá, así nadie puede llenar la tabla con eventos inventados ni usarla de
 * almacén arbitrario. Agregar un evento = agregarlo a esta lista.
 *
 * Diseño de privacidad (Ley 19.628, preparado para Ley 21.719):
 * - Sin cookies de seguimiento: la sesión es un id aleatorio que vive en
 *   memoria y muere al recargar la pestaña. La única cookie es la de
 *   exclusión (`ANALYTICS_OPT_OUT_COOKIE`), que apaga el registro.
 * - El visitante se cuenta con un hash diario (HMAC de IP + user agent con
 *   un secreto que rota por día). La IP nunca se guarda y el hash no permite
 *   seguir a nadie de un día al siguiente.
 * - Ubicación solo a nivel país/región/ciudad (cabeceras geo de Vercel).
 * - Se respetan Do Not Track y Global Privacy Control.
 * - Las props NUNCA llevan valores de filtros ni texto libre del usuario
 *   (búsquedas, ROL, predio): solo nombres de capas, formatos y duraciones.
 */

export const ANALYTICS_EVENTS = [
  'pageview', // carga de la página (lleva utm_*, referrer y ancho de pantalla)
  'boot', // mapa listo: ms desde la navegación hasta los clusters pintados
  'boot_error', // falló la descarga inicial de puntos/estadísticas
  'leave', // la pestaña se ocultó: segundos de uso activo acumulados
  'layer_on', // se encendió una capa temática (prop `layer`)
  'filter', // cambió el conjunto de filtros activos (solo NOMBRES de campos)
  'geocode', // se eligió un resultado del buscador de direcciones
  'rol_search', // búsqueda de ROL rural en CIREN
  'basemap', // cambio de mapa base (prop `basemap`)
  'export_png', // exportación del mapa a PNG (prop `ok`)
  'export_data', // descarga CSV/GeoJSON (prop `format`)
  'ndvi_query', // consulta puntual NDVI sobre Sentinel-2
  'kml_upload', // el usuario cargó un KML propio
  'boot_skip', // saltó la pantalla de carga (prop `pct`: avance al saltar)
  'locate', // «Ir a mi ubicación» (props `ok`, `error`; NUNCA la posición)
  'share', // «Compartir vista» (prop `method`; NUNCA la URL, que lleva filtros)
] as const;

/**
 * Eventos que emite SOLO el servidor (`src/proxy.ts`), por cada consulta a la
 * API de datos — también las que no pasan por el navegador (curl, scripts).
 * No están en `ANALYTICS_EVENTS`, así el cliente no puede falsificarlos.
 */
export const ANALYTICS_SERVER_EVENTS = [
  'api_points', // GET /api/points (props: source, client, bot, fields)
  'api_export', // GET /api/export (props: source, client, bot, fields, format)
] as const;

/**
 * Cookie de exclusión: quien entra con `?analytics=off` deja de registrarse
 * (páginas vistas, funciones y llamadas a la API desde ese navegador);
 * `?analytics=on` la borra. Sirve para no contar las visitas del administrador.
 */
export const ANALYTICS_OPT_OUT_COOKIE = 'sig_no_analytics';

export type AnalyticsClientEvent = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsServerEvent = (typeof ANALYTICS_SERVER_EVENTS)[number];
export type AnalyticsEvent = AnalyticsClientEvent | AnalyticsServerEvent;

export type AnalyticsProps = Record<string, string | number | boolean>;

/** Cuerpo que el cliente envía a `POST /api/analytics`. */
export type AnalyticsPayload = {
  e: AnalyticsEvent;
  /** Id de sesión aleatorio, en memoria (ver arriba). */
  s: string;
  /** Ruta de la página, sin query string. */
  p: string;
  /** Ancho de la ventana en px: distingue mobile de escritorio de verdad. */
  w?: number;
  /** Host del referrer (solo en `pageview`). */
  r?: string;
  props?: AnalyticsProps;
};

/** Solo eventos de cliente: lo que acepta `POST /api/analytics`. */
export function isAnalyticsEvent(value: unknown): value is AnalyticsClientEvent {
  return typeof value === 'string' && (ANALYTICS_EVENTS as readonly string[]).includes(value);
}
