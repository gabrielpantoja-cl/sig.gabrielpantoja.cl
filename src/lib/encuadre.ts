/**
 * Encuadre de una selección de transacciones: la extensión que el mapa debe
 * mostrar al elegir una comuna en el filtro.
 *
 * No es el mínimo y máximo crudos: un solo punto mal geocodificado (en otra
 * región, o en el 0,0) haría volar el mapa a medio país. Con 20 o más puntos
 * se recorta el 2 % de cada borde, por eje; con menos, cada punto cuenta.
 */

/** Por debajo de esto un percentil no recorta nada útil: se usan todos. */
const MIN_PARA_RECORTAR = 20;
const RECORTE = 0.02;

/** [sur, oeste, norte, este] en grados WGS84. */
export type Extension = [number, number, number, number];

function cuantil(ordenados: number[], q: number): number {
  return ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.round(q * (ordenados.length - 1))))];
}

export function extensionRobusta(points: readonly { lat: number; lng: number }[]): Extension | null {
  const validos = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (validos.length === 0) return null;
  const lats = validos.map((p) => p.lat).sort((a, b) => a - b);
  const lngs = validos.map((p) => p.lng).sort((a, b) => a - b);
  const q = validos.length >= MIN_PARA_RECORTAR ? RECORTE : 0;
  return [cuantil(lats, q), cuantil(lngs, q), cuantil(lats, 1 - q), cuantil(lngs, 1 - q)];
}
