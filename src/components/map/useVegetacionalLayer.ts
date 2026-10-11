'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  VEGETACIONAL_EXPORT_URL,
  VEGETACIONAL_MIN_ZOOM,
} from '@/lib/vegetacional';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { waitForImage } from '@/components/map/raster-overlay';

/**
 * Catastro CONAF — raster dinámico por viewport contra el MapServer oficial.
 * El dataset vectorial regional alcanza cientos de MB, por lo que se sirve
 * un PNG same-origin; los atributos de un punto los consulta `usePointQuery`.
 */
export function useVegetacionalLayer({
  mapRef,
  vegetacionalRef,
  showVegetacional,
  opacityRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  vegetacionalRef: RefObject<L.ImageOverlay | null>;
  showVegetacional: boolean;
  opacityRef: RefObject<LayerOpacity>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (vegetacionalRef.current) map.removeLayer(vegetacionalRef.current);
    vegetacionalRef.current = null;
    if (!showVegetacional) return;

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.vegetacional,
      interactive: false,
      attribution: 'CONAF · Recursos vegetacionales',
    }).addTo(map);
    vegetacionalRef.current = overlay;
    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let activeBlobUrl: string | null = null;

    const clearRaster = () => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    };

    const refresh = async () => {
      const sequence = ++exportSequence;
      exportController?.abort();
      if (map.getZoom() < VEGETACIONAL_MIN_ZOOM) {
        clearRaster();
        return;
      }
      const bounds = map.getBounds();
      const size = map.getSize();
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        size: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y))].join(','),
      });
      try {
        const response = await fetch(`${VEGETACIONAL_EXPORT_URL}?${params}`, { signal: controller.signal });
        if (!response.ok || sequence !== exportSequence) return;
        const blobUrl = URL.createObjectURL(await response.blob());
        await waitForImage(blobUrl);
        if (sequence !== exportSequence || !mapRef.current) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = blobUrl;
        overlay.setBounds(bounds);
        overlay.setUrl(blobUrl);
        reorderOverlays();
      } catch {
        if (!controller.signal.aborted) clearRaster();
      }
    };


    void refresh();
    map.on('moveend', refresh);
    return () => {
      exportController?.abort();
      map.off('moveend', refresh);
      clearRaster();
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (vegetacionalRef.current === overlay) vegetacionalRef.current = null;
    };
  }, [showVegetacional, reorderOverlays, mapRef, opacityRef, vegetacionalRef]);
}
