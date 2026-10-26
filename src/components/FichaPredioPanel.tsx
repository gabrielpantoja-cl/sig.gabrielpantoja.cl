'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { destinoLabel } from '@/lib/hexbins';
import { formatoDistancia, formatoSuperficie } from '@/lib/medicion';
import { comparablesACsv, fichaAGeoJson } from '@/lib/ficha-export';
import {
  PENDIENTE_CLASES,
  RELIEVE_ATTRIBUTION,
  RELIEVE_DESCARGO,
  RELIEVE_DESCARGO_LICENCIA,
} from '@/lib/relieve';
import {
  ANALISIS_PREDIO_URL,
  RADIO_DEFAULT_M,
  consultaFicha,
  validarPoligono,
  type FichaPredio,
  type PoligonoGeoJson,
  type Seccion,
} from '@/lib/analisis-predio';

const RADIOS_M = [1_000, 3_000, 5_000, 10_000, 20_000];

const ha = (v: number) => `${v.toLocaleString('es-CL', { maximumFractionDigits: v < 10 ? 2 : 1 })} ha`;
const pct = (v: number) => `${v.toLocaleString('es-CL', { maximumFractionDigits: v < 1 ? 2 : 0 })} %`;
const clp = (v: number | null) =>
  v === null ? '—' : `$${Math.round(v).toLocaleString('es-CL')}`;
/**
 * $/m² como lo lee un tasador: en suelo agrícola el número útil es $/ha. La
 * unidad la fija la mediana de la fila, así P25 y P75 se leen en la misma.
 */
const porHa = (mediana: number | null) => mediana !== null && mediana < 10_000;
const ppm2 = (v: number | null, enHa: boolean) =>
  v === null ? '—' : enHa ? `${clp(v * 10_000)}/ha` : `${clp(v)}/m²`;

function descargar(contenido: string, tipo: string, nombre: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fechaArchivo = () => new Date().toISOString().slice(0, 10);

type Resultado =
  | { clave: string; tipo: 'ok'; ficha: FichaPredio }
  | { clave: string; tipo: 'error'; mensaje: string };

function Estado({ seccion }: { seccion: Seccion<unknown> }) {
  if (seccion.estado === 'sin-capa') {
    return <p className="opacity-60">Capa aún no cargada en la base de análisis.</p>;
  }
  if (seccion.estado === 'error') {
    return <p className="text-red-800 dark:text-red-200">No se pudo consultar esta capa.</p>;
  }
  return null;
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-black/10 py-2 dark:border-white/10">
      <h3 className="mb-1 font-semibold">{titulo}</h3>
      {children}
    </div>
  );
}

/**
 * Ficha del predio: el resultado del geoproceso `/api/analisis/predio` sobre
 * el polígono que el usuario cerró con «Medir». Panel flotante como el de la
 * serie NDVI. Las cifras son referenciales (lo dice el pie): la superficie
 * legal es la del plano o el título, y los comparables son inscripciones, no
 * una tasación.
 */
