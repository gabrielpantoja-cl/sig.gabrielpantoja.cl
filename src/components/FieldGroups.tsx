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

/**
 * Panel de estadísticas. Jerarquía deliberada (ver docs/estadisticas.md):
 *
 *  1. La MEDIANA es el número grande. En esta base el promedio es ~5x la
 *     mediana porque 44 transacciones (0,05%) concentran el 59% de la masa
 *     monetaria; destacar el promedio daba una lectura irreal del mercado.
 *  2. Promedio / mín / máx quedan como secundarias, y el promedio lleva un
 *     distintivo cuando se aparta ≥2x de la mediana.
 *  3. Cada bloque declara SOBRE CUÁNTAS filas se calculó: los NULL de `monto`
 *     y de `superficieTerreno` hacen que los tres denominadores difieran.
 */
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
  const clp = (v: number | null | undefined) => (loading ? '…' : fmtCLP(v));

  const count = stats?.count ?? 0;
  const countMonto = stats?.count_monto ?? 0;
  const countM2 = stats?.count_precio_m2 ?? 0;

  // Asimetría promedio/mediana: por encima de 2x la media deja de describir al
  // conjunto y pasa a describir a sus outliers.
  const avg = stats?.avg ?? null;
  const mediana = stats?.mediana ?? null;
  const skew = avg != null && mediana != null && mediana !== 0 ? avg / mediana : null;
  const skewed = skew != null && (skew >= 2 || skew <= 0.5);

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Mediana: el estadístico robusto va primero y en grande. */}
      <div>
        <span className="text-xs uppercase tracking-wide opacity-50">Mediana del monto</span>
        <div className="text-xl font-semibold leading-tight tabular-nums">
          {clp(mediana)}
        </div>
        <Coverage
          loading={loading}
          text={`Valor central de ${fmtInt(countMonto)} de ${fmtInt(count)} transacciones con monto informado.`}
        />
      </div>

      {/* 2. Promedio y extremos: mismo denominador que la mediana. */}
      <dl className="flex flex-col gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
        <Row
          label="Promedio"
          value={clp(avg)}
          note={
            skewed && !loading
              ? `${skew.toLocaleString('es-CL', { maximumFractionDigits: 1 })}× la mediana`
              : null
          }
          noteTitle="El promedio se aparta de la mediana: unas pocas transacciones de monto extremo dominan el resultado. Usa la mediana como referencia."
        />
        <Row label="Mínimo" value={clp(stats?.min)} />
        <Row label="Máximo" value={clp(stats?.max)} />
      </dl>

      {/* 3. $/m²: denominador propio, y dos lecturas distintas del mismo dato. */}
      <div className="border-t border-black/10 pt-3 dark:border-white/10">
        {/* <dl> solo admite dt/dd/div, así que la nota va fuera de la lista. */}
        <dl className="flex flex-col gap-1.5">
          <Row
            label="$/m² típico"
            value={clp(stats?.precio_m2_mediana)}
            noteTitle="Mediana de monto/superficie calculada transacción por transacción."
          />
          <Row
            label="$/m² del conjunto"
            value={clp(stats?.precio_m2)}
            noteTitle="Suma de montos dividida por suma de superficies: pondera cada predio por su tamaño."
          />
        </dl>
        <Coverage
          loading={loading}
          text={
            countM2 === 0
              ? `Sin superficie de terreno informada en las ${fmtInt(count)} transacciones de la selección.`
              : `Calculado sobre ${fmtInt(countM2)} de ${fmtInt(count)} transacciones (${pct(countM2, count)}) con monto y superficie.`
          }
        />
      </div>
    </div>
  );
}

/** Porcentaje de cobertura con un decimal, en formato es-CL. */
function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${((part / total) * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })}%`;
}

/** Nota al pie que nombra el denominador real de las métricas de arriba. */
function Coverage({ loading, text }: { loading: boolean; text: string }) {
  return (
    <p className="mt-1 text-[0.7rem] leading-snug opacity-55">
      {loading ? 'Calculando…' : text}
    </p>
  );
}

/** Fila etiqueta → valor a todo el ancho: los montos CBR llegan a 15 dígitos
 *  y no caben en una grilla de dos columnas dentro del panel flotante. */
function Row({
  label,
  value,
  note,
  noteTitle,
}: {
  label: string;
  value: string;
  note?: string | null;
  noteTitle?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide opacity-50" title={noteTitle}>
        {label}
      </dt>
      <dd className="flex flex-wrap items-baseline justify-end gap-x-1.5 text-right text-sm font-medium tabular-nums">
        <span>{value}</span>
        {note && (
          <span
            title={noteTitle}
            className="rounded-sm bg-amber-500/15 px-1 py-px text-[0.65rem] font-normal tabular-nums text-amber-700 dark:text-amber-400"
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}
