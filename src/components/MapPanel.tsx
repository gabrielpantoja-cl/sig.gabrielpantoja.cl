'use client';

import type { ReactNode } from 'react';

export type PanelId = 'search' | 'filters' | 'layers' | 'stats';

/**
 * Panel flotante genérico sobre el mapa: botón (chip) de tamaño fijo + tarjeta
 * desplegable ANCLADA con position:absolute bajo el botón. Al abrir, la tarjeta
 * flota sobre el mapa sin alterar el tamaño del chip, de modo que los botones
 * vecinos nunca se desplazan — el comportamiento estándar de un visor SIG
 * profesional. Es un componente controlado: no guarda estado propio; el padre
 * (page.tsx) decide cuál panel está activo, garantizando que solo uno esté
 * abierto a la vez.
 */
export function MapPanel({
  id,
  activeId,
  onActivate,
  icon,
  label,
  badge,
  widthClassName = 'w-72',
  align = 'left',
  children,
}: {
  id: PanelId;
  activeId: PanelId | null;
  onActivate: (id: PanelId) => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  widthClassName?: string;
  align?: 'left' | 'right';
  children: ReactNode;
}) {
  const open = activeId === id;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onActivate(id)}
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-medium text-[var(--foreground)] shadow-lg backdrop-blur transition-colors ${
          open
            ? 'border-[hsl(153_28%_35%)]/70 bg-[var(--background)]'
            : 'border-black/15 bg-[var(--background)]/95 hover:bg-[var(--background)] dark:border-white/20'
        }`}
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
        <div
          className={`absolute top-[calc(100%+0.5rem)] z-[700] max-h-[min(70vh,34rem)] overflow-y-auto rounded-lg border border-black/15 bg-[var(--background)]/95 px-3 py-2.5 text-sm text-[var(--foreground)] shadow-xl backdrop-blur animate-[panel-in_140ms_ease-out] dark:border-white/20 ${widthClassName} ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
