'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  SUELOS_EXPORT_URL,
  SUELOS_MIN_ZOOM,
  SUELOS_SERVICE_NAME,
  TRANSPARENT_PIXEL,
  type SuelosStatus,
} from '@/lib/suelos';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { suelosFailureDetails, waitForImage } from '@/components/map/raster-overlay';

/**
 * Suelos agrológicos (CIREN) — capa dinámica remota: el dataset completo
 * supera los 500 MB, así que el servidor de CIREN renderiza la imagen con
 * su simbología oficial y aquí solo se descarga UN PNG por viewport
 * (export del MapServer sobre un L.ImageOverlay refrescado en moveend; el
 * WMS teselado tumbaba el servidor con ~40 GetMap simultáneos). Al pedir
 * un viewport nuevo la imagen anterior se BORRA (no se mantiene hasta que
 * llegue la nueva): si CIREN cae, la leyenda dice «error» y no debe quedar
 * en pantalla un raster viejo que parezca vigente. La nueva se pre-carga
 * completa antes de mostrarse, y un contador de secuencia descarta
 * respuestas fuera de orden. El export pasa por el proxy same-origin del
 * SIG, que valida CIREN y devuelve errores seguros con el identificador
 * exacto del servicio. La clase de un punto la consulta la consulta
 * integrada (`usePointQuery`) junto con las demás capas activas.
 */
export function useSuelosLayer({
  mapRef,
  suelosRef,
  showSuelos,
  opacityRef,
  onSuelosStatusRef,
}: {
  mapRef: RefObject<L.Map | null>;
  suelosRef: RefObject<L.ImageOverlay | null>;
  showSuelos: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onSuelosStatusRef: RefObject<((status: SuelosStatus) => void) | undefined>;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (suelosRef.current) {
      map.removeLayer(suelosRef.current);
      suelosRef.current = null;
    }

    if (!showSuelos) {
      onSuelosStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.suelos,
      attribution: 'CIREN · Estudios Agrológicos',
      interactive: false,
    }).addTo(map);
    suelosRef.current = overlay;

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
      // A escala nacional el export obliga al servidor a rasterizar las 12
      // regiones completas: tarda minutos y degrada el servicio para todas
      // las consultas siguientes. Bajo el zoom mínimo no se pide nada.
      if (map.getZoom() < SUELOS_MIN_ZOOM) {
        clearRaster(bounds);
        onSuelosStatusRef.current?.({ kind: 'zoom-required', minZoom: SUELOS_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onSuelosStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        size: `${size.x},${size.y}`,
      });
      const url = `${SUELOS_EXPORT_URL}?${params}`;
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'export');
          if (id === exportSequence && !controller.signal.aborted) {
            onSuelosStatusRef.current?.({ kind: 'error', ...failure });
          }
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid soils response');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || !suelosRef.current) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        suelosRef.current.setUrl(candidateBlobUrl);
        suelosRef.current.setBounds(bounds);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        onSuelosStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la cobertura de suelos CIREN.', error);
        onSuelosStatusRef.current?.({
          kind: 'error',
          service: SUELOS_SERVICE_NAME,
          operation: 'export',
        });
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
      // El mapa VIGENTE: al desmontar, MapView ya lo destruyó y dejó la ref en null.
      if (suelosRef.current && mapRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        mapRef.current.removeLayer(suelosRef.current);
        suelosRef.current = null;
      }
    };
  }, [showSuelos, mapRef, onSuelosStatusRef, opacityRef, suelosRef]);
}
