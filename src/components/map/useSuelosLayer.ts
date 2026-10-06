'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  SUELOS_ATTRIBUTION,
  SUELOS_EXPORT_URL,
  SUELOS_IDENTIFY_URL,
  SUELOS_MIN_ZOOM,
  SUELOS_SERVICE_NAME,
  suelosClassColor,
  TRANSPARENT_PIXEL,
  type SuelosStatus,
} from '@/lib/suelos';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { esc } from '@/lib/map-popups';
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
 * respuestas fuera de orden. Al hacer
 * clic se consulta la clase vía identify; ambas operaciones pasan por el
 * proxy same-origin del SIG, que valida CIREN y devuelve errores seguros con
 * el identificador exacto del servicio. Si el clic abrió el popup de otra
 * capa (comuna, camino, pin), se aborta para no pisarlo.
 */
export function useSuelosLayer({
  mapRef,
  suelosRef,
  showSuelos,
  opacityRef,
  onSuelosStatusRef,
  ndviModeRef,
}: {
  mapRef: RefObject<L.Map | null>;
  suelosRef: RefObject<L.ImageOverlay | null>;
  showSuelos: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onSuelosStatusRef: RefObject<((status: SuelosStatus) => void) | undefined>;
  ndviModeRef: RefObject<boolean>;
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
      // Un feature vectorial puede abrir su popup durante el mismo evento. No
      // disparamos identify en ese caso ni reemplazamos popups abiertos después.
      if (popupOpenedThisTurn) return;
      // Herramienta NDVI armada: el clic no es una consulta de suelo.
      if (ndviModeRef.current) return;
      const expectedPopupGeneration = popupGeneration;
      // Bajo el zoom mínimo la capa no está visible: no consultar identify.
      if (map.getZoom() < SUELOS_MIN_ZOOM) return;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const { lat, lng } = e.latlng;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        tolerance: '2',
        mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        imageDisplay: `${size.x},${size.y},96`,
      });
      try {
        const response = await fetch(`${SUELOS_IDENTIFY_URL}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'identify');
          if (
            id !== identifySequence || controller.signal.aborted ||
            popupGeneration !== expectedPopupGeneration ||
            !mapRef.current || !suelosRef.current
          ) return;
          L.popup({ maxWidth: 300 })
            .setLatLng(e.latlng)
            .setContent(
              `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(failure.service)} ` +
              `(operación ${esc(failure.operation)}). Intenta nuevamente en unos segundos.</div>` +
              `</div>`,
            )
            .openOn(mapRef.current);
          return;
        }
        const data = (await response.json()) as {
          results?: { layerName?: string; soilClass?: string | null }[];
        };
        if (
          id !== identifySequence || controller.signal.aborted ||
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        const result = data.results?.find((item) => item.soilClass) ?? data.results?.[0];
        const clase = result?.soilClass ?? null;
        const region = result?.layerName ?? '';
        const body = clase
          ? `<div style="font-weight:600;font-size:0.92rem">Capacidad de uso: Clase ${esc(clase)}</div>` +
            `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
            `font-size:0.68rem;font-weight:600;color:#1e293b;background:${suelosClassColor(clase)};` +
            `border:1px solid rgba(0,0,0,.15)">Suelos agrológicos CIREN</div>` +
            (region ? `<div style="opacity:.7">${esc(region)}</div>` : '')
          : `<div style="font-weight:600;font-size:0.92rem">Sin clase CIREN registrada en este punto</div>` +
            `<div style="opacity:.7;margin-top:.2rem">El servicio respondió correctamente, pero el punto puede estar fuera del área estudiada o no tener clasificación disponible.</div>`;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">${body}` +
              `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${SUELOS_ATTRIBUTION}</div></div>`,
          )
          .openOn(mapRef.current);
      } catch (error) {
        if (controller.signal.aborted || id !== identifySequence) return;
        console.error('No se pudo consultar la clase de suelo CIREN.', error);
        if (
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(SUELOS_SERVICE_NAME)} ` +
              `(operación identify). Intenta nuevamente en unos segundos.</div></div>`,
          )
          .openOn(mapRef.current);
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
      // El mapa VIGENTE: al desmontar, MapView ya lo destruyó y dejó la ref en null.
      if (suelosRef.current && mapRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        mapRef.current.removeLayer(suelosRef.current);
        suelosRef.current = null;
      }
    };
  }, [showSuelos, mapRef, ndviModeRef, onSuelosStatusRef, opacityRef, suelosRef]);
}
