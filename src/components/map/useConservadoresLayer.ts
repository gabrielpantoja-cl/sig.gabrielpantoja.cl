'use client';

import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Conservador } from '@/lib/types';
import type { ComunaProps } from '@/lib/comunas';
import { buildConservadorPopup, esc } from '@/lib/map-popups';
import { loadGeoJsonCached } from '@/components/map/geojson-cache';
import {
  COMUNAS_GEOJSON_URL,
  CONSERVADORES_URL,
  JURISDICCION_STYLE,
  conservadorIconSvg,
  highlightOnClose,
  highlightOnOpen,
  indexComunasByCut,
  jurisdiccionFeatures,
  type ComunasIndex,
  type ConservadoresStatus,
} from '@/lib/conservadores';

const conservadorIcon = L.divIcon({
  className: 'cbr-oficina',
  html: conservadorIconSvg(),
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -12],
});

// Un índice por FeatureCollection: la caché de geojson-cache devuelve siempre
// el mismo objeto, así que el índice se arma una sola vez por sesión.
const indexes = new WeakMap<object, ComunasIndex>();
async function comunasIndex(): Promise<ComunasIndex> {
  const geojson = await loadGeoJsonCached<ComunaProps>(COMUNAS_GEOJSON_URL);
  let index = indexes.get(geojson);
  if (!index) {
    index = indexComunasByCut(geojson as FeatureCollection<Geometry, ComunaProps>);
    indexes.set(geojson, index);
  }
  return index;
}

/**
 * Conservadores de Bienes Raíces: un marcador por oficina (sin clustering, son
 * ~100) y, mientras su popup está abierto, la jurisdicción resaltada como la
 * unión de los polígonos DPA de las comunas que atiende.
 *
 * El resaltado lo gobiernan los eventos del popup de cada marcador: abrirlo
 * resalta, cerrarlo (×, clic en el mapa vacío, otro popup) limpia. Así hay un
 * solo CBR resaltado a la vez sin estado paralelo que se pueda desincronizar.
 * El polígono no es interactivo: un clic dentro de la jurisdicción sigue
 * llegando a la consulta integrada del punto.
 *
 * Los límites comunales se piden por la caché compartida al encender la capa
 * (no en el primer clic, para que el resaltado sea inmediato), y funcionan
 * aunque la capa «Límites comunales» esté apagada.
 */
export function useConservadoresLayer({
  mapRef,
  show,
  highlightRef,
  onStatusRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  show: boolean;
  /** Publicado para que `reorderOverlays` lo deje sobre las capas de contexto. */
  highlightRef: RefObject<L.GeoJSON | null>;
  onStatusRef: RefObject<((status: ConservadoresStatus) => void) | undefined>;
  reorderOverlays: () => void;
}): void {
  const highlightedIdRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!show || !map) return;

    const controller = new AbortController();
    const group = L.layerGroup();
    let disposed = false;
    onStatusRef.current?.({ kind: 'loading' });
    // Precarga: el primer clic ya encuentra el índice armado.
    comunasIndex().catch(() => {});

    const clearHighlight = () => {
      const layer = highlightRef.current;
      if (layer && mapRef.current?.hasLayer(layer)) mapRef.current.removeLayer(layer);
      highlightRef.current = null;
    };

    const drawHighlight = async (c: Conservador) => {
      clearHighlight();
      if (c.jurisdiccion_cut.length === 0) return;
      let index: ComunasIndex;
      try {
        index = await comunasIndex();
      } catch {
        return; // Sin límites comunales: el popup basta.
      }
      const current = mapRef.current;
      if (disposed || !current || highlightedIdRef.current !== c.id) return;
      const { features } = jurisdiccionFeatures(index, c.jurisdiccion_cut);
      if (features.length === 0) return;
      clearHighlight();
      const layer = L.geoJSON({ type: 'FeatureCollection', features } as FeatureCollection, {
        style: JURISDICCION_STYLE,
        interactive: false,
      }).addTo(current);
      highlightRef.current = layer;
      reorderOverlays();
      // Solo alejar: si la jurisdicción no cabe en la vista se encuadra entera,
      // pero nunca se acerca más que el zoom que eligió el usuario.
      const bounds = layer.getBounds();
      if (bounds.isValid() && !current.getBounds().contains(bounds)) {
        current.flyToBounds(bounds, { padding: [40, 40], maxZoom: current.getZoom(), duration: 0.8 });
      }
    };

    fetch(CONSERVADORES_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
      .then((rows: Conservador[]) => {
        const current = mapRef.current;
        if (controller.signal.aborted || !current) return;
        for (const c of rows) {
          const marker = L.marker([c.lat, c.lng], {
            icon: conservadorIcon,
            title: `CBR ${c.nombre}`,
            alt: `Conservador de Bienes Raíces de ${c.nombre}`,
            // Sobre los pines de transacciones: la oficina es la referencia.
            zIndexOffset: 1000,
            riseOnHover: true,
          });
          // El margen superior deja el popup bajo la barra de búsqueda/filtros.
          marker.bindPopup(buildConservadorPopup(c), { maxWidth: 320, autoPanPaddingTopLeft: [20, 90] });
          marker.bindTooltip(`CBR ${esc(c.nombre)}`, { direction: 'top', offset: [0, -12], opacity: 0.92 });
          marker.on('popupopen', () => {
            marker.closeTooltip();
            highlightedIdRef.current = highlightOnOpen(highlightedIdRef.current, c.id);
            void drawHighlight(c);
          });
          marker.on('popupclose', () => {
            highlightedIdRef.current = highlightOnClose(highlightedIdRef.current, c.id);
            if (highlightedIdRef.current === null) clearHighlight();
          });
          group.addLayer(marker);
        }
        group.addTo(current);
        onStatusRef.current?.({ kind: 'ready', count: rows.length });
      })
      .catch(() => {
        if (!controller.signal.aborted) onStatusRef.current?.({ kind: 'error' });
      });

    return () => {
      disposed = true;
      controller.abort();
      highlightedIdRef.current = null;
      // Mapa VIGENTE, no el capturado (ver useStaticGeoJsonLayer).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const current = mapRef.current;
      if (current?.hasLayer(group)) current.removeLayer(group);
      clearHighlight();
      // El callback VIGENTE a propósito: es un ref de callback, no un nodo DOM.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      onStatusRef.current?.({ kind: 'idle' });
    };
  }, [show, mapRef, highlightRef, onStatusRef, reorderOverlays]);
}
