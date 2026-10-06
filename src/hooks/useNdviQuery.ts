'use client';

import { useCallback, useEffect, useState } from 'react';
import { ndviTitulo, type NdviConsulta, type NdviSerie } from '@/lib/ndvi';
import type { NdviExport } from '@/lib/map-export';
import { track } from '@/lib/analytics';

/**
 * Herramienta NDVI: consulta puntual sobre Sentinel-2 (no es una capa del
 * catálogo, no se enciende ni se apaga — se consulta). `ndviMode` arma el
 * modo cruceta del mapa; `ndviConsulta` es el punto vigente y `ndviExport`
 * la serie + título que alimenta el cajetín del PNG exportado.
 *
 * `onPoint` deja al padre cerrar sus paneles cuando se abre una consulta.
 */
export function useNdviQuery({ onPoint }: { onPoint: () => void }) {
  const [ndviMode, setNdviMode] = useState(false);
  const [ndviConsulta, setNdviConsulta] = useState<NdviConsulta | null>(null);
  const [ndviExport, setNdviExport] = useState<NdviExport | null>(null);

  // El clic con el modo armado llega desde MapView: desarma y abre el panel
  // en la misma transición, cerrando antes los paneles flotantes para que dos
  // superficies no queden apiladas sobre el mismo punto.
  const handleNdviPoint = useCallback((lat: number, lng: number) => {
    track('ndvi_query');
    setNdviMode(false);
    setNdviConsulta({ tipo: 'punto', lat, lng });
    onPoint();
  }, [onPoint]);

  // serie y título se fijan juntos: el cajetín del PNG nunca puede citar una
  // consulta vieja con una serie nueva.
  const handleNdviSerie = useCallback((serie: NdviSerie | null) => {
    setNdviExport(serie && ndviConsulta ? { serie, titulo: ndviTitulo(ndviConsulta), resaltado: null } : null);
  }, [ndviConsulta]);

  const handleNdviResaltado = useCallback((anio: number) => {
    setNdviExport((prev) => (prev ? { ...prev, resaltado: anio } : prev));
  }, []);

  const cerrarNdvi = useCallback(() => {
    setNdviConsulta(null);
    setNdviExport(null);
    setNdviMode(false);
  }, []);

  // Escape: primero desarma la consulta pendiente; si no hay modo armado,
  // cierra el panel. Sin leaflet de por medio, así vive en la página.
  useEffect(() => {
    if (!ndviMode && !ndviConsulta) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (ndviMode) setNdviMode(false);
      else if (ndviConsulta) cerrarNdvi();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ndviMode, ndviConsulta, cerrarNdvi]);

  return {
    ndviMode,
    setNdviMode,
    ndviConsulta,
    ndviExport,
    handleNdviPoint,
    handleNdviSerie,
    handleNdviResaltado,
    cerrarNdvi,
  };
}
