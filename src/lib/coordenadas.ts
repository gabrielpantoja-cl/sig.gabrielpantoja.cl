/**
 * Coordenadas: proyección UTM y formato para el lector de cursor del mapa.
 *
 * Sin dependencias ni `server-only`: la usan el servidor (lectura de COG de
 * Sentinel-2 en `ndvi-serie.ts` y `ndvi-raster.ts`) y el navegador (barra de
 * coordenadas del cursor en `MapView`).
 */

/** UTM WGS84 por series de Krüger (precisión centimétrica dentro de la zona).
 *  En el hemisferio sur la norte lleva el falso norte de 10.000.000 m. */
export function lonLatToUtm(lon: number, lat: number, zona: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const lam0 = (((zona - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2;
  const C = ep2 * Math.cos(phi) ** 2;
  const A = Math.cos(phi) * (lam - lam0);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2
    + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) y += 10000000;
  return [x, y];
}

/**
 * Inversa de `lonLatToUtm` (Snyder, «Map Projections», ec. 8-17 a 8-25), para
 * el hemisferio sur: la norte trae el falso norte de 10.000.000 m. Ida y
 * vuelta queda bajo el milímetro dentro de la zona (ver tests).
 */
export function utmToLonLat(este: number, norte: number, zona: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const x = este - 500000;
  const y = norte - 10000000;
  const lam0 = (((zona - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);
  const phi = phi1 - ((N1 * Math.tan(phi1)) / R1) * (D * D / 2
    - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lam = lam0 + (D
    - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [(lam * 180) / Math.PI, (phi * 180) / Math.PI];
}

/** Zona UTM estándar de una longitud (1–60). Chile continental cae en 18 y 19. */
export function zonaUtm(lon: number): number {
  const normal = ((((lon + 180) % 360) + 360) % 360);
  return Math.min(60, Math.floor(normal / 6) + 1);
}

const miles = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

/** Grados decimales con 5 decimales (~1 m) y coma decimal: «-39,81421°». */
export const formatoGrados = (v: number): string => `${v.toFixed(5).replace('.', ',')}°`;

/** Grados, minutos y segundos con hemisferio, como Google Earth: «39°48'51,2" S». */
export function formatoGms(v: number, eje: 'lat' | 'lon'): string {
  const hemisferio = eje === 'lat' ? (v < 0 ? 'S' : 'N') : v < 0 ? 'O' : 'E';
  const abs = Math.abs(v);
  let g = Math.floor(abs);
  let m = Math.floor((abs - g) * 60);
  let s = Math.round(((abs - g) * 60 - m) * 600) / 10;
  if (s >= 60) { s = 0; m += 1; }
  if (m >= 60) { m = 0; g += 1; }
  return `${g}°${String(m).padStart(2, '0')}'${s.toFixed(1).replace('.', ',').padStart(4, '0')}" ${hemisferio}`;
}

export interface LecturaCursor {
  latitud: string;
  longitud: string;
  gms: string;
  utm: string;
}

/** Textos de la barra de coordenadas para un punto del mapa. */
export function lecturaCursor(lat: number, lng: number): LecturaCursor {
  const zona = zonaUtm(lng);
  const [e, n] = lonLatToUtm(lng, lat, zona);
  return {
    latitud: formatoGrados(lat),
    longitud: formatoGrados(lng),
    gms: `${formatoGms(lat, 'lat')}  ${formatoGms(lng, 'lon')}`,
    utm: `UTM ${zona}${lat < 0 ? 'S' : 'N'}  E ${miles.format(e)}  N ${miles.format(n)}`,
  };
}
