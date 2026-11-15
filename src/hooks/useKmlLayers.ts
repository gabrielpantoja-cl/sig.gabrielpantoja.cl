'use client';

import { useEffect, useRef, useState } from 'react';
import { isHexColor, kmlColorFor, parseKmlFile, randomKmlSeed, type KmlLayer } from '@/lib/kml';
import { deleteStoredKml, loadStoredKml, putStoredKml } from '@/lib/kml-store';
import { track } from '@/lib/analytics';

/** Espera tras el último cambio antes de escribir en IndexedDB: el selector
 *  de color dispara un cambio por cada movimiento del cursor. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * Capas KML subidas por el usuario: parseo 100% en el navegador (lib/kml),
 * el archivo nunca sale del dispositivo. Se guardan en el propio navegador
 * (lib/kml-store) para que sigan ahí al volver. El contador de colores es un
 * ref para que borrar una capa no re-pinte las que quedan.
 */
export function useKmlLayers() {
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const kmlColorCount = useRef(0);
  /** Lo que hay en IndexedDB, por id; se compara por referencia (los
   *  updates son inmutables) para escribir solo las capas que cambiaron. */
  const persisted = useRef<Map<string, KmlLayer>>(new Map());

  // Restaura lo guardado. Las capas subidas mientras tanto se conservan.
  useEffect(() => {
    let cancelled = false;
    loadStoredKml()
      .then((stored) => {
        if (cancelled) return;
        persisted.current = new Map(stored.map((l) => [l.id, l]));
        kmlColorCount.current += stored.length;
        if (stored.length) {
          setKmlLayers((prev) => {
            const ids = new Set(stored.map((l) => l.id));
            return [...stored, ...prev.filter((l) => !ids.has(l.id))];
          });
        }
      })
      .catch(() => {
        // Sin IndexedDB el SIG funciona igual, solo sin recordar las capas.
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Guarda los cambios (con debounce). Antes de restaurar no se escribe nada:
  // borraría lo guardado al verlo «ausente» del estado vacío inicial.
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      const prev = persisted.current;
      const next = new Map(kmlLayers.map((l) => [l.id, l]));
      persisted.current = next;
      for (const layer of kmlLayers) {
        if (prev.get(layer.id) === layer) continue;
        putStoredKml(layer).catch(() =>
          setKmlError(
            `«${layer.name}» se ve en el mapa, pero no se pudo guardar en este navegador (¿espacio lleno o ventana privada?). Se perderá al recargar.`,
          ),
        );
      }
      for (const id of prev.keys()) {
        if (!next.has(id)) deleteStoredKml(id).catch(() => {});
      }
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [kmlLayers, hydrated]);

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

  const patch = (id: string, change: Partial<KmlLayer>) =>
    setKmlLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...change } : l)));

  const toggleKml = (id: string) =>
    setKmlLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );

  const removeKml = (id: string) => setKmlLayers((prev) => prev.filter((l) => l.id !== id));

  /** Renombra el alias del perito para una capa KML. Acepta string vacío
   *  (el cajetín cae al `name` del archivo cuando `displayName` está vacío).
   *  No toca `geojson` ni el color — solo la etiqueta humana. */
  const renameKml = (id: string, displayName: string) => patch(id, { displayName });

  /** Un color elegido por el usuario para toda la capa. */
  const setKmlColor = (id: string, color: string) => {
    if (isHexColor(color)) patch(id, { color, colorMode: 'unico' });
  };

  /** Un color distinto por entidad; cada llamada baraja otra combinación. */
  const shuffleKmlColors = (id: string) =>
    patch(id, { colorMode: 'por-entidad', colorSeed: randomKmlSeed() });

  return {
    kmlLayers,
    kmlError,
    addKmlFiles,
    toggleKml,
    removeKml,
    renameKml,
    setKmlColor,
    shuffleKmlColors,
  };
}
