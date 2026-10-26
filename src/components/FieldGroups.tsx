'use client';

import { useState } from 'react';
import type { Facets, Stats } from '@/lib/types';
import { normalizePropiedadRuralRol, type PropiedadRuralSearchMatch } from '@/lib/propiedades-rurales';
import { track } from '@/lib/analytics';
import {
  alternarAnio,
  anioEnRango,
  aniosDisponibles,
  cambiarExtremo,
  etiquetaAnios,
  hayFiltroAnios,
  totalEnRango,
  type AnioConteo,
  type RangoAnios,
} from '@/lib/anios';
import { alternarDestino, destinosDisponibles } from '@/lib/destinos';
import { destinoLabel } from '@/lib/hexbins';

/**
 * Grupos de campos presentacionales, sin estado propio. El estado vive en
 * page.tsx; estos componentes se renderizan dos veces: dentro de los paneles
 * flotantes de desktop y dentro del drawer consolidado de mobile, de modo que
 * cada control tenga una sola implementación.
 */

const inputClass =
  'h-9 rounded-md border border-black/15 bg-[var(--background)] px-2 text-[var(--foreground)] dark:border-white/20';

export type RuralRolSearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'selecting'; results: PropiedadRuralSearchMatch[]; selectedId: string }
  | { kind: 'results'; results: PropiedadRuralSearchMatch[]; truncated: boolean }
  | { kind: 'error'; message: string };

