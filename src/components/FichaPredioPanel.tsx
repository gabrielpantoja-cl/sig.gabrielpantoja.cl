'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { destinoLabel } from '@/lib/hexbins';
import { formatoDistancia, formatoSuperficie } from '@/lib/medicion';
import {
  ANALISIS_PREDIO_URL,
  RADIO_DEFAULT_M,
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
  onFicha,
  onCerrar,
}: {
  geometry: PoligonoGeoJson;
  /** Ficha vigente (o null mientras carga), para dibujar los comparables en el mapa. */
  onFicha: (ficha: FichaPredio | null) => void;
  onCerrar: () => void;
}) {
  const [radioM, setRadioM] = useState(RADIO_DEFAULT_M);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const idTitulo = useId();
  const onFichaRef = useRef(onFicha);
  useEffect(() => {
    onFichaRef.current = onFicha;
  }, [onFicha]);

  const cuerpo = JSON.stringify({ geometry });
  const clave = `${radioM}:${cuerpo}`;
  // Resultado de otra consulta = no vigente: «cargando» derivado, sin setState en el effect.
  const vigente = resultado !== null && resultado.clave === clave ? resultado : null;

  useEffect(() => {
    const controller = new AbortController();
    onFichaRef.current(null);
    (async () => {
      try {
        const res = await fetch(`${ANALISIS_PREDIO_URL}?radio_m=${radioM}`, {
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
  }, [clave, cuerpo, radioM]);

  const ficha = vigente?.tipo === 'ok' ? vigente.ficha : null;

  return (
    <section
      aria-labelledby={idTitulo}
      className="rounded-lg border border-black/15 bg-[var(--background)]/95 p-3 text-xs shadow-lg backdrop-blur dark:border-white/20"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 id={idTitulo} className="text-[0.8rem] font-semibold leading-tight">Ficha del predio</h2>
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
