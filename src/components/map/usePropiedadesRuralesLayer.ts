'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  PROPIEDADES_RURALES_ATTRIBUTION,
  PROPIEDADES_RURALES_EXPORT_URL,
  PROPIEDADES_RURALES_MIN_ZOOM,
  PROPIEDADES_RURALES_SERVICE_NAME,
  type PropiedadesRuralesStatus,
} from '@/lib/propiedades-rurales';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { ruralFailureDetails, waitForImage } from '@/components/map/raster-overlay';

/**
 * Propiedades rurales CIREN: raster por viewport e identify acotado. El
 * servicio contiene polígonos prediales grandes, por lo que no se descarga
 * como GeoJSON ni se usa WMS teselado en el navegador.
 */
export function usePropiedadesRuralesLayer({
  mapRef,
  propiedadesRuralesRef,
  showPropiedadesRurales,
  opacityRef,
  onPropiedadesRuralesStatusRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  propiedadesRuralesRef: RefObject<L.ImageOverlay | null>;
  showPropiedadesRurales: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onPropiedadesRuralesStatusRef: RefObject<((status: PropiedadesRuralesStatus) => void) | undefined>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (propiedadesRuralesRef.current) map.removeLayer(propiedadesRuralesRef.current);
    propiedadesRuralesRef.current = null;
    if (!showPropiedadesRurales) {
      onPropiedadesRuralesStatusRef.current?.({ kind: 'idle' });
      return;
    }
    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.propiedadesRurales,
      attribution: PROPIEDADES_RURALES_ATTRIBUTION,
      interactive: false,
    }).addTo(map);
    propiedadesRuralesRef.current = overlay;
    reorderOverlays();
    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let activeBlobUrl: string | null = null;
    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
    };
    const refresh = async () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++exportSequence;
      exportController?.abort();
      if (map.getZoom() < PROPIEDADES_RURALES_MIN_ZOOM) {
        clearRaster(bounds);
        onPropiedadesRuralesStatusRef.current?.({ kind: 'zoom-required', minZoom: PROPIEDADES_RURALES_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onPropiedadesRuralesStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      let candidate: string | null = null;
      try {
        const params = new URLSearchParams({ bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`, size: `${size.x},${size.y}` });
        const response = await fetch(`${PROPIEDADES_RURALES_EXPORT_URL}?${params}`, { signal: controller.signal });
        if (response.status === 204) { onPropiedadesRuralesStatusRef.current?.({ kind: 'ready' }); return; }
        if (!response.ok) { const failure = await ruralFailureDetails(response, 'export'); if (id === exportSequence && !controller.signal.aborted) onPropiedadesRuralesStatusRef.current?.({ kind: 'error', ...failure }); return; }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid rural property image');
        candidate = URL.createObjectURL(blob);
        await waitForImage(candidate);
        if (id !== exportSequence || controller.signal.aborted || !propiedadesRuralesRef.current) { URL.revokeObjectURL(candidate); candidate = null; return; }
        overlay.setUrl(candidate); overlay.setBounds(bounds); activeBlobUrl = candidate; candidate = null;
        onPropiedadesRuralesStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidate) URL.revokeObjectURL(candidate);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la capa de propiedades rurales CIREN.', error);
        onPropiedadesRuralesStatusRef.current?.({ kind: 'error', service: PROPIEDADES_RURALES_SERVICE_NAME, operation: 'export' });
      }
    };
    const onMoveEnd = () => void refresh();
    map.on('moveend', onMoveEnd);
    void refresh();
    return () => {
      exportSequence++; exportController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (propiedadesRuralesRef.current === overlay) propiedadesRuralesRef.current = null;
    };
  }, [
    showPropiedadesRurales,
    reorderOverlays,
    mapRef,
    onPropiedadesRuralesStatusRef,
    opacityRef,
    propiedadesRuralesRef,
  ]);
}
