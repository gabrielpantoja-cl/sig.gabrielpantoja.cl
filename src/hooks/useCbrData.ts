'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DATASET_POLL_MS,
  withDataset,
  type DatasetVersion,
} from '@/lib/dataset';
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

/** Huella del conjunto; `null` si el sondeo falló (la red, un 429, un 500). */
async function fetchDatasetVersion(): Promise<DatasetVersion | null> {
  try {
    const res = await fetch('/api/dataset');
    if (!res.ok) return null;
    const info = (await res.json()) as DatasetVersion;
    return typeof info?.token === 'string' ? info : null;
  } catch {
    return null;
  }
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
 * Datos CBR de la página: facetas y puntos + estadísticas para el query de
 * filtros vigente (`debouncedQs`, ya sin `?`).
 *
 * ## Versión del conjunto (`ds`)
 *
 * Antes de pedir nada se resuelve la huella del conjunto en `/api/dataset` y
 * se adjunta como `?ds=<token>` a puntos, estadísticas y facetas. El token es
 * parte de la clave de caché del CDN: mientras los datos no cambian todo se
 * sirve desde el borde, y en cuanto entra una carga nueva la clave cambia sola
 * y la respuesta vuelve a salir de Neon. Sin esto, `/api/points` sin filtros
 * —la ruta caliente, `s-maxage=3600` + `stale-while-revalidate=86400`— podía
 * servir durante un día la copia anterior a la carga, mientras cualquier
 * filtro, al cambiar la clave de caché, mostraba los datos nuevos: el mapa
 * parecía esconder los años antiguos hasta que se filtraba. Ver
 * `lib/dataset.ts`.
 *
 * Si `/api/dataset` falla no se bloquea nada: se carga sin token, es decir con
 * el comportamiento de caché anterior.
 *
 * ## Datos nuevos sin recargar
 *
 * El sondeo sigue corriendo con la pestaña visible, pero NUNCA recarga solo:
 * hacerlo en medio de una lectura botaría el encuadre y la vista. Expone
 * `datosNuevos` para que la página lo ofrezca, y `recargarDatos()` vuelve a
 * pedir el conjunto en sitio, conservando filtros, encuadre y capas KML.
 *
 * loading/error se DERIVAN comparando lo pedido con lo resuelto/fallido (nada
 * de setState sincrónico dentro del efecto de fetch): si lo cargado no
 * corresponde al filtro Y a la versión actuales, estamos cargando. Los
 * callbacks se leen de un ref, así cambiarlos no relanza la descarga de ~31 MB.
 */
export function useCbrData(debouncedQs: string, callbacks: CbrDataCallbacks = {}) {
  const [facets, setFacets] = useState<Facets | null>(null);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // `aplicada` es la versión con la que se cargó lo que está en pantalla;
  // `ultima` es la que reporta el servidor ahora. Que difieran es justamente
  // la señal de «hay datos nuevos». `sondeada` evita pedir los ~31 MB antes
  // de saber el token: hacerlo sembraría la caché con la clave sin `ds`.
  const [aplicada, setAplicada] = useState<DatasetVersion | null>(null);
  const [ultima, setUltima] = useState<DatasetVersion | null>(null);
  const [sondeada, setSondeada] = useState(false);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  // Primer sondeo + reintento periódico con la pestaña visible. El primer
  // resultado se ADOPTA (aplicada = ultima): solo los posteriores pueden
  // marcar «datos nuevos». El ciclo es uno solo y encadenado, como en
  // `UpdateNotice`, para que dos sondeos no se solapen con la red lenta.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        const info = await fetchDatasetVersion();
        if (stopped) return;
        if (info) {
          setUltima(info);
          // Sin versión aplicada todavía (primer sondeo, o uno que falló y
          // dejó al mapa en el modo sin token) se adopta sin avisar: no hay
          // «datos nuevos» contra los que comparar.
          setAplicada((prev) => prev ?? info);
        }
        setSondeada(true);
      }
      if (!stopped) timer = setTimeout(tick, DATASET_POLL_MS);
    };
    timer = setTimeout(tick, 0);

    // Volver a una pestaña olvidada es cuando más probable es que la carga de
    // datos haya terminado: se comprueba de inmediato.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const token = aplicada?.token ?? null;
  // Clave de lo pedido: filtros Y versión. Cambiar cualquiera de las dos es
  // una carga nueva, y `loading` se deriva de comparar esta clave con la
  // resuelta — así el aviso de carga también cubre el refresco de datos.
  const key = `${token ?? ''}|${debouncedQs}`;

  // Facetas: también van por versión, si no el histograma de años y la lista
  // de comunas seguirían describiendo el conjunto viejo tras una carga.
  useEffect(() => {
    if (!sondeada) return;
    const ctrl = new AbortController();
    const qs = withDataset('', token);
    fetch(`/api/facets${qs ? `?${qs}` : ''}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((f: Facets) => setFacets(f))
      .catch(() => {});
    return () => ctrl.abort();
  }, [sondeada, token]);

  // Fetch points + stats whenever the (debounced) filters or the dataset
  // version change.
  const reqId = useRef(0);
  useEffect(() => {
    if (!sondeada) return;
    const id = ++reqId.current;
    const ctrl = new AbortController();

    const qs = withDataset(debouncedQs, token);
    const suffix = qs ? `?${qs}` : '';
    const pedida = `${token ?? ''}|${debouncedQs}`;
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
        setLoadedKey(pedida);
      })
      .catch(() => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setErrorKey(pedida);
        callbacksRef.current.onError?.();
      });

    return () => ctrl.abort();
  }, [sondeada, token, debouncedQs]);

  /** Vuelve a pedir el conjunto con la versión nueva, sin recargar la página. */
  const recargarDatos = useCallback(() => {
    setUltima((info) => {
      if (info) setAplicada(info);
      return info;
    });
  }, []);

  const error = errorKey != null && errorKey === key;
  const loading = !error && loadedKey !== key;

  // Hay datos nuevos cuando el servidor reporta una huella distinta de la que
  // está en pantalla. `aplicada` siempre existe aquí salvo que el sondeo haya
  // fallado desde el inicio, caso en que no hay nada que comparar.
  const datosNuevos =
    ultima != null && aplicada != null && ultima.token !== aplicada.token
      ? { desde: aplicada.count, hasta: ultima.count }
      : null;

  return {
    facets,
    points,
    stats,
    loading,
    error,
    /** Token de la versión en pantalla; `null` si el sondeo falló. */
    datasetToken: token,
    /** Transacciones geolocalizadas del conjunto en pantalla; `null` si el sondeo falló. */
    datasetCount: aplicada?.count ?? null,
    /** Diferencia pendiente de aplicar, o `null` si estamos al día. */
    datosNuevos,
    recargarDatos,
  };
}
