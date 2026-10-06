'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  VEGETACIONAL_EXPORT_URL,
  VEGETACIONAL_IDENTIFY_URL,
  VEGETACIONAL_MIN_ZOOM,
  type VegetacionalProps,
} from '@/lib/vegetacional';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { buildVegetacionalPopup } from '@/lib/map-popups';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { waitForImage } from '@/components/map/raster-overlay';

/**
 * Catastro CONAF — raster dinámico por viewport contra el MapServer oficial.
 * El dataset vectorial regional alcanza cientos de MB, por lo que se sirve
 * un PNG same-origin y los atributos se consultan puntualmente con identify.
 */
export function useVegetacionalLayer({
  mapRef,
  vegetacionalRef,
  showVegetacional,
  opacityRef,
  ndviModeRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  vegetacionalRef: RefObject<L.ImageOverlay | null>;
  showVegetacional: boolean;
  opacityRef: RefObject<LayerOpacity>;
  ndviModeRef: RefObject<boolean>;
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
    let identifyController: AbortController | null = null;
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

    const identify = async (event: L.LeafletMouseEvent) => {
      if (ndviModeRef.current) return;
      if (map.getZoom() < VEGETACIONAL_MIN_ZOOM) return;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: [event.latlng.lng, event.latlng.lat].join(','),
        mapExtent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        imageDisplay: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y)), 96].join(','),
        tolerance: '3',
      });
      try {
        const response = await fetch(`${VEGETACIONAL_IDENTIFY_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { results?: Array<{ layerName: string; attributes: VegetacionalProps }> };
        const result = data.results?.[0];
        if (result) {
          L.popup({ maxWidth: 340 })
            .setLatLng(event.latlng)
            .setContent(buildVegetacionalPopup(result.attributes, result.layerName))
            .openOn(map);
        }
      } catch {}
    };

    void refresh();
    map.on('moveend', refresh);
    map.on('click', identify);
    return () => {
      exportController?.abort();
      identifyController?.abort();
      map.off('moveend', refresh);
      map.off('click', identify);
      clearRaster();
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (vegetacionalRef.current === overlay) vegetacionalRef.current = null;
    };
  }, [showVegetacional, reorderOverlays, mapRef, ndviModeRef, opacityRef, vegetacionalRef]);
}
