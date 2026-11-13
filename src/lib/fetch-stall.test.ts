import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithStallRetry, HttpError, StallError } from '@/lib/fetch-stall';

const enc = new TextEncoder();

/** Respuesta que entrega `parts` y luego se cuelga si `hang`. */
function streamResponse(parts: string[], hang = false, signal?: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const p of parts) ctrl.enqueue(enc.encode(p));
      if (!hang) ctrl.close();
      signal?.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opts = (signal = new AbortController().signal) => ({
  signal,
  stallMs: 30,
  backoffMs: 1,
  attempts: 3,
});

describe('fetchWithStallRetry', () => {
  it('devuelve el cuerpo completo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => streamResponse(['[1,', '2]'])));
    const buf = await fetchWithStallRetry('/x', opts());
    expect(new TextDecoder().decode(buf)).toBe('[1,2]');
  });

  it('reintenta un cuerpo que se queda sin datos', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_u: string, init: RequestInit) =>
        streamResponse(['[1,'], true, init.signal as AbortSignal),
      )
      .mockImplementationOnce(async () => streamResponse(['[1,2]']));
    vi.stubGlobal('fetch', fetchMock);
    const buf = await fetchWithStallRetry('/x', opts());
    expect(new TextDecoder().decode(buf)).toBe('[1,2]');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reintenta si nunca llegan los encabezados y se rinde al agotar los intentos', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchWithStallRetry('/x', opts())).rejects.toBeInstanceOf(StallError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reintenta un 5xx pero no un 4xx', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f5 = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(streamResponse(['[]']));
    vi.stubGlobal('fetch', f5);
    await fetchWithStallRetry('/x', opts());
    expect(f5).toHaveBeenCalledTimes(2);

    const f4 = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    vi.stubGlobal('fetch', f4);
    await expect(fetchWithStallRetry('/x', opts())).rejects.toBeInstanceOf(HttpError);
    expect(f4).toHaveBeenCalledTimes(1);
  });

  it('no reintenta cuando el que llama aborta', async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          (init.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          ),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const p = fetchWithStallRetry('/x', { ...opts(ctrl.signal), stallMs: 10_000 });
    ctrl.abort();
    await expect(p).rejects.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
