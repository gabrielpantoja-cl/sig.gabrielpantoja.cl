'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { GeocodeResult } from '@/lib/types';

/**
 * Buscador de direcciones/lugares con autocompletado, estilo visor de mapas
 * (Google Maps): el usuario escribe una dirección, elige una sugerencia y el
 * mapa vuela a esa zona. Consulta /api/geocode (proxy de Nominatim restringido
 * a Chile) con debounce, cancelación de requests y navegación por teclado.
 * No toca la base CBR: es navegación espacial pura.
 */

const DEBOUNCE_MS = 350;
const MIN_QUERY = 3;

/** Parte principal y secundaria del display_name de Nominatim (separado por comas). */
function splitLabel(label: string): { main: string; rest: string } {
  const i = label.indexOf(',');
  if (i === -1) return { main: label, rest: '' };
  return { main: label.slice(0, i), rest: label.slice(i + 1).trim() };
}

export function GeocoderSearch({
  onSelect,
  className = '',
}: {
  onSelect: (r: GeocodeResult) => void;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  // Última etiqueta elegida: evita re-buscar cuando choose() reescribe el input.
  const chosen = useRef<string | null>(null);
  const listboxId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY || q === chosen.current) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((rs: GeocodeResult[]) => {
          setResults(Array.isArray(rs) ? rs : []);
          setActive(rs.length ? 0 : -1);
          setOpen(true);
          setSearching(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setResults([]);
          setOpen(false);
          setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const choose = (r: GeocodeResult) => {
    const { main, rest } = splitLabel(r.label);
    const short = rest ? `${main}, ${rest.split(',')[0].trim()}` : main;
    chosen.current = short;
    setQuery(short);
    setResults([]);
    setOpen(false);
    onSelect(r);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === 'Escape') setQuery('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && active < results.length) choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2 rounded-lg border border-black/15 bg-[var(--background)]/95 px-3 shadow-lg backdrop-blur dark:border-white/20">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="shrink-0 opacity-50"
        >
          <path d="M12 21s-6-5.1-6-10a6 6 0 1 1 12 0c0 4.9-6 10-6 10Z" />
          <circle cx="12" cy="11" r="2.2" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-label="Buscar dirección o lugar"
          autoComplete="off"
          spellCheck={false}
          placeholder="Buscar dirección o lugar…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setOpen(false)}
          className="h-[2.35rem] w-full min-w-0 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground)]/45"
        />
        {searching ? (
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50"
            aria-hidden="true"
          />
        ) : (
          query && (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                chosen.current = null;
                setQuery('');
              }}
              className="shrink-0 rounded px-0.5 leading-none opacity-40 hover:opacity-100"
            >
              ✕
            </button>
          )
        )}
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Sugerencias de lugares"
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[700] overflow-hidden rounded-lg border border-black/15 bg-[var(--background)]/95 shadow-xl backdrop-blur animate-[panel-in_140ms_ease-out] dark:border-white/20"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2.5 text-sm opacity-60">Sin resultados en Chile</li>
          ) : (
            results.map((r, i) => {
              const { main, rest } = splitLabel(r.label);
              return (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(r)}
                    onMouseEnter={() => setActive(i)}
                    className={`block w-full px-3 py-2 text-left text-sm ${
                      i === active ? 'bg-[hsl(153_28%_35%)]/15' : ''
                    }`}
                  >
                    <span className="block truncate font-medium">{main}</span>
                    {rest && <span className="block truncate text-xs opacity-55">{rest}</span>}
                  </button>
                </li>
              );
            })
          )}
          <li className="border-t border-black/10 px-3 py-1 text-[0.6rem] opacity-45 dark:border-white/10">
            © OpenStreetMap · Nominatim
          </li>
        </ul>
      )}
    </div>
  );
}
