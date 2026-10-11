'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  RASTER_DEBOUNCE_MS,
  rasterRequest,
  retryAfterSeconds,
  type RemoteRasterStatus,
} from '@/lib/remote-raster';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { waitForImage } from '@/components/map/raster-overlay';

/** Lee `{ error: { service, operation } }` del proxy; si no, el servicio dado. */
async function failure(
  response: Response,
  service: string,
): Promise<{ service: string; operation: 'export' | 'identify' }> {
  try {
    const body = (await response.json()) as { error?: { service?: unknown; operation?: unknown } };
    return {
      service: typeof body.error?.service === 'string' && body.error.service ? body.error.service : service,
      operation: body.error?.operation === 'identify' ? 'identify' : 'export',
    };
  } catch {
    return { service, operation: 'export' };
  }
}

/**
 * Ciclo de vida común de las capas remotas que se piden como UNA imagen por
 * vista a un proxy ArcGIS (suelos CIREN, recursos vegetacionales CONAF,
 * humedales MMA, propiedades rurales CIREN). Antes eran cuatro copias casi
 * iguales de este código.
 *
 * - **Una petición por vista, y solo si cambió**: espera `RASTER_DEBOUNCE_MS`
 *   tras el último `moveend` y ajusta el encuadre a una grilla
 *   (`rasterRequest`). Si la vista nueva cae en la misma celda que la imagen
 *   ya pedida, no se pide nada; si cae en otra, la URL es la misma que la de
 *   cualquier otro usuario en esa celda y la CDN la sirve desde caché.
 * - **Sin imagen vieja que parezca vigente**: al pedir una vista nueva se
 *   borra la anterior; la nueva se pre-carga antes de mostrarse y un contador
 *   de secuencia descarta respuestas fuera de orden.
 * - **429 no es una caída**: si el límite de consultas del SIG corta, el
 *   estado es `rate-limited` con los segundos de `Retry-After` y la capa
 *   reintenta sola al cumplirse el plazo. `error` queda para cuando el
 *   organismo no responde.
 * - **204** (ninguna capa del servicio cubre la vista) es una vista vacía
 *   válida, no una falla.
 *
 * El clic sobre la capa lo resuelve la consulta integrada (`usePointQuery`).
 */
export function useViewportRaster({
  mapRef,
  overlayRef,
  show,
  exportUrl,
  minZoom,
  serviceName,
  attribution,
  opacity,
  onStatusRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  overlayRef: RefObject<L.ImageOverlay | null>;
  show: boolean;
  exportUrl: string;
  minZoom: number;
  serviceName: string;
  attribution: string;
  /** Opacidad vigente al crear la capa (los cambios los aplica MapView). */
  opacity: () => number;
  onStatusRef?: RefObject<((status: RemoteRasterStatus) => void) | undefined>;
  reorderOverlays?: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const report = (status: RemoteRasterStatus) => onStatusRef?.current?.(status);

    if (overlayRef.current) {
      map.removeLayer(overlayRef.current);
      overlayRef.current = null;
    }
    if (!show) {
      report({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacity(),
      attribution,
      interactive: false,
    }).addTo(map);
    overlayRef.current = overlay;

    let sequence = 0;
    let controller: AbortController | null = null;
    let activeBlobUrl: string | null = null;
    /** Petición mostrada o en vuelo: si la vista nueva da la misma, no se pide. */
    let currentKey: string | null = null;
    let debounce = 0;
    let retryTimer = 0;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      window.clearTimeout(retryTimer);
      if (map.getZoom() < minZoom) {
        sequence++;
        controller?.abort();
        currentKey = null;
        clearRaster(map.getBounds());
        report({ kind: 'zoom-required', minZoom });
        return;
      }
      const req = rasterRequest(map.getCenter(), map.getZoom(), map.getSize());
      if (req.key === currentKey) return;

      const id = ++sequence;
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      currentKey = req.key;
      const [west, south, east, north] = req.bbox;
      const bounds = L.latLngBounds([south, west], [north, east]);
      clearRaster(bounds);
      report({ kind: 'loading' });

      const params = new URLSearchParams({ bbox: req.bbox.join(','), size: req.size.join(',') });
      let candidate: string | null = null;
      try {
        const response = await fetch(`${exportUrl}?${params}`, { signal: ctrl.signal });
        if (id !== sequence || ctrl.signal.aborted) return;
        if (response.status === 204) {
          report({ kind: 'ready' });
          return;
        }
        if (response.status === 429) {
          // El límite del SIG, no el organismo: reintenta solo cuando se libere.
          const retryIn = retryAfterSeconds(response);
          currentKey = null;
          report({ kind: 'rate-limited', retryIn });
          retryTimer = window.setTimeout(() => void refresh(), retryIn * 1000);
          return;
        }
        if (!response.ok) {
          currentKey = null;
          report({ kind: 'error', ...(await failure(response, serviceName)) });
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error(`${serviceName}: la respuesta no es PNG`);
        candidate = URL.createObjectURL(blob);
        await waitForImage(candidate);
        if (id !== sequence || ctrl.signal.aborted || overlayRef.current !== overlay) {
          URL.revokeObjectURL(candidate);
          return;
        }
        overlay.setUrl(candidate);
        overlay.setBounds(bounds);
        activeBlobUrl = candidate;
        candidate = null;
        reorderOverlays?.();
        report({ kind: 'ready' });
      } catch (error) {
        if (candidate) URL.revokeObjectURL(candidate);
        if (ctrl.signal.aborted || id !== sequence) return;
        currentKey = null;
        console.error(`No se pudo cargar la capa remota (${serviceName}).`, error);
        report({ kind: 'error', service: serviceName, operation: 'export' });
      }
    };

    const onMoveEnd = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refresh(), RASTER_DEBOUNCE_MS);
    };
    map.on('moveend', onMoveEnd);
    void refresh();

    return () => {
      sequence++;
      window.clearTimeout(debounce);
      window.clearTimeout(retryTimer);
      controller?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
      // El mapa VIGENTE: al desmontar, MapView ya lo destruyó y dejó la ref en null.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const current = mapRef.current;
      if (current?.hasLayer(overlay)) current.removeLayer(overlay);
      if (overlayRef.current === overlay) overlayRef.current = null;
    };
    // `opacity` se lee al crear la capa; no debe re-crearla en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, exportUrl, minZoom, serviceName, attribution, mapRef, overlayRef, onStatusRef, reorderOverlays]);
}
