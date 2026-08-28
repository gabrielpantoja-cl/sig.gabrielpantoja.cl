'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BASEMAPS,
  basemapFilterKey,
  getBasemap,
  type BasemapDef,
  type BasemapId,
} from '@/lib/basemap';

/**
 * Selector de mapa base, esquina inferior izquierda.
 *
 * Sigue el patrón que un usuario ya conoce de Google Maps y de cualquier
 * visor SIG: una miniatura del lienzo vigente que, al pulsarla, despliega la
 * galería de fondos disponibles. Las miniaturas son tiles REALES de cada
 * proveedor sobre el mismo punto (Valparaíso, z12), así que la elección se
 * hace mirando el resultado y no leyendo un nombre técnico.
 *
 * Se abre hacia ARRIBA: el control vive sobre la barra de escala, en el borde
 * inferior del mapa, y un desplegable hacia abajo quedaría fuera de la vista.
 */
export function BasemapSwitcher({
  value,
  onChange,
  className = '',
}: {
  value: BasemapId;
  onChange: (id: BasemapId) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // El tema decide cómo se pinta la miniatura del lienzo neutro. Arranca en
  // `false` y se corrige tras hidratar: leer `matchMedia` en el render inicial
  // produciría un HTML de servidor distinto al del cliente.
  const [isDark, setIsDark] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = getBasemap(value);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setIsDark(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  // Cierre por click fuera y por Escape — un panel flotante sobre el mapa no
  // debe secuestrar el lienzo: cualquier interacción con el mapa lo cierra.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {open && (
        <div
          role="radiogroup"
          aria-label="Mapa base"
          className="absolute bottom-[calc(100%+0.5rem)] left-0 z-[10] w-64 rounded-lg border border-black/15 bg-[var(--background)]/95 p-2.5 shadow-xl backdrop-blur animate-[panel-in_140ms_ease-out] dark:border-white/20"
        >
          <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50">
            Mapa base
          </p>
          <div className="grid grid-cols-3 gap-2">
            {BASEMAPS.map((def) => (
              <BasemapOption
                key={def.id}
                def={def}
                selected={def.id === value}
                isDark={isDark}
                onSelect={() => {
                  onChange(def.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
          <p className="mt-2 border-t border-black/10 pt-2 text-[0.7rem] leading-snug opacity-70 dark:border-white/10">
            {active.hint}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        title={`Mapa base: ${active.label}`}
        className={`group relative block h-16 w-16 overflow-hidden rounded-lg border bg-[var(--background)] shadow-lg transition-colors ${
          open
            ? 'border-[hsl(153_28%_35%)]'
            : 'border-black/25 hover:border-[hsl(153_28%_35%)] dark:border-white/25'
        }`}
      >
        <BasemapThumb def={active} isDark={isDark} />
        <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 text-[0.6rem] font-medium leading-tight text-white">
          {active.label === 'OpenStreetMap' ? 'OSM' : active.label}
        </span>
      </button>
    </div>
  );
}

function BasemapOption({
  def,
  selected,
  isDark,
  onSelect,
}: {
  def: BasemapDef;
  selected: boolean;
  isDark: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="group flex flex-col items-stretch gap-1 text-left"
    >
      <span
        className={`relative block h-12 w-full overflow-hidden rounded-md border-2 transition-colors ${
          selected
            ? 'border-[hsl(153_28%_35%)]'
            : 'border-transparent group-hover:border-black/25 dark:group-hover:border-white/30'
        }`}
      >
        <BasemapThumb def={def} isDark={isDark} />
      </span>
      <span
        className={`truncate text-[0.65rem] leading-tight ${
          selected ? 'font-semibold text-[hsl(153_28%_32%)] dark:text-[hsl(153_38%_62%)]' : 'opacity-70'
        }`}
      >
        {def.label}
      </span>
    </button>
  );
}

/**
 * Miniatura de un fondo. Los fondos filtrados (`neutro`) usan el MISMO tile de
 * OSM que el callejero, así que la miniatura replica el filtro del mapa vía
 * `data-basemap-thumb` (globals.css) — de otro modo las dos opciones se verían
 * idénticas. «Sin fondo» no tiene tile: se dibuja como lienzo rayado.
 */
function BasemapThumb({ def, isDark }: { def: BasemapDef; isDark: boolean }) {
  if (!def.thumb) {
    return (
      <span
        aria-hidden="true"
        className="block h-full w-full bg-[var(--background)]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 7px)',
          color: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)',
        }}
      />
    );
  }
  const filterKey = basemapFilterKey(def.id, isDark);
  return (
    // Tile crudo de un proveedor externo, no un asset del sitio: `next/image`
    // no aporta nada (no hay layout shift ni optimización posible sobre un PNG
    // de 256×256 servido por un tercero) y obligaría a declarar cada host en
    // `remotePatterns`.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={def.thumb}
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      loading="lazy"
      draggable={false}
      data-basemap-thumb={filterKey}
      className="h-full w-full object-cover"
    />
  );
}
