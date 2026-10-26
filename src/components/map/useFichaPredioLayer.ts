'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import { destinoLabel } from '@/lib/hexbins';
import { formatoDistancia } from '@/lib/medicion';
import type { FichaPredio, PoligonoGeoJson } from '@/lib/analisis-predio';

const COLOR_PREDIO = 'hsl(153, 40%, 32%)';
const COLOR_COMPARABLE = '#7c3aed';

/**
 * Lo que la ficha del predio dibuja en el mapa: el polígono analizado y sus
 * comparables CBR más cercanos. Todo va en el canvas vectorial
 * (`preferCanvas`), así entra solo al PNG exportado, y nada es interactivo
 * salvo el tooltip de cada comparable: los clics siguen llegando a la consulta
 * integrada del mapa.
 */
export function useFichaPredioLayer({
  mapRef,
  geometry,
  ficha,
}: {
  mapRef: RefObject<L.Map | null>;
  geometry: PoligonoGeoJson | null;
  ficha: FichaPredio | null;
}): void {
  // Polígono: se dibuja y se encuadra apenas el usuario pide el análisis.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry) return;
    const capa = L.geoJSON(geometry, {
      interactive: false,
      style: { color: COLOR_PREDIO, weight: 3, fillColor: COLOR_PREDIO, fillOpacity: 0.12 },
    }).addTo(map);
    const bounds = capa.getBounds();
    if (bounds.isValid() && !map.getBounds().contains(bounds)) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    return () => {
      capa.remove();
    };
  }, [mapRef, geometry]);

  // Comparables: llegan cuando responde el servidor (y cambian con el radio).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ficha || ficha.comparables.estado !== 'ok') return;
    const grupo = L.layerGroup().addTo(map);
    for (const p of ficha.comparables.datos.puntos) {
      const texto =
        `${p.destino ? destinoLabel(p.destino) : 'Sin destino'} · ${p.anio ?? 's/año'} · ` +
        (p.distanciaM > 0 ? `a ${formatoDistancia(p.distanciaM)}` : 'dentro del predio');
      L.circleMarker([p.lat, p.lng], {
        radius: 5,
        color: '#fff',
        weight: 1.5,
        fillColor: COLOR_COMPARABLE,
        fillOpacity: 0.9,
      })
        .bindTooltip(texto, { direction: 'top', offset: [0, -4] })
        .addTo(grupo);
    }
    return () => {
      grupo.remove();
    };
  }, [mapRef, ficha]);
}
