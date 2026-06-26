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
      {/* Header */}
      <header className="border-b border-black/10 px-4 py-6 md:px-8 dark:border-white/10">
        <p className="text-xs uppercase tracking-[0.18em] opacity-60">
          SIG de suelo · Datos abiertos
        </p>
        <h1 className="mt-1 text-2xl font-medium md:text-3xl">
          Transacciones de suelo rural — Conservador de Bienes Raíces
        </h1>
        <p className="mt-2 max-w-3xl text-sm opacity-70">
          Compraventas inscritas en el CBR del centro-sur de Chile. Datos públicos:
          precio, año, comuna, superficie, ROL y coordenadas — sin nombres ni RUT.
          Consulta libre para peritos e investigación en ecoinformática.
        </p>
      </header>

      {/* Controls */}
      <section className="flex flex-wrap items-end gap-x-6 gap-y-4 border-b border-black/10 px-4 py-4 md:px-8 dark:border-white/10">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Comuna</span>
          <select
            value={comuna}
            onChange={(e) => setComuna(e.target.value)}
            className="h-9 min-w-[12rem] rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
          >
            <option value="todas">Todas</option>
            {facets?.comunas.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            Desde el año: <span className="opacity-70">{effectiveAnioFrom}</span>
          </span>
          <input
            type="range"
            min={facets?.minAnio ?? 2015}
            max={facets?.maxAnio ?? 2025}
            value={effectiveAnioFrom}
            onChange={(e) => setAnioFrom(Number(e.target.value))}
            className="w-48"
            disabled={!facets}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Monto (CLP)</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="numeric"
              placeholder="mín"
              value={montoMin}
              onChange={(e) => setMontoMin(e.target.value)}
              className="h-9 w-28 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
            />
            <span className="opacity-50">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="máx"
              value={montoMax}
              onChange={(e) => setMontoMax(e.target.value)}
              className="h-9 w-28 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Superficie (m²)</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="numeric"
              placeholder="mín"
              value={supMin}
              onChange={(e) => setSupMin(e.target.value)}
              className="h-9 w-24 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
            />
            <span className="opacity-50">–</span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="máx"
              value={supMax}
              onChange={(e) => setSupMax(e.target.value)}
              className="h-9 w-24 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">ROL</span>
          <input
            type="text"
            placeholder="ej. 123-45"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="h-9 w-32 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Predio</span>
          <input
            type="text"
            placeholder="nombre del predio"
            value={predio}
            onChange={(e) => setPredio(e.target.value)}
            className="h-9 w-44 rounded-md border border-black/15 bg-transparent px-2 dark:border-white/20"
          />
        </label>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={exportHref('csv')}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            CSV
          </a>
          <a
            href={exportHref('geojson')}
            className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            GeoJSON
          </a>
        </div>
      </section>

      {/* Stats */}
      <section className="flex flex-wrap gap-x-8 gap-y-2 border-b border-black/10 px-4 py-3 text-sm md:px-8 dark:border-white/10">
        <Stat label="Transacciones" value={loading ? '…' : fmtInt(stats?.count ?? 0)} />
        <Stat label="Promedio" value={loading ? '…' : fmtCLP(stats?.avg)} />
        <Stat label="Mediana" value={loading ? '…' : fmtCLP(stats?.mediana)} />
        <Stat label="Mín" value={loading ? '…' : fmtCLP(stats?.min)} />
        <Stat label="Máx" value={loading ? '…' : fmtCLP(stats?.max)} />
        <Stat label="$ / m²" value={loading ? '…' : fmtCLP(stats?.precio_m2)} />
      </section>

      {/* Map */}
      <section className="relative flex-1">
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
        Raíces. Datos públicos y anonimizados. Base de datos única: Neon
        <code className="mx-1">transacciones-suelo</code>.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide opacity-50">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
