'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import {
  PROPIEDADES_RURALES_ATTRIBUTION,
  PROPIEDADES_RURALES_COLOR,
  PROPIEDADES_RURALES_DISCLAIMER,
  PROPIEDADES_RURALES_EXPORT_URL,
  PROPIEDADES_RURALES_IDENTIFY_URL,
  PROPIEDADES_RURALES_MIN_ZOOM,
  PROPIEDADES_RURALES_SERVICE_NAME,
  type PropiedadesRuralesStatus,
} from '@/lib/propiedades-rurales';
import type { LayerOpacity } from '@/lib/layer-opacity';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';
import { esc } from '@/lib/map-popups';
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
  ndviModeRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  propiedadesRuralesRef: RefObject<L.ImageOverlay | null>;
  showPropiedadesRurales: boolean;
  opacityRef: RefObject<LayerOpacity>;
  onPropiedadesRuralesStatusRef: RefObject<((status: PropiedadesRuralesStatus) => void) | undefined>;
  ndviModeRef: RefObject<boolean>;
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
    let identifySequence = 0;
    let identifyController: AbortController | null = null;
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
    let popupGeneration = 0;
    const onPopupOpen = () => { popupGeneration++; };
    const onClick = async (e: L.LeafletMouseEvent) => {
      if (ndviModeRef.current) return;
      if (map.getZoom() < PROPIEDADES_RURALES_MIN_ZOOM) return;
      const expectedPopupGeneration = popupGeneration;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController(); identifyController = controller;
      const bounds = map.getBounds(); const size = map.getSize();
      const params = new URLSearchParams({ geometry: `${e.latlng.lng},${e.latlng.lat}`, mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`, imageDisplay: `${size.x},${size.y},96`, tolerance: '2' });
      try {
        const response = await fetch(`${PROPIEDADES_RURALES_IDENTIFY_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { results?: Array<{ layerName?: string | null; attributes?: { rol?: string | null; comuna?: string | null; codRegion?: string | null; quality?: string } }> };
        if (id !== identifySequence || controller.signal.aborted || popupGeneration !== expectedPopupGeneration || !mapRef.current || !data.results?.length) return;
        const item = data.results[0]; const p = item.attributes ?? {};
        const rows = [['ROL SII del predio', p.rol], ['Comuna', p.comuna], ['Código de región', p.codRegion]].filter((row): row is [string, string] => Boolean(row[1]));
        const table = rows.map(([k, v]) => `<tr><td style="opacity:.55;padding:1px 8px 1px 0">${k}</td><td>${esc(v)}</td></tr>`).join('');
        L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent(`<div style="font-size:.8rem;line-height:1.45;min-width:230px"><div style="font-weight:600;font-size:.92rem;color:${PROPIEDADES_RURALES_COLOR}">Propiedad rural CIREN</div><table style="border-collapse:collapse;margin-top:.3rem">${table}</table>${p.quality === 'rol-invalid' ? '<div style="margin-top:.3rem;color:#b91c1c">ROL no válido en la fuente.</div>' : ''}<div style="margin-top:.4rem;font-size:.62rem;opacity:.55">${PROPIEDADES_RURALES_DISCLAIMER}<br/>${PROPIEDADES_RURALES_ATTRIBUTION}</div></div>`).openOn(mapRef.current);
      } catch (error) { if (!controller.signal.aborted) console.error('No se pudo consultar la propiedad rural CIREN.', error); }
    };
    map.on('popupopen', onPopupOpen); map.on('click', onClick);
    return () => {
      exportSequence++; identifySequence++; exportController?.abort(); identifyController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd); map.off('popupopen', onPopupOpen); map.off('click', onClick);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (propiedadesRuralesRef.current === overlay) propiedadesRuralesRef.current = null;
    };
  }, [
    showPropiedadesRurales,
    reorderOverlays,
    mapRef,
    ndviModeRef,
    onPropiedadesRuralesStatusRef,
    opacityRef,
    propiedadesRuralesRef,
  ]);
}
