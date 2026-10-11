/**
 * «Ir a mi ubicación»: lógica pura del control de geolocalización del mapa
 * (`src/components/map/useLocateControl.ts`). Separada del DOM para testearla.
 *
 * Privacidad: la posición se usa solo en el navegador para centrar el mapa.
 * Nunca se envía al servidor ni a la analítica (el evento `locate` lleva solo
 * `ok` y, si falló, el código de error).
 */

/** Opciones de `getCurrentPosition`: GPS si lo hay, y no esperar para siempre. */
export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 30_000,
};

/** Zoom máximo al centrar: más cerca no aporta con la precisión de un GPS. */
export const GEO_MAX_ZOOM = 17;

export type GeoErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

/** Traduce el código numérico de `GeolocationPositionError` (1, 2, 3). */
export function geoErrorCode(code: number): GeoErrorCode {
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

export function geoErrorMessage(code: GeoErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'Este navegador no permite obtener la ubicación (requiere una conexión segura HTTPS).';
    case 'denied':
      return 'Permiso de ubicación denegado. Actívalo para este sitio en la configuración del navegador.';
    case 'timeout':
      return 'La ubicación tardó demasiado. Intenta de nuevo, idealmente al aire libre.';
    case 'unavailable':
      return 'No se pudo determinar la ubicación (sin señal GPS ni de red).';
  }
}

/**
 * Precisión declarada por el dispositivo, redondeada como la leería un perito:
 * «±8 m», «±120 m», «±3,2 km». Un GPS en terreno da metros; una ubicación por
 * IP o wifi puede dar kilómetros, y el usuario tiene que saberlo.
 */
export function formatoPrecision(metros: number): string {
  if (!Number.isFinite(metros) || metros < 0) return 'precisión desconocida';
  if (metros < 1000) return `±${Math.max(1, Math.round(metros)).toLocaleString('es-CL')} m`;
  return `±${(metros / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} km`;
}

/** Mensaje tras ubicar: incluye la precisión, y advierte si es gruesa. */
export function geoSuccessMessage(metros: number): string {
  const base = `Tu ubicación (${formatoPrecision(metros)})`;
  return metros > 500 ? `${base}: precisión baja, probablemente sin GPS.` : `${base}.`;
}
