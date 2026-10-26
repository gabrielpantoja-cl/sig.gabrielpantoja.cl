'use client';

import { useEffect, useRef, useState } from 'react';
import type { Facets, MapPoint, Stats } from '@/lib/types';

/**
 * Descarga /api/points reportando el avance real de bytes. El servidor expone
 * X-Total-Bytes (tamaño descomprimido) porque tras el gzip de la CDN el
 * Content-Length deja de corresponder a los bytes que entrega el reader. Si el
 * header faltara, cae a una curva asintótica sobre el tamaño típico (~18 MB).
 */
async function fetchPointsWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (frac: number) => void,
): Promise<MapPoint[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) return res.json();

  const total = Number(res.headers.get('x-total-bytes')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total > 0 ? Math.min(received / total, 1) : received / (received + 6_000_000));
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as MapPoint[];
}

/**
 * Partes en que se pide /api/points. El conjunto completo (~31 MB) supera lo
 * que la CDN de Vercel cachea (~10 MB) y era MISS en cada visita; en 8 partes
 * cada respuesta queda bajo ~4 MB y se cachea. Las partes se piden en paralelo
 * (HTTP/2) y son disjuntas, así que concatenarlas da el conjunto completo.
 */
const POINT_PARTS = 8;

/** Descarga las partes en paralelo; el avance es el de los bytes de todas. */
async function fetchPointParts(
  suffix: string,
  signal: AbortSignal,
  onProgress: (frac: number) => void,
): Promise<MapPoint[]> {
  const fracs = new Array<number>(POINT_PARTS).fill(0);
  const sep = suffix ? '&' : '?';
  const parts = await Promise.all(
    fracs.map((_, i) =>
      fetchPointsWithProgress(`/api/points${suffix}${sep}part=${i}&parts=${POINT_PARTS}`, signal, (frac) => {
        fracs[i] = frac;
        onProgress(fracs.reduce((a, b) => a + b, 0) / POINT_PARTS);
      }),
    ),
  );
  return parts.flatMap((p) => (Array.isArray(p) ? p : []));
}

export interface CbrDataCallbacks {
  /** Avance 0..1 de la descarga de /api/points. */
  onDownloadProgress?: (fraction: number) => void;
  /** Puntos y estadísticas listos (falta pintarlos en el mapa). */
  /** Dataset decodificado; `count` = transacciones recibidas (puede ser 0). */
  onDecoded?: (count: number) => void;
  /** Falló la carga del query vigente. */
  onError?: () => void;
}

/**
 * Datos CBR de la página: facetas (una vez) y puntos + estadísticas para el
 * query de filtros vigente (`debouncedQs`, ya sin `?`).
 *
 * loading/error se DERIVAN comparando el query pedido con el resuelto/fallido
 * (nada de setState sincrónico dentro del efecto de fetch): si lo cargado no
 * corresponde al filtro actual, estamos cargando. Los callbacks se leen de un
 * ref, así cambiarlos no relanza la descarga de ~31 MB.
 */
export function useCbrData(debouncedQs: string, callbacks: CbrDataCallbacks = {}) {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadedQs, setLoadedQs] = useState<string | null>(null);
  const [errorQs, setErrorQs] = useState<string | null>(null);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Load facets once.
  useEffect(() => {
    fetch('/api/facets')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((f: Facets) => setFacets(f))
      .catch(() => {});
  }, []);

  // Fetch points + stats whenever the (debounced) filters change.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();

    const suffix = debouncedQs ? `?${debouncedQs}` : '';
    Promise.all([
      fetchPointParts(suffix, ctrl.signal, (frac) => {
        callbacksRef.current.onDownloadProgress?.(frac);
      }),
      fetch(`/api/stats${suffix}`, { signal: ctrl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),
    ])
      .then(([pts, st]: [MapPoint[], Stats]) => {
        if (id !== reqId.current) return;
        callbacksRef.current.onDecoded?.(Array.isArray(pts) ? pts.length : 0);
        setPoints(Array.isArray(pts) ? pts : []);
        setStats(st);
        setLoadedQs(debouncedQs);
      })
      .catch(() => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setErrorQs(debouncedQs);
        callbacksRef.current.onError?.();
      });

    return () => ctrl.abort();
  }, [debouncedQs]);

  const error = errorQs != null && errorQs === debouncedQs;
  const loading = !error && loadedQs !== debouncedQs;

  return { facets, points, stats, loading, error };
}
