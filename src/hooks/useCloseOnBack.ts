'use client';

import { useEffect, useRef } from 'react';

/** Subset of the CloseWatcher API (Chrome 120+); not in TypeScript's lib.dom yet. */
interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}
type CloseWatcherCtor = new () => CloseWatcherLike;

/**
 * Closes a panel with the Android back button (gesture or key) and with
 * Escape, while `open` is true.
 *
 * Without this, «atrás» on Android leaves the site with the panel still open.
 * `CloseWatcher` is used instead of pushing a history entry: the permalink
 * rewrites the URL with `replaceState` while the panel is open, and popping a
 * pushed entry would bring back the URL from before those changes. Browsers
 * without CloseWatcher (Firefox, Safari) keep Escape, which CloseWatcher also
 * covers where it exists.
 */
export function useCloseOnBack(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const Ctor = (window as unknown as { CloseWatcher?: CloseWatcherCtor }).CloseWatcher;
    if (Ctor) {
      const watcher = new Ctor();
      watcher.onclose = () => onCloseRef.current();
      return () => watcher.destroy();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
