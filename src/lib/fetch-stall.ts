/**
 * Descarga con detección de cuelgue y reintento, para las partes de
 * /api/points.
 *
 * El 2026-11-13, con la base de respaldo atendiendo, la primera visita tras un
 * deploy (caché de la CDN vacía) dejaba 3 de 8 partes colgadas sin fin: el
 * mapa se quedaba en 39–46 % para siempre, mientras las mismas URLs pedidas de
 * nuevo respondían en 1–3 s. Un intento se da por colgado si pasa `stallMs`
 * sin recibir bytes (ni encabezados ni datos); se mide el silencio y no el
 * tiempo total, para no cortar una conexión lenta que sigue bajando.
 *
 * Se reintenta la MISMA URL: cambiarla rompería la clave de caché de la CDN y
 * mandaría la parte de vuelta a la base. No se reintenta un 4xx (salvo 429) ni
 * cuando el que llama aborta.
 */

export interface StallRetryOptions {
  signal: AbortSignal;
  /** Avance del intento en curso, 0–1; vuelve a 0 al reintentar. */
  onProgress?: (frac: number) => void;
  stallMs?: number;
  /** Intentos en total (1 = sin reintento). */
  attempts?: number;
  /** Espera antes del reintento n (1-based): `backoffMs * n`. */
  backoffMs?: number;
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

export class StallError extends Error {
  constructor(ms: number) {
    super(`sin datos por ${ms} ms`);
    this.name = 'StallError';
  }
}

function retriable(err: unknown): boolean {
  if (err instanceof StallError) return true;
  if (err instanceof HttpError) return err.status >= 500 || err.status === 429;
  // TypeError de fetch = falla de red.
  return err instanceof TypeError;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function attempt(
  url: string,
  parent: AbortSignal,
  stallMs: number,
  onProgress?: (frac: number) => void,
): Promise<Uint8Array> {
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort(parent.reason);
  if (parent.aborted) ctrl.abort(parent.reason);
  else parent.addEventListener('abort', onParentAbort, { once: true });

  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, stallMs);
  };

  try {
    arm();
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status);
    arm();

    // El servidor expone X-Total-Bytes (descomprimido): tras el gzip de la CDN
    // Content-Length ya no corresponde a lo que entrega el reader.
    const total = Number(res.headers.get('x-total-bytes')) || 0;
    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      onProgress?.(1);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      chunks.push(value);
      received += value.length;
      // Sin el encabezado, curva asintótica sobre ~6 MB.
      onProgress?.(total > 0 ? Math.min(received / total, 1) : received / (received + 6_000_000));
    }
    const buf = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.length;
    }
    return buf;
  } catch (err) {
    if (stalled && !parent.aborted) throw new StallError(stallMs);
    throw err;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onParentAbort);
  }
}

/** Bytes del cuerpo; lanza el último error si se agotan los intentos. */
export async function fetchWithStallRetry(
  url: string,
  { signal, onProgress, stallMs = 15_000, attempts = 3, backoffMs = 1_000 }: StallRetryOptions,
): Promise<Uint8Array> {
  let last: unknown;
  for (let n = 0; n < attempts; n++) {
    if (n > 0) {
      onProgress?.(0);
      await wait(backoffMs * n, signal);
    }
    try {
      return await attempt(url, signal, stallMs, onProgress);
    } catch (err) {
      if (signal.aborted || !retriable(err)) throw err;
      last = err;
      console.warn(`[points] intento ${n + 1}/${attempts} falló (${(err as Error).message}): ${url}`);
    }
  }
  throw last;
}
