'use client';

import { useState } from 'react';
import { CATEGORY_COLORS } from '@/lib/protected-areas';

/**
 * Panel de capas anclado sobre el mapa (arriba a la derecha). Separa la
 * activación/desactivación de capas de los botones de descarga (CSV/GeoJSON),
 * que viven en la barra de filtros. Cuando la capa de áreas protegidas está
 * activa, muestra la leyenda de categorías legales con su color.
 */
export function LayersControl({
  showProtected,
  onToggleProtected,
}: {
  showProtected: boolean;
  onToggleProtected: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute right-3 top-3 z-[600] w-60 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-black/15 bg-[var(--background)]/95 text-[var(--foreground)] shadow-lg backdrop-blur dark:border-white/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          Capas
        </span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div className="border-t border-black/10 px-3 py-2.5 text-sm dark:border-white/10">
          <label className="flex cursor-default items-center gap-2 opacity-70">
            <input type="checkbox" checked readOnly className="accent-[hsl(153_28%_35%)]" />
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'hsl(153 28% 35%)' }} />
              Transacciones CBR
            </span>
          </label>

          <label className="mt-2 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={showProtected}
              onChange={(e) => onToggleProtected(e.target.checked)}
              className="accent-[hsl(153_28%_35%)]"
            />
            Áreas protegidas (RNAP)
          </label>

          {showProtected && (
            <div className="mt-2.5 border-t border-black/10 pt-2 dark:border-white/10">
              <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-xs">
                {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
                  <li key={cat} className="flex items-center gap-1.5 leading-tight">
                    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                    <span className="opacity-80">{cat}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
                Fuente: Ministerio del Medio Ambiente · Registro Nacional de Áreas Protegidas · CC0
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
