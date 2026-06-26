'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Facets, MapPoint, Stats } from '@/lib/types';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm opacity-60">
      Cargando mapa…
    </div>
  ),
});

const fmtCLP = (v: number | null | undefined): string =>
  v == null
    ? '—'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(v);

const fmtInt = (v: number): string => v.toLocaleString('es-CL');

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export default function Home() {
  const [facets, setFacets] = useState<Facets | null>(null);

  const [comuna, setComuna] = useState('todas');
  const [anioFrom, setAnioFrom] = useState<number | null>(null);
  const [montoMin, setMontoMin] = useState('');
  const [montoMax, setMontoMax] = useState('');
  const [supMin, setSupMin] = useState('');
  const [supMax, setSupMax] = useState('');
  const [predio, setPredio] = useState('');
  const [rol, setRol] = useState('');

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Mobile-only: the filter drawer (bottom sheet) is collapsed by default so the
  // map owns the screen. On desktop the filters are always visible inline.
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Load facets once.
  useEffect(() => {
    fetch('/api/facets')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((f: Facets) => setFacets(f))
      .catch(() => {});
  }, []);

  const effectiveAnioFrom = anioFrom ?? facets?.minAnio ?? 2015;

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (comuna !== 'todas') p.set('comuna', comuna);
    if (anioFrom != null) p.set('anio_min', String(anioFrom));
    if (montoMin) p.set('monto_min', montoMin);
    if (montoMax) p.set('monto_max', montoMax);
    if (supMin) p.set('sup_min', supMin);
    if (supMax) p.set('sup_max', supMax);
    if (predio.trim()) p.set('predio', predio.trim());
    if (rol.trim()) p.set('rol', rol.trim());
    return p.toString();
  }, [comuna, anioFrom, montoMin, montoMax, supMin, supMax, predio, rol]);

  const activeFilters = [
    comuna !== 'todas',
    anioFrom != null,
    montoMin,
    montoMax,
    supMin,
    supMax,
    predio.trim(),
    rol.trim(),
  ].filter(Boolean).length;

  const debouncedQs = useDebounced(queryString, 400);

  // Fetch points + stats whenever the (debounced) filters change.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);

    const suffix = debouncedQs ? `?${debouncedQs}` : '';
    Promise.all([
      fetch(`/api/points${suffix}`, { signal: ctrl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),
      fetch(`/api/stats${suffix}`, { signal: ctrl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),
    ])
      .then(([pts, st]: [MapPoint[], Stats]) => {
        if (id !== reqId.current) return;
        setPoints(Array.isArray(pts) ? pts : []);
        setStats(st);
        setLoading(false);
      })
      .catch(() => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setError(true);
        setLoading(false);
      });

    return () => ctrl.abort();
  }, [debouncedQs]);

  const exportHref = (format: 'csv' | 'geojson') =>
    `/api/export?${debouncedQs ? `${debouncedQs}&` : ''}format=${format}`;

  return (
    <main className="flex flex-1 flex-col">
      {/* Header — compact on mobile so the map stays above the fold */}
      <header className="border-b border-black/10 px-4 py-3 md:px-8 md:py-6 dark:border-white/10">
        <p className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
          SIG de suelo · Datos abiertos
        </p>
        <h1 className="mt-1 text-lg font-medium md:text-3xl">
          Transacciones de suelo rural — Conservador de Bienes Raíces
        </h1>
        <p className="mt-2 line-clamp-2 max-w-3xl text-sm opacity-70 md:line-clamp-none">
          Compraventas inscritas en el CBR del centro-sur de Chile. Datos públicos:
          precio, año, comuna, superficie, ROL y coordenadas — sin nombres ni RUT.
          Consulta libre para peritos e investigación en ecoinformática.
        </p>
      </header>

      {/* Mobile toolbar — opens the filter drawer + shows the result count */}
      <div className="flex items-center gap-3 border-b border-black/10 px-4 py-2 md:hidden dark:border-white/10">
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium dark:border-white/20"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          Filtros
          {activeFilters > 0 && (
            <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-xs font-semibold text-white">
              {activeFilters}
            </span>
          )}
        </button>
        <span className="ml-auto text-sm tabular-nums opacity-70">
          {loading ? '…' : `${fmtInt(stats?.count ?? 0)} resultados`}
        </span>
      </div>

      {/* Backdrop behind the mobile drawer */}
      {filtersOpen && (
        <div
          className="fixed inset-0 z-[1100] bg-black/40 md:hidden"
          onClick={() => setFiltersOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Controls — inline on desktop, slide-up bottom sheet on mobile */}
      <section
        className={`flex flex-wrap items-end gap-x-6 gap-y-4 border-b border-black/10 px-4 py-4 md:px-8 dark:border-white/10 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-[1101] max-md:max-h-[82vh] max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border max-md:bg-[var(--background)] max-md:pb-6 max-md:shadow-2xl max-md:transition-transform max-md:duration-300 ${
          filtersOpen ? 'max-md:translate-y-0' : 'max-md:translate-y-full'
        }`}
      >
        {/* Drawer header (mobile only) */}
        <div className="flex w-full items-center justify-between md:hidden">
          <span className="text-base font-medium">Filtros</span>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label="Cerrar filtros"
            className="rounded-md px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">Comuna</span>
          <select
            value={comuna}
            onChange={(e) => setComuna(e.target.value)}
            className="h-9 min-w-[12rem] rounded-md border border-black/15 bg-transparent px-2 max-md:w-full dark:border-white/20"
          >
            <option value="todas">Todas</option>
            {facets?.comunas.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">
            Desde el año: <span className="opacity-70">{effectiveAnioFrom}</span>
          </span>
          <input
            type="range"
            min={facets?.minAnio ?? 2015}
            max={facets?.maxAnio ?? 2025}
            value={effectiveAnioFrom}
            onChange={(e) => setAnioFrom(Number(e.target.value))}
            className="w-48 max-md:w-full"
            disabled={!facets}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">Monto (CLP)</span>
          <div className="flex items-center gap-1 max-md:w-full">
            <input
              type="number"
              inputMode="numeric"
              placeholder="mín"
              value={montoMin}
              onChange={(e) => setMontoMin(e.target.value)}
              className="h-9 w-28 rounded-md border border-black/15 bg-transparent px-2 max-md:flex-1 dark:border-white/20"
            />
            <span className="opacity-50">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="máx"
              value={montoMax}
              onChange={(e) => setMontoMax(e.target.value)}
              className="h-9 w-28 rounded-md border border-black/15 bg-transparent px-2 max-md:flex-1 dark:border-white/20"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">Superficie (m²)</span>
          <div className="flex items-center gap-1 max-md:w-full">
            <input
              type="number"
              inputMode="numeric"
              placeholder="mín"
              value={supMin}
              onChange={(e) => setSupMin(e.target.value)}
              className="h-9 w-24 rounded-md border border-black/15 bg-transparent px-2 max-md:flex-1 dark:border-white/20"
            />
            <span className="opacity-50">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="máx"
              value={supMax}
              onChange={(e) => setSupMax(e.target.value)}
              className="h-9 w-24 rounded-md border border-black/15 bg-transparent px-2 max-md:flex-1 dark:border-white/20"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">ROL</span>
          <input
            type="text"
            placeholder="ej. 123-45"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="h-9 w-32 rounded-md border border-black/15 bg-transparent px-2 max-md:w-full dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm max-md:w-full">
          <span className="font-medium">Predio</span>
          <input
            type="text"
            placeholder="nombre del predio"
            value={predio}
            onChange={(e) => setPredio(e.target.value)}
            className="h-9 w-44 rounded-md border border-black/15 bg-transparent px-2 max-md:w-full dark:border-white/20"
          />
        </label>

        <div className="flex items-center gap-2 md:ml-auto max-md:mt-1 max-md:w-full">
          <a
            href={exportHref('csv')}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 max-md:flex-1 max-md:text-center dark:border-white/20 dark:hover:bg-white/10"
          >
            CSV
          </a>
          <a
            href={exportHref('geojson')}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 max-md:flex-1 max-md:text-center dark:border-white/20 dark:hover:bg-white/10"
          >
            GeoJSON
          </a>
        </div>

        {/* Primary action to dismiss the drawer (mobile only) */}
        <button
          type="button"
          onClick={() => setFiltersOpen(false)}
          className="w-full rounded-md bg-[hsl(153_28%_30%)] py-2.5 text-sm font-medium text-white md:hidden"
        >
          Ver {loading ? '' : fmtInt(stats?.count ?? 0)} resultados en el mapa
        </button>
      </section>

      {/* Stats — wrap on desktop, single scrollable strip on mobile */}
      <section className="flex gap-x-6 gap-y-2 overflow-x-auto border-b border-black/10 px-4 py-3 text-sm md:flex-wrap md:gap-x-8 md:px-8 dark:border-white/10">
        <Stat label="Transacciones" value={loading ? '…' : fmtInt(stats?.count ?? 0)} />
        <Stat label="Promedio" value={loading ? '…' : fmtCLP(stats?.avg)} />
        <Stat label="Mediana" value={loading ? '…' : fmtCLP(stats?.mediana)} />
        <Stat label="Mín" value={loading ? '…' : fmtCLP(stats?.min)} />
        <Stat label="Máx" value={loading ? '…' : fmtCLP(stats?.max)} />
        <Stat label="$ / m²" value={loading ? '…' : fmtCLP(stats?.precio_m2)} />
      </section>

      {/* Map — guaranteed height on mobile so it never collapses */}
      <section className="relative min-h-[55vh] flex-1 md:min-h-0">
        {error && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center text-sm text-red-600">
            No se pudieron cargar los datos del mapa.
          </div>
        )}
        <div className="absolute inset-0">
          <MapView points={points} />
        </div>
      </section>

      <footer className="border-t border-black/10 px-4 py-3 text-xs opacity-60 md:px-8 dark:border-white/10">
        Fuente: recopilación propia de inscripciones del Conservador de Bienes
        Raíces. Datos públicos y anonimizados.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex shrink-0 flex-col">
      <span className="text-xs uppercase tracking-wide opacity-50">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
