'use client';

import type { Facets, Stats } from '@/lib/types';

/**
 * Grupos de campos presentacionales, sin estado propio. El estado vive en
 * page.tsx; estos componentes se renderizan dos veces: dentro de los paneles
 * flotantes de desktop y dentro del drawer consolidado de mobile, de modo que
 * cada control tenga una sola implementación.
 */

const inputClass =
  'h-9 rounded-md border border-black/15 bg-[var(--background)] px-2 text-[var(--foreground)] dark:border-white/20';

export function SearchFields({
  predio,
  setPredio,
  rol,
  setRol,
}: {
  predio: string;
  setPredio: (v: string) => void;
  rol: string;
  setRol: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Predio</span>
        <input
          type="text"
          placeholder="nombre del predio"
          value={predio}
          onChange={(e) => setPredio(e.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">ROL</span>
        <input
          type="text"
          placeholder="ej. 123-45"
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>
    </div>
  );
}

export function FilterFields({
  comuna,
  setComuna,
  facets,
  setAnioFrom,
  effectiveAnioFrom,
  montoMin,
  setMontoMin,
  montoMax,
  setMontoMax,
  supMin,
  setSupMin,
  supMax,
  setSupMax,
  exportHref,
}: {
  comuna: string;
  setComuna: (v: string) => void;
  facets: Facets | null;
  setAnioFrom: (v: number) => void;
  effectiveAnioFrom: number;
  montoMin: string;
  setMontoMin: (v: string) => void;
  montoMax: string;
  setMontoMax: (v: string) => void;
  supMin: string;
  setSupMin: (v: string) => void;
  supMax: string;
  setSupMax: (v: string) => void;
  exportHref: (format: 'csv' | 'geojson') => string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Comuna</span>
        <select
          value={comuna}
          onChange={(e) => setComuna(e.target.value)}
          className={`${inputClass} w-full`}
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
          className="w-full"
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
            className={`${inputClass} min-w-0 flex-1`}
          />
          <span className="opacity-50">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="máx"
            value={montoMax}
            onChange={(e) => setMontoMax(e.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
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
            className={`${inputClass} min-w-0 flex-1`}
          />
          <span className="opacity-50">–</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="máx"
            value={supMax}
            onChange={(e) => setSupMax(e.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
          />
        </div>
      </label>

      <div className="flex items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
        <span className="text-xs opacity-60">Exportar:</span>
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
    </div>
  );
}

export function StatsFields({
  loading,
  stats,
  fmtCLP,
  fmtInt,
}: {
  loading: boolean;
  stats: Stats | null;
  fmtCLP: (v: number | null | undefined) => string;
  fmtInt: (v: number) => string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Stat label="Transacciones" value={loading ? '…' : fmtInt(stats?.count ?? 0)} />
      <Stat label="Promedio" value={loading ? '…' : fmtCLP(stats?.avg)} />
      <Stat label="Mediana" value={loading ? '…' : fmtCLP(stats?.mediana)} />
      <Stat label="Mín" value={loading ? '…' : fmtCLP(stats?.min)} />
      <Stat label="Máx" value={loading ? '…' : fmtCLP(stats?.max)} />
      <Stat label="$ / m²" value={loading ? '…' : fmtCLP(stats?.precio_m2)} />
    </div>
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
