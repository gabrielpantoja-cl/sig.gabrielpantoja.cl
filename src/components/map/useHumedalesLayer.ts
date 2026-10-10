'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  HUMEDALES_EXPORT_URL,
  HUMEDALES_IDENTIFY_URL,
  HUMEDALES_MIN_ZOOM,
  HUMEDALES_SERVICE_NAME,
  type HumedalIdentifyResult,
  type HumedalesStatus,
} from '@/lib/humedales';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { buildHumedalesPopup, buildRemoteFailurePopup } from '@/lib/map-popups';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { humedalesFailureDetails, waitForImage } from '@/components/map/raster-overlay';

/**
 * Humedales (MMA) — capa dinámica remota, mismo ciclo que suelos CIREN: UN
 * PNG por viewport contra `/api/humedales/export` sobre un L.ImageOverlay
 * refrescado en `moveend`, y `identify` al hacer clic. La imagen anterior se
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
  ndviModeRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  humedalesRef: RefObject<L.ImageOverlay | null>;
  showHumedales: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onHumedalesStatusRef: RefObject<((status: HumedalesStatus) => void) | undefined>;
  ndviModeRef: RefObject<boolean>;
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
    let identifySequence = 0;
    let identifyController: AbortController | null = null;
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

    // Si el clic abrió el popup de un feature vectorial (comuna, camino, pin
    // CBR), no se dispara identify ni se pisa ese popup.
    let popupGeneration = 0;
    let popupOpenedThisTurn = false;
    const onPopupOpen = () => {
      popupGeneration++;
      popupOpenedThisTurn = true;
      queueMicrotask(() => {
        popupOpenedThisTurn = false;
      });
    };

    const onClick = async (e: L.LeafletMouseEvent) => {
      if (popupOpenedThisTurn || ndviModeRef.current) return;
      if (map.getZoom() < HUMEDALES_MIN_ZOOM) return;
      const expectedPopupGeneration = popupGeneration;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: [e.latlng.lng, e.latlng.lat].join(','),
        mapExtent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        imageDisplay: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y)), 96].join(','),
        tolerance: '2',
      });
      const stale = () =>
        id !== identifySequence || controller.signal.aborted ||
        popupGeneration !== expectedPopupGeneration ||
        !mapRef.current || humedalesRef.current !== overlay;
      try {
        const response = await fetch(`${HUMEDALES_IDENTIFY_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) {
          const failure = await humedalesFailureDetails(response, 'identify');
          if (stale()) return;
          L.popup({ maxWidth: 300 })
            .setLatLng(e.latlng)
            .setContent(buildRemoteFailurePopup('No se pudo consultar el humedal', failure.service, failure.operation))
            .openOn(map);
          return;
        }
        const data = (await response.json()) as { results?: HumedalIdentifyResult[] };
        if (stale()) return;
        // Sin humedal en el punto no se abre nada: con la capa encendida, cada
        // clic en tierra firme abriría un popup vacío y taparía el mapa.
        if (!data.results?.length) return;
        L.popup({ maxWidth: 340 })
          .setLatLng(e.latlng)
          .setContent(buildHumedalesPopup(data.results))
          .openOn(map);
      } catch (error) {
        if (controller.signal.aborted || id !== identifySequence) return;
        console.error('No se pudo consultar el humedal del MMA.', error);
        if (stale()) return;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(buildRemoteFailurePopup('No se pudo consultar el humedal', HUMEDALES_SERVICE_NAME, 'identify'))
          .openOn(map);
      }
    };

    map.on('popupopen', onPopupOpen);
    map.on('click', onClick);

    return () => {
      exportSequence++;
      identifySequence++;
      exportController?.abort();
      identifyController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
      map.off('popupopen', onPopupOpen);
      map.off('click', onClick);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (humedalesRef.current === overlay) humedalesRef.current = null;
    };
  }, [showHumedales, mapRef, ndviModeRef, onHumedalesStatusRef, opacityRef, humedalesRef, reorderOverlays]);
}