export function SearchFields({
  predio,
  setPredio,
  rol,
  setRol,
  ruralRolSearch,
  onLocateRuralRol,
  onSelectRuralMatch,
  onClearRuralSearch,
  onAnalizarRural,
}: {
  predio: string;
  setPredio: (v: string) => void;
  rol: string;
  setRol: (v: string) => void;
  ruralRolSearch: RuralRolSearchState;
  onLocateRuralRol: () => void;
  onSelectRuralMatch: (match: PropiedadRuralSearchMatch) => void;
  onClearRuralSearch: () => void;
  /** Presente cuando hay un predio CIREN elegido: abre su ficha del predio. */
  onAnalizarRural?: () => void;
}) {
  const normalizedRol = normalizePropiedadRuralRol(rol);
  const busy = ruralRolSearch.kind === 'loading' || ruralRolSearch.kind === 'selecting';
  const results = ruralRolSearch.kind === 'results' || ruralRolSearch.kind === 'selecting'
    ? ruralRolSearch.results
    : [];
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
        <span className="font-medium">ROL en transacciones CBR</span>
        <input
          type="text"
          placeholder="ej. 123-45"
          value={rol}
          onChange={(e) => setRol(e.target.value)}
          className={`${inputClass} w-full`}
        />
      </label>
      <div className="-mt-2 space-y-2">
        <p className="text-[0.68rem] leading-snug opacity-55">
          El texto filtra las transacciones por coincidencia parcial. Con un ROL completo puedes
          ubicar el polígono rural publicado por CIREN.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onLocateRuralRol}
            disabled={!normalizedRol || busy}
            aria-busy={busy}
            className="flex-1 rounded-md border border-[hsl(153_28%_35%)] px-2 py-1.5 text-xs font-medium text-[hsl(153_28%_28%)] hover:bg-[hsl(153_28%_35%)]/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-[hsl(153_35%_70%)]"
          >
            {ruralRolSearch.kind === 'loading' ? 'Buscando en CIREN…' : 'Ubicar predio CIREN'}
          </button>
          {ruralRolSearch.kind !== 'idle' && (
            <button type="button" onClick={onClearRuralSearch} className="rounded-md border border-black/15 px-2 py-1.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
              Limpiar
            </button>
          )}
        </div>
        {onAnalizarRural && (
          <button
            type="button"
            onClick={onAnalizarRural}
            className="w-full rounded-md border border-[hsl(153_28%_35%)] bg-[hsl(153_28%_35%)] px-2 py-1.5 text-xs font-medium text-white"
          >
            Analizar este predio
          </button>
        )}
        <div aria-live="polite">
          {rol.trim() && !normalizedRol && (
            <p className="text-[0.68rem] text-amber-700 dark:text-amber-300">Para CIREN usa un ROL completo, por ejemplo 123-45.</p>
          )}
          {ruralRolSearch.kind === 'error' && <p role="alert" className="text-[0.68rem] text-red-700 dark:text-red-300">{ruralRolSearch.message}</p>}
          {ruralRolSearch.kind === 'results' && results.length === 0 && (
            <p className="text-[0.68rem] opacity-60">Sin coincidencias exactas en la cobertura rural CIREN.</p>
          )}
          {results.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[0.68rem] opacity-60">
                {results.length === 1 ? '1 coincidencia' : `${results.length} coincidencias`}. Selecciona el predio:
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {results.map((match) => (
                  <li key={match.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRuralMatch(match)}
                      disabled={busy}
                      className="w-full rounded border border-black/10 px-2 py-1.5 text-left text-[0.68rem] hover:bg-black/5 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10"
                    >
                      <span className="font-semibold">ROL {match.rol}</span>
                      <span className="block opacity-65">{match.comuna ?? 'Comuna no informada'} · {match.sourceRegion} · CIREN {match.vintage}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {ruralRolSearch.kind === 'results' && ruralRolSearch.truncated && (
                <p className="text-[0.65rem] text-amber-700 dark:text-amber-300">La fuente devolvió más coincidencias; usa también el filtro de comuna para priorizar la correcta.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FilterFields({
  comuna,
  setComuna,
  facets,
  rangoAnios,
  setRangoAnios,
  fechaDesde,
  setFechaDesde,
  fechaHasta,
  setFechaHasta,
  montoMin,
  setMontoMin,
  montoMax,
  setMontoMax,
  supMin,
  setSupMin,
  supMax,
  setSupMax,
  destinos,
  setDestinos,
  exportHref,
  activeCount,
  onClear,
}: {
  comuna: string;
  setComuna: (v: string) => void;
  facets: Facets | null;
  rangoAnios: RangoAnios;
  setRangoAnios: (r: RangoAnios) => void;
  fechaDesde: string;
  setFechaDesde: (v: string) => void;
  fechaHasta: string;
  setFechaHasta: (v: string) => void;
  montoMin: string;
  setMontoMin: (v: string) => void;
  montoMax: string;
  setMontoMax: (v: string) => void;
  supMin: string;
  setSupMin: (v: string) => void;
  supMax: string;
  setSupMax: (v: string) => void;
  destinos: string[];
  setDestinos: (v: string[]) => void;
  exportHref: (format: 'csv' | 'geojson') => string;
  /** Filtros activos (mismo conteo que el distintivo del botón «Filtros»). */
  activeCount: number;
  /** Vuelve todos los filtros a su valor por defecto; no toca predio ni ROL. */
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {activeCount > 0 && (
        <div className="-mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="opacity-60">
            {activeCount === 1 ? '1 filtro activo' : `${activeCount} filtros activos`}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-black/15 px-2 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Limpiar filtros
          </button>
        </div>
      )}
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

      <YearRangeField
        comuna={comuna}
        anios={aniosDisponibles(facets?.anios, comuna)}
        loading={!facets}
        rango={rangoAnios}
        onChange={setRangoAnios}
      />

      <details className="group text-sm" open={Boolean(fechaDesde || fechaHasta) || undefined}>
        <summary className="cursor-pointer select-none text-xs opacity-70 hover:opacity-100">
          Fechas exactas{fechaDesde || fechaHasta ? ' · activas' : ''}
        </summary>
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-xs opacity-60">Escritura; si falta, inscripción. Se combinan con los años.</p>
          <div className="flex items-center gap-1">
            <input
              type="date"
              aria-label="Fecha disponible desde"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <span className="opacity-50">–</span>
            <input
              type="date"
              aria-label="Fecha disponible hasta"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className={`${inputClass} min-w-0 flex-1`}
            />
          </div>
        </div>
      </details>

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

      <DestinoField
        opciones={destinosDisponibles(facets?.destinos, comuna)}
        loading={!facets}
        seleccion={destinos}
        onChange={setDestinos}
      />

      <div className="flex items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
        <span className="text-xs opacity-60">Exportar:</span>
        <a
          href={exportHref('csv')}
          onClick={() => track('export_data', { format: 'csv' })}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          CSV
        </a>
        <a
          href={exportHref('geojson')}
          onClick={() => track('export_data', { format: 'geojson' })}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
        >
          GeoJSON
        </a>
      </div>
    </div>
  );
}

const fmtN = (v: number): string => v.toLocaleString('es-CL');


/**
 * Selección múltiple de destinos SII (`destinos=`). Las opciones son las de
 * la comuna elegida, con su conteo, y solo las presentes: un código sin
 * transacciones no filtra nada útil. Ninguno marcado = todos los destinos.
 *
 * Existe porque la mediana mezclaba sitios eriazos, viviendas y predios
 * agrícolas (Coyhaique: 6.716 W, 6.465 H, 2.066 A). Un destino elegido que no
 * existe en la comuna nueva se sigue mostrando, para poder desmarcarlo.
 */
function DestinoField({
  opciones,
  loading,
  seleccion,
  onChange,
}: {
  opciones: { code: string; n: number }[];
  loading: boolean;
  seleccion: string[];
  onChange: (v: string[]) => void;
}) {
  const huerfanos = seleccion
    .filter((code) => !opciones.some((o) => o.code === code))
    .map((code) => ({ code, n: 0 }));
  const lista = [...opciones, ...huerfanos];
  const activo = seleccion.length > 0;
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 flex w-full items-center justify-between gap-2 font-medium">
        <span>
          Destino SII
          {activo && <span className="font-normal opacity-70">: {seleccion.join(', ')}</span>}
        </span>
        {activo && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-normal underline opacity-70 hover:opacity-100"
          >
            Todos
          </button>
        )}
      </legend>
      {loading ? (
        <p className="text-xs opacity-60">Cargando destinos…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs opacity-60">Sin destinos registrados en esta comuna.</p>
      ) : (
        <div className="flex max-h-36 flex-col gap-0.5 overflow-y-auto pr-1">
          {lista.map(({ code, n }) => (
            <label key={code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-black/5 dark:hover:bg-white/10">
              <input
                type="checkbox"
                checked={seleccion.includes(code)}
                onChange={() => onChange(alternarDestino(seleccion, code))}
              />
              <span className="min-w-0 flex-1 truncate">{destinoLabel(code)}</span>
              <span className="text-xs tabular-nums opacity-60">{n.toLocaleString('es-CL')}</span>
            </label>
          ))}
        </div>
      )}
      <p className="text-xs opacity-60">Ninguno marcado = todos. La mediana no mezcla bien eriazos, viviendas y predios agrícolas.</p>
    </fieldset>
  );
}
/**
 * Años de la fecha disponible como rango «desde–hasta». El histograma es el de
 * la comuna elegida (conteos de `facets.anios`): clic en una barra deja ese
 * único año, otro clic lo quita y Mayús+clic extiende el rango. Los selectores
 * hacen lo mismo con teclado y lector de pantalla. «Todos» en un extremo es
 * «sin límite», nunca el año mínimo de la base.
 */
function YearRangeField({
  comuna,
  anios,
  loading,
  rango,
  onChange,
}: {
  comuna: string;
  anios: AnioConteo[];
  loading: boolean;
  rango: RangoAnios;
  onChange: (r: RangoAnios) => void;
}) {
  // Un año del enlace que la comuna no tiene sigue siendo elegible: si no
  // estuviera entre las opciones, el selector mostraría otro valor.
  const opciones = [...new Set([...anios.map((a) => a.anio), rango.desde, rango.hasta])]
    .filter((a): a is number => a != null)
    .sort((a, b) => a - b);
  const conteo = new Map(anios.map((a) => [a.anio, a.n]));
  // Raíz cuadrada: en el país 2025 tiene 40× más filas que cualquier otro año
  // y en escala lineal el resto de las barras desaparecía.
  const maxRaiz = Math.sqrt(Math.max(1, ...anios.map((a) => a.n)));
  const activo = hayFiltroAnios(rango);
  const enRango = totalEnRango(anios, rango);
  const lugar = comuna === 'todas' ? 'en el país' : `en ${comuna}`;
  const etiqueta = (a: number) => (conteo.has(a) ? `${a} (${fmtN(conteo.get(a)!)})` : `${a} (0)`);

  return (
    <fieldset className="flex flex-col gap-1.5 text-sm">
      <legend className="font-medium">
        Años{activo && <span className="font-normal opacity-70">: {etiquetaAnios(rango)}</span>}
      </legend>
      <p className="text-xs opacity-60">Año de la escritura; si falta, de la inscripción.</p>

      {anios.length > 0 ? (
        <div
          className="flex h-12 items-end gap-px"
          role="group"
          aria-label={`Transacciones por año ${lugar}. Clic en un año para filtrarlo; Mayús+clic extiende el rango.`}
        >
          {anios.map((a) => {
            const dentro = anioEnRango(rango, a.anio);
            return (
              <button
                key={a.anio}
                type="button"
                onClick={(e) => onChange(alternarAnio(rango, a.anio, e.shiftKey))}
                aria-pressed={activo && dentro}
                aria-label={`${a.anio}: ${fmtN(a.n)} transacciones`}
                title={`${a.anio}: ${fmtN(a.n)} transacciones`}
                className="group/bar flex h-full min-w-0 flex-1 items-end rounded-sm hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(153_28%_35%)] dark:hover:bg-white/10"
              >
                <span
                  className={`block w-full rounded-t-sm ${
                    activo && !dentro
                      ? 'bg-black/15 dark:bg-white/15'
                      : 'bg-[hsl(153_28%_35%)] dark:bg-[hsl(153_35%_60%)]'
                  }`}
                  style={{ height: `${Math.max(6, (Math.sqrt(a.n) / maxRaiz) * 100)}%` }}
                />
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs opacity-60">{loading ? 'Cargando años…' : `Sin transacciones fechadas ${lugar}.`}</p>
      )}
      {anios.length > 0 && (
        <div className="flex justify-between text-[0.65rem] tabular-nums opacity-60" aria-hidden>
          <span>{anios[0].anio}</span>
          <span>{anios[anios.length - 1].anio}</span>
        </div>
      )}

      <div className="flex items-center gap-1">
        <select
          aria-label="Año desde"
          value={rango.desde ?? ''}
          onChange={(e) => onChange(cambiarExtremo(rango, 'desde', e.target.value ? Number(e.target.value) : null))}
          disabled={loading}
          className={`${inputClass} min-w-0 flex-1`}
        >
          <option value="">Desde: todos</option>
          {opciones.map((a) => (
            <option key={a} value={a}>{etiqueta(a)}</option>
          ))}
        </select>
        <span className="opacity-50">–</span>
        <select
          aria-label="Año hasta"
          value={rango.hasta ?? ''}
          onChange={(e) => onChange(cambiarExtremo(rango, 'hasta', e.target.value ? Number(e.target.value) : null))}
          disabled={loading}
          className={`${inputClass} min-w-0 flex-1`}
        >
          <option value="">Hasta: todos</option>
          {opciones.map((a) => (
            <option key={a} value={a}>{etiqueta(a)}</option>
          ))}
        </select>
      </div>

      <div className="flex min-h-5 items-center justify-between gap-2 text-xs" aria-live="polite">
        <span className="opacity-60">
          {anios.length > 0 && activo
            ? `${fmtN(enRango)} transacciones ${lugar} en ${etiquetaAnios(rango)}`
            : anios.length > 0
              ? `${anios[0].anio}–${anios[anios.length - 1].anio}, todos los años`
              : ''}
        </span>
        {activo && (
          <button
            type="button"
            onClick={() => onChange({ desde: null, hasta: null })}
            className="shrink-0 rounded px-1.5 py-0.5 underline-offset-2 hover:underline"
          >
            Todos los años
          </button>
        )}
      </div>
    </fieldset>
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
 *  4. La UF es la unidad por defecto: la trae el 92,7 % de la base (los pesos,
 *     el 79,5 %) y es la que compara años. «Pesos» queda como referencia; cada
 *     unidad usa su propia columna y su propio denominador, sin convertir.
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
  const [unidad, setUnidad] = useState<'uf' | 'clp'>('uf');
  const enUf = unidad === 'uf';
  const fmt = enUf ? fmtUF : fmtCLP;
  const money = (v: number | null | undefined) => (loading ? '…' : fmt(v));
  const porM2 = enUf ? 'UF/m²' : '$/m²';

  const count = stats?.count ?? 0;
  const countMonto = (enUf ? stats?.count_uf : stats?.count_monto) ?? 0;
  const countM2 = (enUf ? stats?.count_uf_m2 : stats?.count_precio_m2) ?? 0;

  // Asimetría promedio/mediana: por encima de 2x la media deja de describir al
  // conjunto y pasa a describir a sus outliers.
  const avg = (enUf ? stats?.avg_uf : stats?.avg) ?? null;
  const mediana = (enUf ? stats?.mediana_uf : stats?.mediana) ?? null;
  const skew = avg != null && mediana != null && mediana !== 0 ? avg / mediana : null;
  const skewed = skew != null && (skew >= 2 || skew <= 0.5);

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Unidad de los montos" className="flex self-start rounded-md border border-black/15 p-0.5 text-xs dark:border-white/20">
        {(['uf', 'clp'] as const).map((u) => (
          <button
            key={u}
            type="button"
            aria-pressed={unidad === u}
            onClick={() => setUnidad(u)}
            className={`rounded px-2 py-0.5 ${unidad === u ? 'bg-black/10 font-medium dark:bg-white/15' : 'opacity-60 hover:opacity-100'}`}
          >
            {u === 'uf' ? 'UF' : 'Pesos'}
          </button>
        ))}
      </div>

      {/* 1. Mediana: el estadístico robusto va primero y en grande. */}
      <div>
        <span className="text-xs uppercase tracking-wide opacity-50">Mediana del monto</span>
        <div className="text-xl font-semibold leading-tight tabular-nums">
          {money(mediana)}
        </div>
        <Coverage
          loading={loading}
          text={`Valor central de ${fmtInt(countMonto)} de ${fmtInt(count)} transacciones con monto en ${enUf ? 'UF' : 'pesos'} informado.`}
        />
      </div>

      {/* 2. Promedio y extremos: mismo denominador que la mediana. */}
      <dl className="flex flex-col gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
        <Row
          label="Promedio"
          value={money(avg)}
          note={
            skewed && !loading
              ? `${skew.toLocaleString('es-CL', { maximumFractionDigits: 1 })}× la mediana`
              : null
          }
          noteTitle="El promedio se aparta de la mediana: unas pocas transacciones de monto extremo dominan el resultado. Usa la mediana como referencia."
        />
        <Row label="Mínimo" value={money(enUf ? stats?.min_uf : stats?.min)} />
        <Row label="Máximo" value={money(enUf ? stats?.max_uf : stats?.max)} />
      </dl>

      {/* 3. Valor por m²: denominador propio, y dos lecturas distintas del mismo dato. */}
      <div className="border-t border-black/10 pt-3 dark:border-white/10">
        {/* <dl> solo admite dt/dd/div, así que la nota va fuera de la lista. */}
        <dl className="flex flex-col gap-1.5">
          <Row
            label={`${porM2} típico`}
            value={money(enUf ? stats?.uf_m2_mediana : stats?.precio_m2_mediana)}
            noteTitle="Mediana de monto/superficie calculada transacción por transacción."
          />
          <Row
            label={`${porM2} del conjunto`}
            value={money(enUf ? stats?.uf_m2 : stats?.precio_m2)}
            noteTitle="Suma de montos dividida por suma de superficies: pondera cada predio por su tamaño."
          />
        </dl>
        <Coverage
          loading={loading}
          text={
            countM2 === 0
              ? `Sin monto en ${enUf ? 'UF' : 'pesos'} y superficie de terreno en las ${fmtInt(count)} transacciones de la selección.`
              : `Calculado sobre ${fmtInt(countM2)} de ${fmtInt(count)} transacciones (${pct(countM2, count)}) con monto y superficie.`
          }
        />
      </div>
    </div>
  );
}

/**
 * Monto en UF en formato es-CL. Los decimales dependen de la magnitud: un
 * valor por m² rural ronda 0,05 UF y con cero decimales se leería «UF 0».
 */
function fmtUF(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  return `UF ${v.toLocaleString('es-CL', { maximumFractionDigits: digits })}`;
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
