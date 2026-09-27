'use client';

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

/** Which of the two tabs is showing: the full catalogue or the active layers. */
export type LayerSidebarView = 'catalogue' | 'active';

const LAYERS_ICON = (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

function tabClassName(selected: boolean): string {
  return `rounded px-2 py-1.5 font-medium ${selected ? 'bg-[var(--background)] shadow-sm' : 'opacity-60'}`;
}

/**
 * Shell of the layer panel: header, layer search, tabs and scroll area. The
 * CONTENT (rows, legends, opacity sliders) is passed in as `children` by
 * `LayersControl`, which also owns every piece of layer state — this component
 * keeps no state beyond the imperative refs it needs to move focus.
 *
 * Two presentations of the same panel, switched purely with responsive
 * classes so exactly ONE set of DOM ids exists (duplicate ids break
 * `aria-controls` and axe's `aria-valid-attr-value`):
 *
 * - Desktop (`md:`): an in-flow 320 px dock. It is a flex sibling of the map
 *   section, so opening it narrows the Leaflet container instead of covering
 *   it — the QGIS / Google Earth Pro behaviour, and the reason `MapView` runs
 *   a `ResizeObserver`. When closed, a narrow vertical tab docked to the left
 *   edge of the map is the only thing rendered.
 * - Mobile: a bottom drawer over a backdrop, mirroring the filter drawer, so
 *   the panel never eats ~80 % of the viewport (docs/auditoria-ux-2026-08.md
 *   § P4). It mounts only while open: a translated-off-screen drawer would
 *   keep its links and inputs in the tab order.
 *
 * The dock width is deliberately NOT animated. `invalidateSize` fires four
 * viewport refetches (hexbins, suelos, vegetacional, propiedades rurales) and
 * the public API is rate limited to 60 req/min/IP — an animated dock would
 * burn that budget in one gesture.
 */
export function LayerSidebar({
  open,
  onToggle,
  badge,
  query,
  onQuery,
  view,
  onViewChange,
  matchCount,
  children,
}: {
  /** Whether the panel is open. Driven by `activeId === 'layers'` upstream. */
  open: boolean;
  /** Expand or collapse. One callback: the parent already toggles. */
  onToggle: () => void;
  /** Number of active thematic layers; drives both badges. */
  badge: number;
  query: string;
  onQuery: (value: string) => void;
  view: LayerSidebarView;
  onViewChange: (view: LayerSidebarView) => void;
  /** Matching layers, or null when no search is in flight. */
  matchCount: number | null;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Move focus into the search box when the dock opens on desktop. Skipping
  // mobile avoids popping the virtual keyboard over half the drawer.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus();
  }, [open]);

  // Escape: clear the search first (the usual intent while filtering), then
  // close. Left to the native handler when a <select> has focus, so the
  // variable pickers (WorldClim, destino SII) keep their own Escape behaviour.
  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Escape') return;
    const target = event.target;
    if (target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLInputElement && target.type === 'search' && target.value !== '') {
      event.preventDefault();
      onQuery('');
      return;
    }
    event.preventDefault();
    onToggle();
  };

  if (!open) {
    return (
      <>
        {/* Desktop: vertical tab on the left edge of the map. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Abrir panel de capas${badge > 0 ? `, ${badge} activas` : ''}`}
          className="absolute left-0 top-1/2 z-[850] hidden -translate-y-1/2 flex-col items-center gap-2 rounded-r-lg border border-l-0 border-black/15 bg-[var(--background)]/95 px-1.5 py-3 text-[var(--foreground)] shadow-lg backdrop-blur hover:bg-[var(--background)] focus-visible:outline-2 md:flex dark:border-white/20"
        >
          {LAYERS_ICON}
          <span className="rotate-180 text-[0.65rem] font-semibold uppercase tracking-wider [writing-mode:vertical-rl]">
            Capas
          </span>
          {badge > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-[0.6rem] font-semibold text-white">
              {badge}
            </span>
          )}
        </button>

        {/* Mobile: trigger below the geocoder bar, where the old chip was. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Abrir panel de capas${badge > 0 ? `, ${badge} activas` : ''}`}
          className="absolute right-3 top-[3.75rem] z-[600] flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-black/15 bg-[var(--background)]/95 px-2.5 py-1.5 text-xs font-medium text-[var(--foreground)] shadow-lg backdrop-blur hover:bg-[var(--background)] focus-visible:outline-2 md:hidden dark:border-white/20"
        >
          {LAYERS_ICON}
          Capas
          {badge > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-[0.6rem] font-semibold text-white">
              {badge}
            </span>
          )}
        </button>
      </>
    );
  }

  return (
    <>
      {/* Mobile backdrop; inert on desktop so the map stays interactive. */}
      <div
        className="fixed inset-0 z-[1100] bg-black/40 md:hidden"
        onClick={onToggle}
        aria-hidden="true"
      />

      <aside
        id="layer-sidebar-panel"
        aria-label="Capas del mapa"
        onKeyDown={handleKeyDown}
        className="fixed inset-x-0 bottom-0 z-[1101] flex max-h-[70vh] w-full flex-col rounded-t-2xl border-t border-black/10 bg-[var(--background)] text-[var(--foreground)] shadow-2xl md:relative md:inset-auto md:z-[1050] md:min-h-0 md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-t-0 md:border-r md:shadow-none dark:border-white/10"
      >
        <div className="flex items-center justify-between gap-2 border-b border-black/10 px-3 py-2 dark:border-white/10">
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            {LAYERS_ICON}
            Capas
            {badge > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-xs font-semibold text-white">
                {badge}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={true}
            aria-controls="layer-sidebar-panel"
            aria-label="Cerrar panel de capas"
            className="rounded-md px-1.5 py-1 text-base leading-none opacity-60 hover:opacity-100 focus-visible:outline-2"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-black/10 px-3 py-2 dark:border-white/10">
          <input
            ref={inputRef}
            id="layer-search"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Buscar capa…"
            aria-label="Buscar capas"
            className="w-full rounded-md border border-black/15 bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none placeholder:opacity-50 focus:border-[hsl(153_28%_35%)] dark:border-white/20"
          />

          {/* Single status region for count AND empty state: two regions would
              announce the same change twice to a screen reader. */}
          {matchCount !== null && (
            <p role="status" className="mt-1.5 text-[0.65rem] leading-snug opacity-60">
              {matchCount === 0
                ? 'No se encontraron capas.'
                : `${matchCount} ${matchCount === 1 ? 'capa coincide' : 'capas coinciden'}`}
            </p>
          )}

          <div
            role="tablist"
            aria-label="Inspector de capas"
            className="mt-2 grid grid-cols-2 rounded-md bg-black/5 p-1 text-xs dark:bg-white/10"
          >
            <button
              id="layer-tab-catalogue"
              type="button"
              role="tab"
              aria-selected={view === 'catalogue'}
              aria-controls="layer-panel-catalogue"
              onClick={() => onViewChange('catalogue')}
              className={tabClassName(view === 'catalogue')}
            >
              Catálogo
            </button>
            <button
              id="layer-tab-active"
              type="button"
              role="tab"
              aria-selected={view === 'active'}
              aria-controls="layer-panel-active"
              onClick={() => onViewChange('active')}
              className={tabClassName(view === 'active')}
            >
              Activas ({badge})
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">{children}</div>
      </aside>
    </>
  );
}