export function FichaPredioPanel({
  geometry,
  origen,
  onFicha,
  onCerrar,
}: {
  geometry: PoligonoGeoJson;
  /** De dónde salió el polígono («Polígono dibujado», «KML · Lote 3»…). */
  origen: string;
  /** Ficha vigente (o null mientras carga), para dibujar los comparables en el mapa. */
  onFicha: (ficha: FichaPredio | null) => void;
  onCerrar: () => void;
}) {
  const [radioM, setRadioM] = useState(RADIO_DEFAULT_M);
  const [similar, setSimilar] = useState(false);
  // Superficie del predio ya en el navegador (la misma validación del servidor),
  // para pedir comparables de tamaño parecido sin esperar la primera respuesta.
  const superficieHa = useMemo(() => {
    const v = validarPoligono(geometry);
    return v.ok ? v.superficieHa : null;
  }, [geometry]);
  const qs = consultaFicha(radioM, similar ? superficieHa : null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const idTitulo = useId();
  const onFichaRef = useRef(onFicha);
  useEffect(() => {
    onFichaRef.current = onFicha;
  }, [onFicha]);

  const cuerpo = JSON.stringify({ geometry });
  const clave = `${qs}:${cuerpo}`;
  // Resultado de otra consulta = no vigente: «cargando» derivado, sin setState en el effect.
  const vigente = resultado !== null && resultado.clave === clave ? resultado : null;

  useEffect(() => {
    const controller = new AbortController();
    onFichaRef.current(null);
    (async () => {
      try {
        const res = await fetch(`${ANALISIS_PREDIO_URL}?${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cuerpo,
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const mensaje =
            res.status === 429
              ? 'Demasiados análisis seguidos: espera unos segundos y vuelve a intentar.'
              : typeof data?.error === 'string'
                ? data.error
                : 'No se pudo analizar el predio.';
          setResultado({ clave, tipo: 'error', mensaje });
          track('parcel_analysis', { ok: false });
          return;
        }
        setResultado({ clave, tipo: 'ok', ficha: data as FichaPredio });
        onFichaRef.current(data as FichaPredio);
        track('parcel_analysis', { ok: true });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        setResultado({ clave, tipo: 'error', mensaje: 'Sin conexión con el servidor de análisis.' });
      }
    })();
    return () => controller.abort();
  }, [clave, cuerpo, qs]);

  const ficha = vigente?.tipo === 'ok' ? vigente.ficha : null;

  return (
    <section
      aria-labelledby={idTitulo}
      className="rounded-lg border border-black/15 bg-[var(--background)]/95 p-3 text-xs shadow-lg backdrop-blur dark:border-white/20"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 id={idTitulo} className="text-[0.8rem] font-semibold leading-tight">Ficha del predio</h2>
          {origen && <p className="opacity-70">{origen}</p>}
          <p className="opacity-60">
            {ficha
              ? `${formatoSuperficie(ficha.superficieHa * 10_000)} · perímetro ${formatoDistancia(ficha.perimetroM)}`
              : 'Cruce del polígono con capas oficiales y transacciones CBR'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar la ficha del predio"
          className="rounded px-1.5 leading-none opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      </header>

      {vigente === null && (
        <p role="status" aria-live="polite" className="py-6 text-center opacity-70">
          Analizando el predio…
        </p>
      )}

      {vigente?.tipo === 'error' && (
        <p role="alert" className="rounded border border-red-500/35 bg-red-500/10 px-2 py-1.5 text-red-800 dark:text-red-200">
          {vigente.mensaje}
        </p>
      )}

      {ficha && (
        <>
          <Bloque titulo="Comuna">
            <Estado seccion={ficha.comunas} />
            {ficha.comunas.estado === 'ok' &&
              (ficha.comunas.datos.length === 0 ? (
                <p className="opacity-60">Fuera de los límites comunales (¿mar?).</p>
              ) : (
                <ul>
                  {ficha.comunas.datos.map((c) => (
                    <li key={c.cut ?? c.comuna}>
                      {c.comuna} <span className="opacity-60">({c.provincia}, {c.region})</span>
                      {ficha.comunas.estado === 'ok' && ficha.comunas.datos.length > 1 && (
                        <span className="tabular-nums"> · {ha(c.ha)} ({pct(c.pct)})</span>
                      )}
                    </li>
                  ))}
                </ul>
              ))}
          </Bloque>

          <Bloque titulo="Límite urbano (PRC)">
            <Estado seccion={ficha.limiteUrbano} />
            {ficha.limiteUrbano.estado === 'ok' &&
              (ficha.limiteUrbano.datos.instrumentos.length === 0 ? (
                <p>Fuera de todo límite urbano: suelo rural.</p>
              ) : (
                <>
                  <p className="tabular-nums">
                    {pct(ficha.limiteUrbano.datos.pct)} dentro ({ha(ficha.limiteUrbano.datos.ha)})
                  </p>
                  <ul className="opacity-70">
                    {ficha.limiteUrbano.datos.instrumentos.map((i, k) => (
                      <li key={k}>
                        {i.instrumento ?? 'Instrumento'} {i.nombre ?? ''}
                        {i.publicacionDo ? ` · D.O. ${i.publicacionDo}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              ))}
          </Bloque>

          <Bloque titulo="Áreas protegidas (RNAP)">
            <Estado seccion={ficha.areasProtegidas} />
            {ficha.areasProtegidas.estado === 'ok' &&
              (ficha.areasProtegidas.datos.areas.length > 0 ? (
                <ul>
                  {ficha.areasProtegidas.datos.areas.map((a, k) => (
                    <li key={a.codRnap ?? k}>
                      <strong>{a.nombre}</strong> <span className="opacity-60">({a.designacion})</span>
                      <span className="tabular-nums"> · {ha(a.ha)} ({pct(a.pct)})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  Ninguna toca el predio.
                  {ficha.areasProtegidas.datos.masCercana && (
                    <span className="opacity-70">
                      {' '}La más cercana: {ficha.areasProtegidas.datos.masCercana.nombre} (
                      {ficha.areasProtegidas.datos.masCercana.designacion}), a{' '}
                      {formatoDistancia(ficha.areasProtegidas.datos.masCercana.distanciaM)}.
                    </span>
                  )}
                </p>
              ))}
          </Bloque>

          <Bloque titulo="Relieve (Copernicus GLO-30)">
            {ficha.relieve.estado === 'error' && (
              <p className="text-red-800 dark:text-red-200">
                No se pudo leer el modelo de elevación a tiempo; vuelve a intentar en unos segundos.
              </p>
            )}
            {ficha.relieve.estado === 'ok' &&
              (ficha.relieve.datos === null ? (
                <p className="opacity-60">Sin datos de elevación: el predio es mar o más chico que una celda de 30 m.</p>
              ) : (
                <>
                  <p className="tabular-nums">
                    Pendiente media {pct(ficha.relieve.datos.pendienteMedia)} · mediana{' '}
                    {pct(ficha.relieve.datos.pendienteMediana)} · cota{' '}
                    {Math.round(ficha.relieve.datos.cotaMin).toLocaleString('es-CL')}–
                    {Math.round(ficha.relieve.datos.cotaMax).toLocaleString('es-CL')} m
                  </p>
                  <p className="tabular-nums">
                    ≥ 30 %: {pct(ficha.relieve.datos.pctSobre30)} ·{' '}
                    <span className={ficha.relieve.datos.pctSobre45 > 0 ? 'font-semibold text-red-800 dark:text-red-300' : ''}>
                      ≥ 45 %: {pct(ficha.relieve.datos.pctSobre45)}
                    </span>
                  </p>
                  {ficha.relieve.datos.pctSobre45 > 0 && (
                    <p className="opacity-70">
                      Sobre 45 % el bosque nativo es «de conservación y protección» (Ley 20.283, art. 2 N° 5).
                    </p>
                  )}
                  <div className="mt-1 flex h-2 overflow-hidden rounded" aria-hidden="true">
                    {ficha.relieve.datos.clases.map((c) => (
                      <span
                        key={c.clase}
                        style={{ width: `${c.pct}%`, background: PENDIENTE_CLASES.find((k) => k.clase === c.clase)?.color }}
                      />
                    ))}
                  </div>
                  <p className="mt-0.5 opacity-60">
                    {ficha.relieve.datos.clases
                      .filter((c) => c.pct >= 1)
                      .map((c) => `${c.clase} ${pct(c.pct)}`)
                      .join(' · ')}{' '}
                    (clases SAG, celda {Math.round(ficha.relieve.datos.resolucionM)} m)
                  </p>
                  <p className="mt-1 text-[0.65rem] opacity-50">
                    {RELIEVE_DESCARGO} {RELIEVE_ATTRIBUTION}. {RELIEVE_DESCARGO_LICENCIA}
                  </p>
                </>
              ))}
          </Bloque>

          <Bloque titulo="Transacciones CBR cercanas">
            <label className="mb-1 flex items-center gap-1.5">
              <span className="opacity-70">Radio</span>
              <select
                value={radioM}
                onChange={(e) => setRadioM(Number(e.target.value))}
                className="rounded border border-black/15 bg-transparent px-1 py-0.5 dark:border-white/20"
              >
                {RADIOS_M.map((r) => (
                  <option key={r} value={r}>{r / 1000} km</option>
                ))}
              </select>
            </label>
            {superficieHa !== null && (
              <label className="mb-1 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={similar}
                  onChange={(e) => setSimilar(e.target.checked)}
                  className="accent-[hsl(153_28%_35%)]"
                />
                <span>
                  Solo superficie similar{' '}
                  <span className="opacity-60">
                    ({ha(superficieHa / 2)} – {ha(superficieHa * 2)})
                  </span>
                </span>
              </label>
            )}
            <Estado seccion={ficha.comparables} />
            {ficha.comparables.estado === 'ok' &&
              (ficha.comparables.datos.total === 0 ? (
                <p className="opacity-60">Sin inscripciones geolocalizadas en el radio.</p>
              ) : (
                <>
                  <table className="w-full tabular-nums">
                    <thead className="text-left opacity-60">
                      <tr>
                        <th className="font-normal">Destino</th>
                        <th className="text-right font-normal">n</th>
                        <th className="text-right font-normal">Mediana</th>
                        <th className="text-right font-normal">P25–P75</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.comparables.datos.porDestino.slice(0, 6).map((d) => (
                        <tr key={d.destino ?? '?'}>
                          <td>{d.destino ? destinoLabel(d.destino) : 'Sin destino'}</td>
                          <td className="pl-2 text-right">{d.n.toLocaleString('es-CL')}</td>
                          <td className="pl-2 text-right">{ppm2(d.medianaPpm2, porHa(d.medianaPpm2))}</td>
                          <td className="pl-2 text-right opacity-70">
                            {d.p25Ppm2 === null
                              ? '—'
                              : `${ppm2(d.p25Ppm2, porHa(d.medianaPpm2))} – ${ppm2(d.p75Ppm2, porHa(d.medianaPpm2))}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 opacity-60">
                    {ficha.comparables.datos.total.toLocaleString('es-CL')} inscripciones a menos de{' '}
                    {formatoDistancia(ficha.comparables.datos.radioM)}; en el mapa, las{' '}
                    {ficha.comparables.datos.puntos.length} más cercanas. Medianas por destino SII: mezclarlos
                    no tiene sentido.
                  </p>
                </>
              ))}
          </Bloque>

          <div className="flex gap-2 border-t border-black/10 py-2 dark:border-white/10">
            <button
              type="button"
              onClick={() => {
                descargar(
                  JSON.stringify(fichaAGeoJson(geometry, ficha, origen)),
                  'application/geo+json',
                  `ficha-predio-${fechaArchivo()}.geojson`,
                );
                track('export_data', { format: 'ficha_geojson' });
              }}
              className="flex-1 rounded-md border border-black/15 px-2 py-1 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              title="Polígono con el resumen de la ficha y los comparables como puntos (QGIS, ArcGIS)"
            >
              GeoJSON
            </button>
            <button
              type="button"
              onClick={() => {
                descargar(comparablesACsv(ficha), 'text/csv;charset=utf-8', `comparables-${fechaArchivo()}.csv`);
                track('export_data', { format: 'ficha_csv' });
              }}
              disabled={ficha.comparables.estado !== 'ok' || ficha.comparables.datos.puntos.length === 0}
              className="flex-1 rounded-md border border-black/15 px-2 py-1 hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10"
              title="Los comparables más cercanos, para Excel"
            >
              CSV comparables
            </button>
          </div>

          <footer className="border-t border-black/10 pt-2 opacity-60 dark:border-white/10">
            <p>
              Análisis referencial sobre geometría oficial sin simplificar (WGS84, cálculo
              geodésico). La superficie legal es la del plano o el título; los comparables son
              inscripciones, no una tasación.
            </p>
            {ficha.fuentes.length > 0 && (
              <ul className="mt-1">
                {ficha.fuentes.map((f) => (
                  <li key={f.capa}>
                    {f.fuente}
                    {f.descargado ? ` (descarga ${f.descargado})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </footer>
        </>
      )}
    </section>
  );
}
