'use client';

import { useCallback, useEffect, useRef } from 'react';
import { DEFAULT_BASEMAP_ID } from '@/lib/basemap';
import { DESTINO_DEFAULT, HEXBIN_MIN_N_DEFAULT } from '@/lib/hexbins';
import {
  serializePermalink,
  type PermalinkDefaults,
  type PermalinkState,
  type PermalinkView,
} from '@/lib/permalink';

/** Valores que no se escriben en la URL (ver `serializePermalink`). */
export const PERMALINK_DEFAULTS: PermalinkDefaults = {
  basemap: DEFAULT_BASEMAP_ID,
  bioclima: 'precipitation',
  destino: DESTINO_DEFAULT,
  minN: HEXBIN_MIN_N_DEFAULT,
};

/** Espera tras el último cambio antes de reescribir la URL. */
const WRITE_DELAY_MS = 400;

/**
 * Mantiene la URL al día con la vista del SIG. Usa `history.replaceState`
 * (no `pushState`): mover el mapa no debe llenar el historial, y «Atrás»
 * sigue llevando a la página anterior. La escritura espera a que el usuario
 * se detenga; `flush()` la fuerza, para que «Compartir» nunca copie una URL
 * atrasada.
 *
 * `state` es todo menos el encuadre; el encuadre llega por `onViewChange`
 * desde MapView en cada `moveend`, sin pasar por el estado de React (re-
 * renderizar la página entera en cada paneo no aporta nada).
 */
export function usePermalinkSync(
  state: Omit<PermalinkState, 'view'>,
  initialView: PermalinkView | null,
): { onViewChange: (view: PermalinkView) => void; flush: () => void } {
  const stateRef = useRef(state);
  const viewRef = useRef(initialView);
  const timer = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const qs = serializePermalink({ ...stateRef.current, view: viewRef.current }, PERMALINK_DEFAULTS);
    const { pathname, search, hash } = window.location;
    const next = `${pathname}${qs ? `?${qs}` : ''}${hash}`;
    if (next !== `${pathname}${search}${hash}`) window.history.replaceState(null, '', next);
  }, []);

  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, WRITE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    stateRef.current = state;
    schedule();
  }, [state, schedule]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onViewChange = useCallback(
    (view: PermalinkView) => {
      viewRef.current = view;
      schedule();
    },
    [schedule],
  );

  return { onViewChange, flush };
}
