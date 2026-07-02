'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Facets, MapPoint, Stats } from '@/lib/types';
import { RetroLoader } from '@/components/RetroLoader';
import { LayersControl } from '@/components/LayersControl';
import { MapPanel, type PanelId } from '@/components/MapPanel';
import { SearchFields, FilterFields, StatsFields } from '@/components/FieldGroups';
import { InfoPanel } from '@/components/InfoPanel';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => <RetroLoader loading={true} />,
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

const SearchIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

const FilterIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="7" y1="12" x2="17" y2="12" />
    <line x1="10" y1="18" x2="14" y2="18" />
  </svg>
);

const StatsIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="5" y1="20" x2="5" y2="12" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="19" y1="20" x2="19" y2="9" />
  </svg>
);

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

  // Desktop: paneles flotantes sobre el mapa, solo uno abierto a la vez.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const togglePanel = (id: PanelId) => setActivePanel((p) => (p === id ? null : id));

  // Mobile: drawer consolidado (búsqueda + filtros + estadísticas), cerrado
  // por defecto para que el mapa sea dueño de la pantalla.
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [showProtected, setShowProtected] = useState(false);
  const [showUrbanLimit, setShowUrbanLimit] = useState(false);

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
  ].filter(Boolean).length;

  const activeSearch = [predio.trim(), rol.trim()].filter(Boolean).length;

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

  const searchFields = (
    <SearchFields predio={predio} setPredio={setPredio} rol={rol} setRol={setRol} />
  );

  const filterFields = (
    <FilterFields
      comuna={comuna}
      setComuna={setComuna}
      facets={facets}
      setAnioFrom={setAnioFrom}
      effectiveAnioFrom={effectiveAnioFrom}
      montoMin={montoMin}
      setMontoMin={setMontoMin}
      montoMax={montoMax}
      setMontoMax={setMontoMax}
      supMin={supMin}
      setSupMin={setSupMin}
      supMax={supMax}
      setSupMax={setSupMax}
      exportHref={exportHref}
    />
  );

  const statsFields = (
    <StatsFields loading={loading} stats={stats} fmtCLP={fmtCLP} fmtInt={fmtInt} />
  );

  return (
    <main className="flex flex-1 flex-col">
      {/* Header — una sola fila delgada para que el mapa domine la pantalla */}
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 md:px-6 md:py-3 dark:border-white/10">
        <h1 className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
          SIG de suelo · Datos abiertos
        </h1>
        <InfoPanel />
      </header>

      {/* Backdrop behind the mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[1100] bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer mobile consolidado: búsqueda + filtros + estadísticas */}
      <section
        className={`fixed inset-x-0 bottom-0 z-[1101] max-h-[82vh] overflow-y-auto rounded-t-2xl border border-black/10 bg-[var(--background)] px-4 py-4 pb-6 shadow-2xl transition-transform duration-300 md:hidden dark:border-white/10 ${
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-medium">Buscar y filtrar</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>

        <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide opacity-50">Buscar</h2>
        <div className="mt-2">{searchFields}</div>

        <h2 className="mt-5 border-t border-black/10 pt-4 text-xs font-semibold uppercase tracking-wide opacity-50 dark:border-white/10">
          Filtros
        </h2>
        <div className="mt-2">{filterFields}</div>

        <h2 className="mt-5 border-t border-black/10 pt-4 text-xs font-semibold uppercase tracking-wide opacity-50 dark:border-white/10">
          Estadísticas
        </h2>
        <div className="mt-2">{statsFields}</div>

        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="mt-5 w-full rounded-md bg-[hsl(153_28%_30%)] py-2.5 text-sm font-medium text-white"
        >
          Ver {loading ? '' : fmtInt(stats?.count ?? 0)} resultados en el mapa
        </button>
      </section>

      {/* Mapa a pantalla completa con paneles flotantes */}
      <section className="relative min-h-[70vh] flex-1 md:min-h-0">
        {error && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center text-sm text-red-600">
            No se pudieron cargar los datos del mapa.
          </div>
        )}
        {loading && points.length === 0 && <RetroLoader loading={loading} />}
        <div className="absolute inset-0">
          <MapView
            points={points}
            showProtected={showProtected}
            showUrbanLimit={showUrbanLimit}
          />
        </div>

        {/* Clúster de paneles arriba a la izquierda, junto al control de zoom (desktop) */}
        <div className="absolute left-14 top-3 z-[600] hidden items-start gap-2 md:flex">
          <MapPanel
            id="search"
            activeId={activePanel}
            onActivate={togglePanel}
            icon={SearchIcon}
            label="Buscar"
            badge={activeSearch}
            widthClassName="w-72"
          >
            {searchFields}
          </MapPanel>

          <MapPanel
            id="filters"
            activeId={activePanel}
            onActivate={togglePanel}
            icon={FilterIcon}
            label="Filtros"
            badge={activeFilters}
            widthClassName="w-80"
          >
            {filterFields}
          </MapPanel>

          <MapPanel
            id="stats"
            activeId={activePanel}
            onActivate={togglePanel}
            icon={StatsIcon}
            label="Estadísticas"
            widthClassName="w-72"
          >
            <p className="mb-2 text-xs opacity-60">
              {loading ? 'Cargando…' : `${fmtInt(stats?.count ?? 0)} transacciones en la selección`}
            </p>
            {statsFields}
          </MapPanel>
        </div>

        {/* Panel de capas arriba a la derecha (desktop y mobile) */}
        <div className="absolute right-3 top-3 z-[600] w-60 max-w-[calc(100%-1.5rem)]">
          <LayersControl
            activeId={activePanel}
            onActivate={togglePanel}
            showProtected={showProtected}
            onToggleProtected={setShowProtected}
            showUrbanLimit={showUrbanLimit}
            onToggleUrbanLimit={setShowUrbanLimit}
          />
        </div>

        {/* FAB mobile: abre el drawer consolidado */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-4 left-1/2 z-[600] inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 bg-[var(--background)]/95 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur md:hidden dark:border-white/20"
        >
          {FilterIcon}
          Buscar y filtrar
          {activeFilters + activeSearch > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-xs font-semibold text-white">
              {activeFilters + activeSearch}
            </span>
          )}
          <span className="tabular-nums opacity-60">
            · {loading ? '…' : fmtInt(stats?.count ?? 0)}
          </span>
        </button>
      </section>
    </main>
  );
}
