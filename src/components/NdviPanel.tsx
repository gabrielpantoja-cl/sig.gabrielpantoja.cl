'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  NDVI_DESCARGO,
  NDVI_FUENTE_URL,
  NDVI_RADIO_DEFECTO,
  NDVI_SOL_BAJO,
  ndviAtribucion,
  redondearCoordenada,
  type NdviMes,
  type NdviSerie,
} from '@/lib/ndvi';
import { MESES_CORTOS, anioPorDefecto, colorDeAnio, layoutGrafico } from '@/lib/ndvi-grafico';
import { VEGETACIONAL_IDENTIFY_URL, type VegetacionalProps } from '@/lib/vegetacional';

/** Lo que el usuario eligió consultar. */
export type NdviConsulta =
  | { tipo: 'punto'; lat: number; lng: number }
  | { tipo: 'poligono'; anillos: number[][][]; nombre: string };

type Estado =
  | { tipo: 'cargando'; desde: number }
  | { tipo: 'listo'; serie: NdviSerie }
  | { tipo: 'error'; mensaje: string };

const ANCHO = 440;
const ALTO = 190;

function usarTemaOscuro(): boolean {
  const [oscuro, setOscuro] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const aplicar = () => setOscuro(media.matches);
    aplicar();
    media.addEventListener('change', aplicar);
    return () => media.removeEventListener('change', aplicar);
  }, []);
  return oscuro;
}

const pct = (v: number | null) => (v === null ? '—' : `${v} %`);
const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(2).replace('.', ','));

function textoEstado(m: NdviMes): string {
  switch (m.estado) {
    case 'ok':
      return `${fmt(m.mediana)} (P25–P75 ${fmt(m.p25)}–${fmt(m.p75)})`;
    case 'hueco':
      return m.descartado !== null
        ? `sin dato: ${m.descartado} % del área cubierta en la mejor escena`
        : 'sin dato: ninguna escena legible';
    case 'sin-escenas':
      return 'sin dato: no hubo pasadas utilizables';
    case 'tiempo':
      return 'sin procesar: la consulta excedió su tiempo';
  }
}

