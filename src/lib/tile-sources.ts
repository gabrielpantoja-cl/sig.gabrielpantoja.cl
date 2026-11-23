/**
 * Fuentes de un tile con respaldo al nivel padre (sin Leaflet, para poder
 * probarlo en Node). La capa que las usa vive en `lib/tile-fallback.ts`.
 */

/** Cuántos niveles hacia arriba se buscan antes de rendirse. */
export const MAX_FALLBACK_LEVELS = 4;

export type TileSource = {
  x: number;
  y: number;
  z: number;
  /** Lado del cuadrante del padre que cubre este tile, en px del padre. */
  cropSize: number;
  /** Esquina del cuadrante dentro del padre, en px del padre. */
  cropX: number;
  cropY: number;
};

/**
 * Fuentes a probar para el tile (x, y, z), en orden: él mismo y luego sus
 * ancestros hasta `levels` niveles arriba (sin bajar de z0).
 */
export function tileSources(
  x: number,
  y: number,
  z: number,
  tileSize = 256,
  levels = MAX_FALLBACK_LEVELS,
): TileSource[] {
  const out: TileSource[] = [];
  for (let k = 0; k <= levels && z - k >= 0; k++) {
    const f = 2 ** k;
    const cropSize = tileSize / f;
    out.push({
      x: Math.floor(x / f),
      y: Math.floor(y / f),
      z: z - k,
      cropSize,
      cropX: (x - Math.floor(x / f) * f) * cropSize,
      cropY: (y - Math.floor(y / f) * f) * cropSize,
    });
  }
  return out;
}
