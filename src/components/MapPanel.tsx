'use client';

import type { ReactNode } from 'react';

export type PanelId = 'search' | 'filters' | 'layers' | 'stats';

/**
 * Panel flotante genérico sobre el mapa: botón con ícono + tarjeta colapsable,
 * el mismo lenguaje visual que estrenó LayersControl (borde, fondo translúcido
 * con blur, sombra). Es un componente controlado: no guarda estado propio; el
 * padre (page.tsx) decide cuál panel está activo, garantizando que solo uno
 * esté abierto a la vez, como los widgets de un visor SIG profesional.
 */
export function MapPanel({
  id,
  activeId,
  onActivate,
  icon,
  label,
  badge,
  widthClassName = 'w-72',
  children,
}: {
  id: PanelId;
  activeId: PanelId | null;
  onActivate: (id: PanelId) => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  widthClassName?: string;
  children: ReactNode;
}) {
  const open = activeId === id;

  return (
    <div
      className={`overflow-hidden rounded-lg border border-black/15 bg-[var(--background)]/95 text-[var(--foreground)] shadow-lg backdrop-blur dark:border-white/20 ${
        open ? widthClassName : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onActivate(id)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm font-medium"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          {icon}
          {label}
          {badge != null && badge > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-xs font-semibold text-white">
              {badge}
            </span>
          )}
        </span>
        <span className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>

      {open && (
        <div className="border-t border-black/10 px-3 py-2.5 text-sm dark:border-white/10">
          {children}
        </div>
      )}
    </div>
  );
}
