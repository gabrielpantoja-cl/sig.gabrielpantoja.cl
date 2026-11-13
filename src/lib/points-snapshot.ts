import { fetchWithStallRetry } from '@/lib/fetch-stall';
import type { MapPoint } from '@/lib/types';

/**
 * Archivo estático con el conjunto completo de /api/points (sin filtros).
 *
 * Es la fuente PRINCIPAL de la carga sin filtros: la ruta `/api/points` queda
 * como respaldo si el archivo falla. Así la carga que más pesa (~61 MB sin
 * comprimir en nov-2026) no gasta la cuota de transferencia de ninguna base;
 * el almacenamiento que lo sirve no cobra salida de datos.
 *
 * Lo publica `scripts/publicar-puntos.sh` una vez al día, después de restaurar
 * la copia del respaldo, con `db/exportar-puntos.sql`: mismas columnas que
 * /api/points, ni una más. Dos objetos:
 *   - `points-<token>.json.gz`: inmutable; el nombre lleva la huella del
 *     conjunto (`datasetToken`), así nunca se mezclan versiones.
 *   - `manifest.json`: caché corta; dice cuál es el vigente.
 *
 * `NEXT_PUBLIC_PUNTOS_URL` es la URL pública de esa carpeta (no es una
 * credencial). Sin ella el mapa usa /api/points, como antes.
 */

export const PUNTOS_URL: string | null =
  process.env.NEXT_PUBLIC_PUNTOS_URL?.trim().replace(/\/+$/, '') || null;

export interface PointsManifest {
  version: 1;
  token: string;
  count: number;
  file: string;
  /** Tamaño sin comprimir, para la barra de avance. */
  bytes: number;
  generatedAt: string;
}

const ARCHIVO = /^points-(\d+\.\d+)\.json\.gz$/;

/** Valida la forma; `null` si algo no calza (el llamador cae a la API). */
export function parseManifest(raw: unknown): PointsManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) return null;
  if (typeof m.token !== 'string' || typeof m.file !== 'string') return null;
  const match = ARCHIVO.exec(m.file);
  // El nombre no puede apuntar fuera de la carpeta y debe llevar el mismo token.
  if (!match || match[1] !== m.token) return null;
  if (typeof m.count !== 'number' || !Number.isInteger(m.count) || m.count <= 0) return null;
  const bytes = typeof m.bytes === 'number' && m.bytes > 0 ? m.bytes : 0;
  return {
    version: 1,
    token: m.token,
    count: m.count,
    file: m.file,
    bytes,
    generatedAt: typeof m.generatedAt === 'string' ? m.generatedAt : '',
  };
}

/**
 * Descarga el conjunto desde el archivo publicado. Lanza si el manifiesto o el
 * archivo fallan o no calzan: quien llama decide caer a /api/points.
 */
export async function fetchSnapshotPoints(
  base: string,
  signal: AbortSignal,
  onProgress: (frac: number) => void,
): Promise<{ points: MapPoint[]; manifest: PointsManifest }> {
  const rawManifest = await fetchWithStallRetry(`${base}/manifest.json`, {
    signal,
    stallMs: 8_000,
    attempts: 2,
  });
  const manifest = parseManifest(JSON.parse(new TextDecoder().decode(rawManifest)));
  if (!manifest) throw new Error('manifest.json inválido');

  const buf = await fetchWithStallRetry(`${base}/${manifest.file}`, {
    signal,
    onProgress,
    totalBytes: manifest.bytes,
  });
  const points = JSON.parse(new TextDecoder().decode(buf)) as unknown;
  if (!Array.isArray(points) || points.length !== manifest.count) {
    throw new Error('el archivo de puntos no calza con su manifiesto');
  }
  return { points: points as MapPoint[], manifest };
}
