'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import { retryAfterSeconds } from '@/lib/remote-raster';
import { redondearCoordenada } from '@/lib/ndvi';
import { NDVI_VISUAL_EXPORT_URL, NDVI_VISUAL_MIN_ZOOM, type NdviVisualEstado } from '@/lib/ndvi-visual';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { waitForImage } from '@/components/map/raster-overlay';

/**
 * NDVI Visual (Sentinel-2) — capa dinámica remota por viewport, misma familia
 * que suelos/vegetacional: UN PNG compuesto en el servidor (`/api/ndvi/export`
 * pinta las escenas COG de cada cuadrícula MGRS con la rampa de `ndvi-ramp.json`)
 * colgado en un L.ImageOverlay y refrescado en moveend. Dos diferencias con
 * sus vecinas, ambas por el costo de componer (~5 s por viewport):
 *   1. debounce de 250 ms — un paneo genera muchos moveend y cada uno obliga
 *      a releer pirámides de Sentinel-2;
 *   2. cuantización de parámetros (bbox a 4 decimales, tamaño múltiplo de 64)
 *      para que el CDN de Vercel reutilice claves entre micro-paneos y entre
 *      recargas de la misma vista; las bounds del overlay usan la MISMA caja
 *      cuantizada, así la imagen queda georreferenciada exactamente donde se
 *      pidió (desfase máximo ~11 m, invisible a esta escala).
 * La máquina de estados (loading/ready+fecha/error/zoom-required) viaja por
 * `onNdviVisualStatus` para que la leyenda no presente una falla del servicio
 * como "sin datos" — la doctrina de la leyenda de suelos.
 */
export function useNdviVisualLayer({
  mapRef,
  ndviVisualRef,
  showNdviVisual,
  opacityRef,
  onNdviVisualStatusRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  ndviVisualRef: RefObject<L.ImageOverlay | null>;
  showNdviVisual: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onNdviVisualStatusRef: RefObject<((status: NdviVisualEstado) => void) | undefined>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (ndviVisualRef.current) {
      map.removeLayer(ndviVisualRef.current);
      ndviVisualRef.current = null;
    }
    if (!showNdviVisual) {
      onNdviVisualStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.ndviVisual,
      interactive: false,
      attribution: 'Copernicus Sentinel-2 vía Element 84 / AWS Open Data',
    }).addTo(map);
    ndviVisualRef.current = overlay;

    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let activeBlobUrl: string | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      const id = ++exportSequence;
      exportController?.abort();
      exportController = null;
      const bounds = map.getBounds();
      // Zoom bajo el mínimo: el servidor rechazaría la caja por span — aquí no
      // se emite peticiones y la leyenda lo dice explícitamente.
      if (map.getZoom() < NDVI_VISUAL_MIN_ZOOM) {
        clearRaster(bounds);
        onNdviVisualStatusRef.current?.({ kind: 'zoom-required', minZoom: NDVI_VISUAL_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onNdviVisualStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const oeste = redondearCoordenada(bounds.getWest());
      const sur = redondearCoordenada(bounds.getSouth());
      const este = redondearCoordenada(bounds.getEast());
      const norte = redondearCoordenada(bounds.getNorth());
      const ancho = Math.min(1600, Math.max(64, Math.ceil(map.getSize().x / 64) * 64));
      const alto = Math.min(1600, Math.max(64, Math.ceil(map.getSize().y / 64) * 64));
      const cajaCuantizada = L.latLngBounds([sur, oeste], [norte, este]);
      const params = new URLSearchParams({
        bbox: `${oeste},${sur},${este},${norte}`,
        size: `${ancho},${alto}`,
      });
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(`${NDVI_VISUAL_EXPORT_URL}?${params}`, {
          signal: controller.signal,
        });
        if (id !== exportSequence || controller.signal.aborted) return;
        if (response.status === 204) {
          // Ninguna escena útil en la caja (borde costero, sin cobertura): la
          // capa queda transparente y el mapa base se ve solo. No es falla.
          clearRaster(cajaCuantizada);
          onNdviVisualStatusRef.current?.({ kind: 'ready', fecha: null });
          return;
        }
        if (response.status === 429) {
          const retryIn = retryAfterSeconds(response);
          onNdviVisualStatusRef.current?.({ kind: 'rate-limited', retryIn });
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => void refresh(), retryIn * 1000);
          return;
        }
        if (!response.ok) {
          clearRaster(cajaCuantizada);
          onNdviVisualStatusRef.current?.({ kind: 'error' });
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Respuesta NDVI Visual no es PNG');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || !ndviVisualRef.current) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        overlay.setBounds(cajaCuantizada);
        overlay.setUrl(activeBlobUrl);
        reorderOverlays();
        onNdviVisualStatusRef.current?.({
          kind: 'ready',
          fecha: response.headers.get('X-Ndvi-Fecha'),
        });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('NDVI Visual: no se pudo componer el raster del viewport.', error);
        clearRaster(cajaCuantizada);
        onNdviVisualStatusRef.current?.({ kind: 'error' });
      }
    };

    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 250);
    };

    void refresh();
    map.on('moveend', scheduleRefresh);
    return () => {
      if (debounce) clearTimeout(debounce);
      exportController?.abort();
      // Invalida respuestas en vuelo que ya no tienen dónde pintarse.
      exportSequence++;
      map.off('moveend', scheduleRefresh);
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (ndviVisualRef.current === overlay) ndviVisualRef.current = null;
      // El callback VIGENTE del padre, no el de cuando se montó la capa.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      onNdviVisualStatusRef.current?.({ kind: 'idle' });
    };
  }, [showNdviVisual, reorderOverlays, mapRef, ndviVisualRef, onNdviVisualStatusRef, opacityRef]);
}
