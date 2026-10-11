'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  HUMEDALES_EXPORT_URL,
  HUMEDALES_MIN_ZOOM,
  HUMEDALES_SERVICE_NAME,
  type HumedalesStatus,
} from '@/lib/humedales';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { humedalesFailureDetails, waitForImage } from '@/components/map/raster-overlay';

/**
 * Humedales (MMA) — capa dinámica remota, mismo ciclo que suelos CIREN: UN
 * PNG por viewport contra `/api/humedales/export` sobre un L.ImageOverlay
 * refrescado en `moveend` (el clic lo resuelve `usePointQuery`). La imagen anterior se
 * borra al pedir otra para que una caída del MMA nunca deje en pantalla un
 * raster viejo que parezca vigente; la nueva se pre-carga antes de mostrarse
 * y un contador de secuencia descarta respuestas fuera de orden. El estado
 * (`zoom-required` / `loading` / `ready` / `error`) sube a la leyenda.
 */
export function useHumedalesLayer({
  mapRef,
  humedalesRef,
  showHumedales,
  opacityRef,
  onHumedalesStatusRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  humedalesRef: RefObject<L.ImageOverlay | null>;
  showHumedales: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onHumedalesStatusRef: RefObject<((status: HumedalesStatus) => void) | undefined>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (humedalesRef.current) {
      map.removeLayer(humedalesRef.current);
      humedalesRef.current = null;
    }
    if (!showHumedales) {
      onHumedalesStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.humedales,
      attribution: 'MMA · Humedales',
      interactive: false,
    }).addTo(map);
    humedalesRef.current = overlay;

    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let activeBlobUrl: string | null = null;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++exportSequence;
      exportController?.abort();
      exportController = null;
      clearRaster(bounds);
      // A escala nacional el servidor tendría que rasterizar 118 mil polígonos.
      if (map.getZoom() < HUMEDALES_MIN_ZOOM) {
        onHumedalesStatusRef.current?.({ kind: 'zoom-required', minZoom: HUMEDALES_MIN_ZOOM });
        return;
      }
      onHumedalesStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        size: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y))].join(','),
      });
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(`${HUMEDALES_EXPORT_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) {
          const failure = await humedalesFailureDetails(response, 'export');
          if (id === exportSequence && !controller.signal.aborted) {
            onHumedalesStatusRef.current?.({ kind: 'error', ...failure });
          }
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid wetlands response');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || humedalesRef.current !== overlay) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        overlay.setUrl(candidateBlobUrl);
        overlay.setBounds(bounds);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        reorderOverlays();
        onHumedalesStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la cobertura de humedales del MMA.', error);
        onHumedalesStatusRef.current?.({ kind: 'error', service: HUMEDALES_SERVICE_NAME, operation: 'export' });
      }
    };

    const onMoveEnd = () => void refresh();
    map.on('moveend', onMoveEnd);
    void refresh();



    return () => {
      exportSequence++;
      exportController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (humedalesRef.current === overlay) humedalesRef.current = null;
    };
  }, [showHumedales, mapRef, onHumedalesStatusRef, opacityRef, humedalesRef, reorderOverlays]);
}
