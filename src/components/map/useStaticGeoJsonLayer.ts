'use client';

import { useEffect, useRef, type RefObject } from 'react';
import L from 'leaflet';
import type { FeatureCollection, Geometry } from 'geojson';

/**
 * Capa temática servida como GeoJSON estático desde `public/data/` (generada
 * por un ETL `npm run data:build:*`). Mientras `show` es true descarga el
 * archivo, monta un `L.geoJSON` y lo publica en `layerRef` para que el resto
 * de MapView (apilado, opacidad, export PNG) lo encuentre.
 *
 * El montaje es a prueba de carreras: si la capa se apaga (o se desmonta el
 * mapa) antes de que llegue el `fetch`, la petición se aborta y nada se agrega
 * al mapa. Seis de las siete copias de este efecto que vivían en MapView no
 * lo hacían (solo líneas de transmisión), así que apagar una capa mientras
 * cargaba la dejaba montada y huérfana: ningún control podía quitarla.
 *
 * `options` se lee al momento de construir la capa (no es dependencia del
 * efecto): una función nueva en cada render no vuelve a descargar el
 * catastro frutícola (30 MB).
 */
export function useStaticGeoJsonLayer<P>({
  mapRef,
  layerRef,
  show,
  url,
  options,
  onAdd,
}: {
  mapRef: RefObject<L.Map | null>;
  layerRef: RefObject<L.GeoJSON | null>;
  show: boolean;
  url: string;
  options: () => L.GeoJSONOptions<P, Geometry>;
  /** Se llama tras montar la capa; MapView re-impone ahí el orden de apilado. */
  onAdd: () => void;
}): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!show || !mapRef.current) return;

    const controller = new AbortController();
    let layer: L.GeoJSON | null = null;
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${url}: ${response.status}`))))
      .then((geojson: FeatureCollection<Geometry, P>) => {
        const map = mapRef.current;
        if (controller.signal.aborted || !map) return;
        layer = L.geoJSON<P>(geojson, optionsRef.current()).addTo(map);
        layerRef.current = layer;
        onAdd();
      })
      .catch(() => {});

    return () => {
      controller.abort();
      // A propósito el mapa VIGENTE y no uno capturado: al desmontar, el
      // efecto de init de MapView (declarado antes, limpia antes) ya destruyó
      // el mapa y dejó la ref en null; `removeLayer` sobre un mapa destruido
      // revienta en el renderer de canvas.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (layer && mapRef.current?.hasLayer(layer)) mapRef.current.removeLayer(layer);
      if (layerRef.current === layer) layerRef.current = null;
    };
  }, [show, url, mapRef, layerRef, onAdd]);
}
