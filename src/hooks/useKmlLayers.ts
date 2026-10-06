'use client';

import { useRef, useState } from 'react';
import { kmlColorFor, parseKmlFile, type KmlLayer } from '@/lib/kml';
import { track } from '@/lib/analytics';

/**
 * Capas KML subidas por el usuario: parseo 100% en el navegador (lib/kml),
 * el archivo nunca sale del dispositivo. El contador de colores es un ref
 * para que borrar una capa no re-pinte las que quedan.
 */
export function useKmlLayers() {
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const kmlColorCount = useRef(0);

  const addKmlFiles = async (files: FileList) => {
    setKmlError(null);
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const layer = await parseKmlFile(file, kmlColorFor(kmlColorCount.current++));
        setKmlLayers((prev) => [...prev, layer]);
        track('kml_upload', { features: layer.featureCount });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `No se pudo leer «${file.name}».`);
      }
    }
    if (errors.length) setKmlError(errors.join(' '));
  };

  const toggleKml = (id: string) =>
    setKmlLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );

  const removeKml = (id: string) => setKmlLayers((prev) => prev.filter((l) => l.id !== id));

  /** Renombra el alias del perito para una capa KML. Acepta string vacío
   *  (el cajetín cae al `name` del archivo cuando `displayName` está vacío).
   *  No toca `geojson` ni el color — solo la etiqueta humana. */
  const renameKml = (id: string, displayName: string) =>
    setKmlLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, displayName } : l)),
    );

  return { kmlLayers, kmlError, addKmlFiles, toggleKml, removeKml, renameKml };
}
