'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import { fetchBioclimaMeta, type BioclimaVariable } from '@/lib/bioclima';
import type { LayerOpacity } from '@/lib/layer-opacity';

/**
 * Bioclima (WorldClim). Es la capa remota más simple del mapa y a propósito:
 * el raster recortado a Chile son 224×924 px (25-50 KB), así que el ETL lo
 * deja pintado como PNG y aquí solo se cuelga con sus bounds. Sin fetch por
 * viewport, sin refresco en `moveend` y sin servicio de terceros en runtime,
 * al revés que suelos CIREN —cuyo dataset de 500 MB sí obliga a ese patrón—.
 * Los bounds salen del manifiesto y no de una constante repetida: si cambia
 * el recorte del ETL, la imagen se sigue georreferenciando sola.
 */
export function useBioclimaLayer({
  mapRef,
  bioclimaRef,
  showBioclima,
  bioclimaVariable,
  opacityRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  bioclimaRef: RefObject<L.ImageOverlay | null>;
  showBioclima: boolean;
  bioclimaVariable: BioclimaVariable;
  opacityRef: RefObject<LayerOpacity>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showBioclima) {
      if (bioclimaRef.current) {
        map.removeLayer(bioclimaRef.current);
        bioclimaRef.current = null;
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const meta = await fetchBioclimaMeta();
        if (cancelled || !mapRef.current) return;

        const b = meta.boundsWgs84;
        const bounds = L.latLngBounds([b.sur, b.oeste], [b.norte, b.este]);
        const url = meta.variables[bioclimaVariable].archivo;

        if (bioclimaRef.current) {
          bioclimaRef.current.setUrl(url);
          bioclimaRef.current.setBounds(bounds);
        } else {
          bioclimaRef.current = L.imageOverlay(url, bounds, {
            opacity: opacityRef.current.bioclima,
            // No es clicable: el valor bajo el cursor se resuelve por popup del
            // mapa, no por eventos de la imagen, que taparía a las capas de
            // abajo si capturara el puntero.
            interactive: false,
          }).addTo(mapRef.current);
        }
        reorderOverlays();
      } catch (error) {
        console.error('Bioclima: no se pudo montar la capa.', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showBioclima, bioclimaVariable, reorderOverlays, bioclimaRef, mapRef, opacityRef]);
}
