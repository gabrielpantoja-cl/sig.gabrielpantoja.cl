'use client';

import {
  isBasemapId,
  BASEMAP_STORAGE_KEY,
  DEFAULT_BASEMAP_ID,
  type BasemapId,
} from '@/lib/basemap';

/**
 * Preferencia de mapa base del usuario, expuesta como *external store* para
 * `useSyncExternalStore`.
 *
 * ## Por qué un store y no `useState` + `useEffect`
 *
 * El valor vive en `localStorage`, que no existe al renderizar en el servidor.
 * Las dos soluciones ingenuas fallan:
 *
 * - Leer `localStorage` en el inicializador de `useState` rompe la hidratación:
 *   el servidor pinta el fondo por defecto y el cliente pintaría el guardado.
 * - Leerlo en un `useEffect` y llamar a `setState` provoca un render en
 *   cascada (lo que marca `react-hooks/set-state-in-effect`) y un parpadeo
 *   visible del mapa base recién elegido.
 *
 * `useSyncExternalStore` está hecho exactamente para esto: declara un
 * *snapshot* de servidor (siempre el default) distinto del de cliente (el
 * guardado), y React reconcilia sin avisos ni renders extra.
 *
 * El valor leído se cachea en memoria porque `getSnapshot` se invoca en cada
 * render y debe ser barato y estable: devolver un `localStorage.getItem`
 * fresco cada vez es una lectura síncrona al disco por render.
 */

let cached: BasemapId | null = null;
const listeners = new Set<() => void>();

function read(): BasemapId {
  if (cached !== null) return cached;
  try {
    const saved = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
    cached = isBasemapId(saved) ? saved : DEFAULT_BASEMAP_ID;
  } catch {
    // localStorage bloqueado (modo privado, políticas del navegador): el
    // selector sigue funcionando, solo no recuerda entre sesiones.
    cached = DEFAULT_BASEMAP_ID;
  }
  return cached;
}

export function subscribeBasemap(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getBasemapSnapshot(): BasemapId {
  return read();
}

/** En el servidor no hay preferencia guardada: siempre el fondo por defecto. */
export function getBasemapServerSnapshot(): BasemapId {
  return DEFAULT_BASEMAP_ID;
}

export function setBasemapPreference(id: BasemapId): void {
  if (cached === id) return;
  cached = id;
  try {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, id);
  } catch {
    // Elegir el fondo nunca debe fallar por no poder persistirlo.
  }
  for (const listener of listeners) listener();
}