export function NdviPanel({
  consulta,
  mostrarConaf,
  onSerie,
  onCerrar,
}: {
  consulta: NdviConsulta;
  /** Si la capa de Recursos vegetacionales está encendida, se consulta su clase
   *  en el punto (o en el centro del polígono) para leerla junto a la curva. */
  mostrarConaf: boolean;
  /** Serie vigente, para que el export PNG pueda incluir el gráfico. */
  onSerie: (serie: NdviSerie | null) => void;
  onCerrar: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando', desde: Date.now() });
  const [resaltado, setResaltado] = useState<number | null>(null);
  const [mesHover, setMesHover] = useState<number | null>(null);
  const [verTabla, setVerTabla] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [conaf, setConaf] = useState<VegetacionalProps | null | 'sin-clase'>(null);
  const oscuro = usarTemaOscuro();
  const tema = oscuro ? 'oscuro' : 'claro';
  const idTitulo = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const onSerieRef = useRef(onSerie);
  onSerieRef.current = onSerie;

  const clave = consulta.tipo === 'punto'
    ? `p:${redondearCoordenada(consulta.lat)},${redondearCoordenada(consulta.lng)}`
    : `g:${JSON.stringify(consulta.anillos)}`;

  useEffect(() => {
    const controller = new AbortController();
    const desde = Date.now();
    setEstado({ tipo: 'cargando', desde });
    setResaltado(null);
    onSerieRef.current(null);
    (async () => {
      try {
        const res = consulta.tipo === 'punto'
          ? await fetch(
              `/api/ndvi/serie?lat=${redondearCoordenada(consulta.lat)}&lng=${redondearCoordenada(consulta.lng)}&radio=${NDVI_RADIO_DEFECTO}`,
              { signal: controller.signal },
            )
          : await fetch('/api/ndvi/serie', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ anillos: consulta.anillos }),
              signal: controller.signal,
            });
        const json = await res.json();
        if (!res.ok) {
          setEstado({ tipo: 'error', mensaje: json?.error?.mensaje ?? `Error ${res.status}` });
          return;
        }
        const serie = json as NdviSerie;
        setEstado({ tipo: 'listo', serie });
        setResaltado(anioPorDefecto(serie));
        onSerieRef.current(serie);
      } catch {
        if (!controller.signal.aborted) {
          setEstado({ tipo: 'error', mensaje: 'No se pudo contactar al servidor.' });
        }
      }
    })();
    return () => controller.abort();
    // `clave` resume la consulta; los objetos cambian de identidad en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Contador visible mientras carga: la consulta tarda decenas de segundos y
  // un spinner sin tiempo parece colgado.
  useEffect(() => {
    if (estado.tipo !== 'cargando') return;
    const id = setInterval(() => setSegundos(Math.round((Date.now() - estado.desde) / 1000)), 1000);
    return () => clearInterval(id);
  }, [estado]);

  useEffect(() => {
    if (!mostrarConaf) {
      setConaf(null);
      return;
    }
    const controller = new AbortController();
    let lat: number;
    let lng: number;
    if (consulta.tipo === 'punto') {
      ({ lat, lng } = consulta);
    } else {
      const anillo = consulta.anillos[0];
      lng = anillo.reduce((s, v) => s + v[0], 0) / anillo.length;
      lat = anillo.reduce((s, v) => s + v[1], 0) / anillo.length;
    }
    const d = 0.005;
    const params = new URLSearchParams({
      geometry: `${lng},${lat}`,
      mapExtent: [lng - d, lat - d, lng + d, lat + d].join(','),
      imageDisplay: '400,400,96',
      tolerance: '1',
    });
    fetch(`${VEGETACIONAL_IDENTIFY_URL}?${params}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { results?: { attributes: VegetacionalProps }[] } | null) => {
        setConaf(data?.results?.[0]?.attributes ?? 'sin-clase');
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, mostrarConaf]);

  const serie = estado.tipo === 'listo' ? estado.serie : null;
  const layout = useMemo(() => (serie ? layoutGrafico(serie, ANCHO, ALTO) : null), [serie]);
  const serieResaltada = layout?.series.find((s) => s.anio === resaltado) ?? null;
  const solBajo = serieResaltada?.puntos.some((p) => (p.mes.elevacionSol ?? 90) < NDVI_SOL_BAJO) ?? false;

  const titulo = consulta.tipo === 'punto'
    ? `NDVI · punto ${consulta.lat.toFixed(4)}, ${consulta.lng.toFixed(4)} (radio ${NDVI_RADIO_DEFECTO} m)`
    : `NDVI · ${consulta.nombre}`;

  const alMover = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!layout || !svgRef.current) return;
    const caja = svgRef.current.getBoundingClientRect();
    const x = ((event.clientX - caja.left) / caja.width) * ANCHO;
    const i = Math.floor(((x - layout.area.izq) / (layout.area.der - layout.area.izq)) * 12);
    setMesHover(i >= 0 && i < 12 ? i : null);
  };

  return (
    <section
      aria-labelledby={idTitulo}
      className="rounded-lg border border-black/15 bg-[var(--background)]/95 p-3 text-xs shadow-lg backdrop-blur dark:border-white/20"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 id={idTitulo} className="text-[0.8rem] font-semibold leading-tight">{titulo}</h2>
          <p className="opacity-60">Sentinel-2 L2A · mediana mensual de 36 meses</p>
        </div>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar serie NDVI"
          className="rounded px-1.5 leading-none opacity-50 hover:opacity-100"
        >
          ✕
        </button>
      </header>

      {estado.tipo === 'cargando' && (
        <p role="status" aria-live="polite" className="py-6 text-center opacity-70">
          Leyendo 36 meses de imágenes Sentinel-2… {segundos} s
          <br />
          <span className="opacity-70">Suele tardar entre 20 y 45 s la primera vez; después queda en caché.</span>
        </p>
      )}

      {estado.tipo === 'error' && (
        <p role="alert" className="rounded border border-red-500/35 bg-red-500/10 px-2 py-1.5 text-red-800 dark:text-red-200">
          {estado.mensaje}
        </p>
      )}

      {serie && layout && (
        <>
          <div className="mb-1 flex flex-wrap items-center gap-1.5" role="group" aria-label="Años de la serie">
            {layout.series.map((s) => (
              <button
                key={s.anio}
                type="button"
                onClick={() => setResaltado(s.anio)}
                aria-pressed={resaltado === s.anio}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                  resaltado === s.anio ? 'border-current font-semibold' : 'border-black/15 opacity-75 dark:border-white/20'
                }`}
              >
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: colorDeAnio(s.anio, tema) }} />
                {s.anio}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setVerTabla((v) => !v)}
              aria-pressed={verTabla}
              className="ml-auto underline opacity-70 hover:opacity-100"
            >
              {verTabla ? 'Ver gráfico' : 'Ver tabla'}
            </button>
          </div>

          {!verTabla && (
            <div className="relative">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${ANCHO} ${ALTO}`}
                className="block w-full"
                role="img"
                aria-label={`Curva mensual de NDVI por año. ${serie.resumen.conDato} de 36 meses con dato. Usa «Ver tabla» para los valores.`}
                onPointerMove={alMover}
                onPointerLeave={() => setMesHover(null)}
              >
                {layout.ticksY.map((t) => (
                  <g key={t.valor}>
                    <line x1={layout.area.izq} x2={layout.area.der} y1={t.y} y2={t.y} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} />
                    <text x={layout.area.izq - 5} y={t.y + 3} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                      {t.valor.toFixed(2).replace('.', ',')}
                    </text>
                  </g>
                ))}
                {layout.ticksX.map((t) => (
                  <text key={t.etiqueta} x={t.x} y={ALTO - 8} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.6}>
                    {t.etiqueta}
                  </text>
                ))}

                {serieResaltada?.bandas.map((b, i) => (
                  <polygon key={i} points={b} fill={colorDeAnio(serieResaltada.anio, tema)} fillOpacity={0.12} />
                ))}

                {mesHover !== null && (
                  <line x1={layout.xDeMes(mesHover)} x2={layout.xDeMes(mesHover)} y1={layout.area.arr} y2={layout.area.aba} stroke="currentColor" strokeOpacity={0.3} strokeWidth={1} />
                )}

                {layout.series.map((s) => {
                  const color = colorDeAnio(s.anio, tema);
                  const atenuada = resaltado !== null && resaltado !== s.anio;
                  return (
                    <g key={s.anio} opacity={atenuada ? 0.45 : 1}>
                      {s.tramos.map((t, i) =>
                        t.length > 1 ? (
                          <polyline key={i} points={t.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                        ) : null,
                      )}
                      {s.puntos.map((p) => {
                        const bajo = (p.mes.elevacionSol ?? 90) < NDVI_SOL_BAJO;
                        return (
                          <circle
                            key={p.mes.mes}
                            cx={p.x}
                            cy={p.y}
                            r={4}
                            // Sol bajo: marcador hueco. La lectura existe, pero
                            // corresponde solo a copas iluminadas.
                            fill={bajo ? 'var(--background)' : color}
                            stroke={bajo ? color : 'var(--background)'}
                            strokeWidth={2}
                          />
                        );
                      })}
                      {s.etiqueta && (
                        <text x={s.etiqueta.x} y={s.etiqueta.y + 3} fontSize={9} fill="currentColor" fillOpacity={0.8}>
                          {s.anio}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {mesHover !== null && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute top-0 z-10 w-56 rounded border border-black/15 bg-[var(--background)] p-2 shadow-md dark:border-white/20"
                  style={layout.xDeMes(mesHover) > ANCHO / 2 ? { left: 0 } : { right: 0 }}
                >
                  <p className="mb-1 font-semibold">{MESES_CORTOS[mesHover]}</p>
                  {layout.series.map((s) => {
                    const m = serie.meses.find((x) => x.mes === `${s.anio}-${String(mesHover + 1).padStart(2, '0')}`);
                    if (!m) return null;
                    return (
                      <div key={s.anio} className="mb-1 leading-snug">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: colorDeAnio(s.anio, tema) }} />
                        <strong>{s.anio}</strong> {textoEstado(m)}
                        {m.estado === 'ok' && (
                          <span className="block opacity-60">
                            {m.fecha} · {m.validos}/{m.pixeles} píx válidos · {pct(m.descartado)} descartado
                            {(m.elevacionSol ?? 90) < NDVI_SOL_BAJO ? ` · sol ${m.elevacionSol}°` : ''}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {serieResaltada && (
                <div className="mt-1 grid grid-cols-[3.2rem_repeat(12,minmax(0,1fr))] items-center gap-px text-center text-[0.58rem] leading-tight">
                  <span className="text-left opacity-60">% válido {serieResaltada.anio}</span>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = serie.meses.find((x) => x.mes === `${serieResaltada.anio}-${String(i + 1).padStart(2, '0')}`);
                    const valido = m?.descartado !== null && m?.descartado !== undefined ? 100 - m.descartado : null;
                    return (
                      <span key={i} className={m?.estado === 'ok' ? '' : 'opacity-40'} title={m ? textoEstado(m) : 'fuera de la ventana'}>
                        {!m ? '' : m.estado === 'ok' ? valido : '—'}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {verTabla && (
            <div className="max-h-56 overflow-auto">
              <table className="w-full border-collapse text-left text-[0.62rem]">
                <caption className="sr-only">Serie mensual de NDVI</caption>
                <thead className="sticky top-0 bg-[var(--background)]">
                  <tr className="border-b border-black/10 dark:border-white/15">
                    <th className="py-1 pr-2 font-semibold">Mes</th>
                    <th className="pr-2 font-semibold">Mediana</th>
                    <th className="pr-2 font-semibold">P25–P75</th>
                    <th className="pr-2 font-semibold">Válidos</th>
                    <th className="pr-2 font-semibold">Descartado</th>
                    <th className="font-semibold">Escena</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.meses.map((m) => (
                    <tr key={m.mes} className="border-b border-black/5 dark:border-white/10">
                      <td className="py-0.5 pr-2 tabular-nums">{m.mes}</td>
                      <td className="pr-2 tabular-nums">{m.estado === 'ok' ? fmt(m.mediana) : '—'}</td>
                      <td className="pr-2 tabular-nums">{m.estado === 'ok' ? `${fmt(m.p25)}–${fmt(m.p75)}` : textoEstado(m)}</td>
                      <td className="pr-2 tabular-nums">{m.pixeles ? `${m.validos}/${m.pixeles}` : '—'}</td>
                      <td className="pr-2 tabular-nums">{pct(m.descartado)}</td>
                      <td className="tabular-nums">{m.fecha ?? '—'}{(m.elevacionSol ?? 90) < NDVI_SOL_BAJO && m.fecha ? ` (sol ${m.elevacionSol}°)` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {solBajo && !verTabla && (
            <p className="mt-1.5 leading-snug opacity-70">
              ○ Marcador hueco: escena con el sol a menos de {NDVI_SOL_BAJO}°. Las sombras de invierno
              recortan área y el valor corresponde a las copas iluminadas.
            </p>
          )}

          {mostrarConaf && conaf && (
            <p className="mt-1.5 rounded border border-black/10 px-2 py-1 leading-snug dark:border-white/15">
              <strong>CONAF {consulta.tipo === 'punto' ? 'en el punto' : 'en el centro del polígono'}:</strong>{' '}
              {conaf === 'sin-clase'
                ? 'sin polígono del catastro vegetacional.'
                : [conaf.subuso, conaf.estructura, conaf.cobertura, conaf.especi1_co ?? conaf.especi1_ci]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          )}
        </>
      )}

      <p className="mt-2 font-semibold leading-snug">{NDVI_DESCARGO}</p>
      <p className="mt-1 leading-snug opacity-60">
        {ndviAtribucion(serie?.anios ?? [])}.{' '}
        <a href={NDVI_FUENTE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-100">
          Fuente →
        </a>
      </p>
    </section>
  );
}
