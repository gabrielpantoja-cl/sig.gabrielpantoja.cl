'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROPIEDADES_RURALES_FEATURE_URL,
  PROPIEDADES_RURALES_SEARCH_URL,
  normalizePropiedadRuralRol,
  type PropiedadRuralFeatureResponse,
  type PropiedadRuralSearchMatch,
  type PropiedadRuralSearchResponse,
} from '@/lib/propiedades-rurales';
import type { RuralRolSearchState } from '@/components/FieldGroups';
import { track } from '@/lib/analytics';

/**
 * Búsqueda de un ROL en la capa de propiedades rurales CIREN: lista de
 * coincidencias por región (`/search`) y, al elegir una, su geometría
 * (`/feature`) para resaltarla en el mapa. Con una sola coincidencia la
 * selecciona sola. Cada búsqueda nueva aborta la anterior.
 *
 * `onFeatureSelected` deja al padre encender la capa y cerrar el drawer.
 */
export function useRuralRolSearch({
  rol,
  comuna,
  onFeatureSelected,
}: {
  rol: string;
  comuna: string;
  onFeatureSelected: () => void;
}) {
  const [ruralRolSearch, setRuralRolSearch] = useState<RuralRolSearchState>({ kind: 'idle' });
  const [selectedRuralFeature, setSelectedRuralFeature] = useState<PropiedadRuralFeatureResponse | null>(null);
  const ruralSearchController = useRef<AbortController | null>(null);
  const ruralFeatureController = useRef<AbortController | null>(null);

  const clearRuralSearch = useCallback(() => {
    ruralSearchController.current?.abort();
    ruralFeatureController.current?.abort();
    setRuralRolSearch({ kind: 'idle' });
    setSelectedRuralFeature(null);
  }, []);

  const selectRuralMatch = useCallback(async (
    match: PropiedadRuralSearchMatch,
    results = ruralRolSearch.kind === 'results' || ruralRolSearch.kind === 'selecting'
      ? ruralRolSearch.results
      : [match],
  ) => {
    ruralFeatureController.current?.abort();
    const controller = new AbortController();
    ruralFeatureController.current = controller;
    setRuralRolSearch({ kind: 'selecting', results, selectedId: match.id });
    try {
      const params = new URLSearchParams({
        layer: String(match.layerId),
        oid: String(match.objectId),
        rol: match.rol,
      });
      const response = await fetch(`${PROPIEDADES_RURALES_FEATURE_URL}?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('feature');
      const feature = await response.json() as PropiedadRuralFeatureResponse;
      if (controller.signal.aborted) return;
      setSelectedRuralFeature(feature);
      setRuralRolSearch({ kind: 'results', results, truncated: false });
      onFeatureSelected();
    } catch {
      if (controller.signal.aborted) return;
      setRuralRolSearch({
        kind: 'error',
        message: 'No se pudo cargar la geometría del predio desde CIREN. Intenta nuevamente.',
      });
    }
  }, [ruralRolSearch, onFeatureSelected]);

  const locateRuralRol = useCallback(async () => {
    track('rol_search');
    const normalizedRol = normalizePropiedadRuralRol(rol);
    if (!normalizedRol) return;
    ruralSearchController.current?.abort();
    ruralFeatureController.current?.abort();
    setSelectedRuralFeature(null);
    const controller = new AbortController();
    ruralSearchController.current = controller;
    setRuralRolSearch({ kind: 'loading' });
    try {
      const params = new URLSearchParams({
        rol: normalizedRol,
        comuna: comuna === 'todas' ? '' : comuna,
      });
      const response = await fetch(`${PROPIEDADES_RURALES_SEARCH_URL}?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('search');
      const data = await response.json() as PropiedadRuralSearchResponse;
      if (controller.signal.aborted) return;
      setRuralRolSearch({ kind: 'results', results: data.results, truncated: data.truncated });
      if (data.results.length === 1) await selectRuralMatch(data.results[0], data.results);
    } catch {
      if (controller.signal.aborted) return;
      setRuralRolSearch({
        kind: 'error',
        message: 'No se pudo consultar el servicio de propiedades rurales CIREN.',
      });
    }
  }, [comuna, rol, selectRuralMatch]);

  useEffect(() => () => {
    ruralSearchController.current?.abort();
    ruralFeatureController.current?.abort();
  }, []);

  return { ruralRolSearch, selectedRuralFeature, clearRuralSearch, selectRuralMatch, locateRuralRol };
}
