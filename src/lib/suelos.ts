/**
 * Capa Suelos Agrológicos — Capacidad de Uso (CIREN, clases I a VIII).
 *
 * Clasificación técnica interpretativa de los suelos según sus limitaciones
 * de uso agrícola (Clase I = arable sin limitaciones … Clase VIII = sin
 * aptitud agropecuaria ni forestal; N.C. = no clasificado). Dato oficial de
 * los Estudios Agrológicos de CIREN (Centro de Información de Recursos
 * Naturales, MINAGRI), 12 regiones estudiadas de Atacama a Aysén.
 *
 * A diferencia de las demás capas temáticas (GeoJSON estático), esta es una
 * CAPA DINÁMICA REMOTA: el dataset completo supera los 500 MB (una sola
 * región pesa ~40 MB en GeoJSON), así que el servidor de CIREN renderiza la
 * imagen con su simbología oficial y el navegador solo descarga UN PNG por
 * viewport (endpoint `export` del MapServer + L.ImageOverlay refrescado al
 * mover el mapa). No se usa el WMS teselado a propósito: Leaflet dispara ~40
 * GetMap simultáneos por vista y el servidor estatal colapsa (400/timeout);
 * con una sola export por movimiento el servicio responde. La clase de un
 * punto se consulta al hacer clic vía el endpoint `identify` (JSON).
 *
 * Nota: las 12 capas regionales tienen `defaultVisibility: false` en el
 * servicio — el export DEBE llevar `layers=show:0,...,11` o devuelve un PNG
 * transparente.
 */

const SUELOS_BASE = 'https://esri.ciren.cl/server';
const SUELOS_SERVICE = `${SUELOS_BASE}/rest/services/ESTUDIO_AGROLOGICO_SUELOS/MapServer`;

export const SUELOS_EXPORT_URL = `${SUELOS_SERVICE}/export`;

export const SUELOS_IDENTIFY_URL = `${SUELOS_SERVICE}/identify`;

/** Las 12 capas regionales del servicio (Atacama … Aysén), ids '0'–'11'. */
export const SUELOS_EXPORT_LAYERS = `show:${Array.from({ length: 12 }, (_, i) => i).join(',')}`;

/** Opacidad del raster sobre el mapa base. */
export const SUELOS_OPACITY = 0.6;

/**
 * Simbología oficial del servicio CIREN (colores extraídos de la leyenda del
 * MapServer, idénticos en las 12 regiones): rampa de aptitud verde → rojo.
 */
export const SUELOS_CLASSES: { label: string; color: string; description: string }[] = [
  { label: 'Clase I', color: '#006737', description: 'Arable, sin limitaciones' },
  { label: 'Clase II', color: '#66bc62', description: 'Arable, limitaciones leves' },
  { label: 'Clase III', color: '#d9ee8a', description: 'Arable, limitaciones moderadas' },
  { label: 'Clase IV', color: '#ffff34', description: 'Arable, limitaciones severas' },
  { label: 'Clase V', color: '#ffffc0', description: 'No arable, pastos/bosques (humedad)' },
  { label: 'Clase VI', color: '#fdad61', description: 'No arable, praderas/forestal' },
  { label: 'Clase VII', color: '#f36c43', description: 'No arable, forestal con manejo' },
  { label: 'Clase VIII', color: '#de76ad', description: 'Sin aptitud agropecuaria ni forestal' },
  { label: 'N.C.', color: '#ffffff', description: 'No clasificado' },
];

/** Color de una clase según el valor `textcaus` de la fuente (p. ej. "III"). */
export function suelosClassColor(textcaus: string | null | undefined): string {
  const t = (textcaus ?? '').trim();
  const found = SUELOS_CLASSES.find(
    (c) => c.label === `Clase ${t}` || c.label === t,
  );
  return found?.color ?? '#94a3b8';
}

export const SUELOS_ATTRIBUTION =
  'Fuente: CIREN · Estudios Agrológicos (Capacidad de Uso de los Suelos) · IDE MINAGRI';

export const SUELOS_SOURCE_URL = 'https://www.ciren.cl/productos/suelos-agrologicos/';
