import type { Metadata } from 'next';
import Link from 'next/link';
import {
  anioChile,
  barrasPorAnio,
  barrasPorRegion,
  fuenteServicio,
  historialDiario,
  INICIO_VERIFICACIONES,
  resumirEstado,
  type Barra,
  type DiaHistorial,
  type FuenteServicio,
  type NivelEstado,
} from '@/lib/estado';
import { leerEstado } from '@/lib/estado-server';
import EstadoMapa from '@/components/EstadoMapa';

/**
 * /estado — salud de los datos de transacciones CBR: si el respaldo diario se
 * pudo restaurar, cuántos registros hay y desde cuándo. No consulta la base
 * principal (ver `lib/estado.ts`); se regenera cada 5 minutos para que el aviso
 * «funcionando con respaldo» aparezca y se apague a tiempo.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Estado de los datos — SIG de suelo | gabrielpantoja.cl',
  description:
    'Respaldo diario verificado, volumen y vigencia de las transacciones CBR publicadas en el SIG de suelo.',
};

const DIAS_HISTORIAL = 30;
const ANIOS_GRAFICO = 12;
const ACENTO = 'hsl(153 28% 35%)';

const NIVELES: Record<NivelEstado, { titulo: string; color: string; detalle: string }> = {
  'al-dia': {
    titulo: 'Datos respaldados y verificados',
    color: ACENTO,
    detalle: 'El respaldo de hoy se restauró en una base independiente y sus conteos coinciden.',
  },
  falla: {
    titulo: 'La última verificación del respaldo falló',
    color: 'hsl(0 65% 48%)',
    detalle:
      'Ya está en revisión. Los datos publicados no cambian y se conserva el último respaldo verificado.',
  },
  atrasado: {
    titulo: 'La verificación diaria está atrasada',
    color: 'hsl(38 90% 45%)',
    detalle: 'Hace más de un día que no se registra una verificación. Los datos publicados no cambian.',
  },
  'sin-datos': {
    titulo: 'Estado no disponible por ahora',
    color: 'hsl(0 0% 55%)',
    detalle: 'No se pudo leer el registro de verificaciones. El mapa sigue funcionando.',
  },
};

const AMBAR = 'hsl(38 90% 45%)';
const ROJO = 'hsl(0 65% 48%)';

/** Qué atiende el mapa. `desconocida` no se muestra: no hay nada que afirmar. */
const SERVICIO: Record<Exclude<FuenteServicio, 'desconocida'>, {
  base: string;
  ficha: string;
  fichaOk: boolean;
}> = {
  principal: { base: 'Base principal', ficha: 'Disponible', fichaOk: true },
  respaldo: {
    base: 'Copia de respaldo (hasta 1 día de atraso)',
    ficha: 'Parcial: sin comuna, límite urbano ni áreas protegidas',
    fichaOk: false,
  },
};

const fmtNumero = new Intl.NumberFormat('es-CL');
const fmtFechaHora = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fmtFecha = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function hace(iso: string, ahora: number): string {
  const horas = Math.max(0, Math.round((ahora - Date.parse(iso)) / 3_600_000));
  if (horas < 1) return 'hace menos de una hora';
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.round(horas / 24)} días`;
}

export default async function EstadoPage() {
  const { filas, marca, ahora } = await leerEstado();
  const { nivel, ultima, ultimaOk } = resumirEstado(filas, ahora);
  const nivelInfo = NIVELES[nivel];
  const fuente = fuenteServicio(marca, ahora);
  const historial = historialDiario(filas, ahora, DIAS_HISTORIAL, INICIO_VERIFICACIONES);
  const porAnio = barrasPorAnio(ultimaOk?.por_anio ?? null, ANIOS_GRAFICO);
  const porRegion = barrasPorRegion(ultimaOk?.por_region ?? null);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 md:px-6 md:py-10">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 pb-4 dark:border-white/10">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
            SIG de suelo
          </p>
          <h1 className="mt-1 text-xl font-semibold md:text-2xl">Estado de los datos</h1>
        </div>
        <Link
          href="/"
          className="rounded-full border border-black/15 px-3 py-1.5 text-xs transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)] dark:border-white/20 dark:hover:bg-white/10"
        >
          ← Volver al mapa
        </Link>
      </header>

      <section
        className="mt-6 rounded-lg border border-black/10 p-4 dark:border-white/10"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ background: nivelInfo.color }}
            aria-hidden="true"
          />
          <h2 className="text-base font-medium">{nivelInfo.titulo}</h2>
        </div>
        <p className="mt-2 text-sm opacity-75">{nivelInfo.detalle}</p>
        {fuente === 'respaldo' && (
          <div
            className="mt-3 rounded-md border p-3 text-sm"
            style={{ borderColor: AMBAR, background: 'hsl(38 90% 45% / 0.08)' }}
          >
            <p className="flex items-center gap-2 font-medium">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: AMBAR }}
                aria-hidden="true"
              />
              Funcionando con la copia de respaldo
            </p>
            <p className="mt-1 opacity-80">
              La base principal no está respondiendo. El mapa muestra la copia verificada, con
              hasta un día de atraso. La ficha del predio funciona en parte: calcula superficie,
              comparables y relieve, pero no comuna, límite urbano ni áreas protegidas. El resto
              de las capas funciona con normalidad.
            </p>
          </div>
        )}
        {ultima && (
          <p className="mt-2 text-xs opacity-60">
            Última verificación: {fmtFechaHora.format(Date.parse(ultima.verificado_en))} (hora de
            Chile, {hace(ultima.verificado_en, ahora)})
            {ultimaOk && ultimaOk !== ultima && (
              <>
                {' '}
                · Último respaldo verificado:{' '}
                {fmtFechaHora.format(Date.parse(ultimaOk.verificado_en))} (hora de Chile)
              </>
            )}
          </p>
        )}
      </section>

      {ultimaOk && (
        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Cifra
            etiqueta="Transacciones"
            valor={ultimaOk.referenciales != null ? fmtNumero.format(ultimaOk.referenciales) : '—'}
          />
          <Cifra
            etiqueta="Comunas"
            valor={ultimaOk.comunas != null ? fmtNumero.format(ultimaOk.comunas) : '—'}
          />
          <Cifra
            etiqueta="Período"
            valor={
              ultimaOk.anio_min != null && ultimaOk.anio_max != null
                ? `${ultimaOk.anio_min}–${ultimaOk.anio_max}`
                : '—'
            }
          />
          <Cifra
            etiqueta="Último ingreso"
            valor={ultimaOk.ultimo_ingreso ? fmtFecha.format(Date.parse(ultimaOk.ultimo_ingreso)) : '—'}
          />
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide opacity-50">
          Copia restaurada en el mapa
        </h2>
        <EstadoMapa>
          {fuente !== 'desconocida' && (
            <dl className="mt-4 space-y-2 rounded-lg border border-black/10 p-3 text-xs dark:border-white/10 md:text-sm">
              <div>
                <dt className="text-[0.7rem] uppercase tracking-wide opacity-55">
                  Transacciones del mapa
                </dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: fuente === 'principal' ? ACENTO : AMBAR }}
                    aria-hidden="true"
                  />
                  {SERVICIO[fuente].base}
                </dd>
              </div>
              <div>
                <dt className="text-[0.7rem] uppercase tracking-wide opacity-55">
                  Ficha del predio
                </dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SERVICIO[fuente].fichaOk ? ACENTO : AMBAR }}
                    aria-hidden="true"
                  />
                  {SERVICIO[fuente].ficha}
                </dd>
              </div>
            </dl>
          )}
        </EstadoMapa>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-wide opacity-50">
          Verificación del respaldo · últimos {DIAS_HISTORIAL} días
        </h2>
        <Historial dias={historial} />
      </section>

      {porAnio.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-50">
            Transacciones por año
          </h2>
          <BarrasVerticales barras={porAnio} anioEnCurso={anioChile(ahora)} />
          {porAnio.some((b) => b.etiqueta === String(anioChile(ahora))) && (
            <p className="mt-1 text-[0.7rem] opacity-55">
              * {anioChile(ahora)} es el año en curso: la cifra es parcial.
            </p>
          )}
        </section>
      )}

      {porRegion.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-50">
            Transacciones por región
          </h2>
          <BarrasHorizontales barras={porRegion} />
        </section>
      )}

      <section className="mt-10 border-t border-black/10 pt-6 text-sm dark:border-white/10">
        <h2 className="text-base font-medium">Cómo cuidamos los datos</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 opacity-80">
          <li>
            Cada día se hace un respaldo completo de la base, que se guarda fuera de ella y se
            conserva 30 días.
          </li>
          <li>
            Ese respaldo se restaura todos los días en una base independiente y se comparan los
            conteos: así se comprueba que se puede recuperar, no solo que existe.
          </li>
          <li>
            Si un respaldo trae muchos menos registros que el anterior, no reemplaza a la copia
            verificada y se revisa a mano.
          </li>
          <li>
            El mapa consulta la base con un usuario de solo lectura. No se publican nombres de las
            partes, RUT, datos de contacto ni observaciones.
          </li>
        </ul>
        <p className="mt-4 text-xs opacity-60">
          ¿Encontraste un problema de seguridad?{' '}
          <a
            className="underline underline-offset-2"
            href="https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl/blob/main/SECURITY.md"
          >
            Cómo reportarlo
          </a>
          . Estado en formato JSON: <code className="font-mono">/api/health</code>.
        </p>
      </section>
    </main>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <p className="text-[0.7rem] uppercase tracking-wide opacity-55">{etiqueta}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

const TEXTO_DIA: Record<DiaHistorial['estado'], string> = {
  ok: 'verificado',
  falla: 'falló',
  'sin-registro': 'sin registro',
  'antes-del-inicio': 'antes del inicio de las verificaciones',
};

/** Rayado: días en que el sistema todavía no existía. */
const RAYADO =
  'repeating-linear-gradient(135deg, transparent 0 3px, hsl(0 0% 50% / 0.35) 3px 4px)';

function fondoDia(e: DiaHistorial['estado']): string {
  if (e === 'ok') return ACENTO;
  if (e === 'falla') return ROJO;
  if (e === 'antes-del-inicio') return RAYADO;
  return 'transparent';
}

const LEYENDA: { estado: DiaHistorial['estado']; texto: string }[] = [
  { estado: 'ok', texto: 'Verificado' },
  { estado: 'falla', texto: 'Falló' },
  { estado: 'sin-registro', texto: 'Sin registro' },
  { estado: 'antes-del-inicio', texto: 'Antes del inicio' },
];

function Historial({ dias }: { dias: DiaHistorial[] }) {
  const presentes = new Set(dias.map((d) => d.estado));
  return (
    <div className="mt-3">
      <ol className="flex gap-[3px]" aria-label="Resultado diario de la verificación">
        {dias.map((d) => (
          <li
            key={d.fecha}
            title={`${d.fecha}: ${TEXTO_DIA[d.estado]}`}
            className="h-8 flex-1 rounded-sm border border-black/10 dark:border-white/15"
            style={{ background: fondoDia(d.estado) }}
          >
            <span className="sr-only">
              {d.fecha}: {TEXTO_DIA[d.estado]}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-[0.7rem] opacity-55">
        <span>{dias[0]?.fecha}</span>
        <span>hoy</span>
      </div>
      {/* Leyenda visible: el title solo se ve con mouse, no en celular. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] opacity-70">
        {LEYENDA.filter((l) => l.estado !== 'antes-del-inicio' || presentes.has(l.estado)).map(
          (l) => (
            <li key={l.estado} className="mr-3 flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-black/10 dark:border-white/15"
                style={{ background: fondoDia(l.estado) }}
                aria-hidden="true"
              />
              {l.texto}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function BarrasVerticales({ barras, anioEnCurso }: { barras: Barra[]; anioEnCurso: number }) {
  const max = Math.max(...barras.map((b) => b.valor), 1);
  const enCurso = String(anioEnCurso);
  return (
    <div className="mt-3 flex h-44 items-end gap-1.5" role="list">
      {barras.map((b) => (
        <div
          key={b.etiqueta}
          role="listitem"
          className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
          title={`${b.etiqueta}: ${fmtNumero.format(b.valor)}${b.etiqueta === enCurso ? ' (año en curso, parcial)' : ''}`}
        >
          <span className="shrink-0 text-[0.6rem] tabular-nums opacity-60">
            {b.valor >= 1000 ? `${(b.valor / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })}k` : b.valor}
          </span>
          <div
            className="w-full min-h-0 rounded-t-sm"
            style={{
              height: `${(b.valor / max) * 100}%`,
              background: ACENTO,
              minHeight: 2,
              // El año en curso está incompleto: más claro para no leerse como caída.
              opacity: b.etiqueta === enCurso ? 0.45 : 1,
            }}
          />
          <span className="w-full shrink-0 truncate text-center text-[0.6rem] opacity-60">
            {b.etiqueta.startsWith('Antes') ? b.etiqueta.replace('Antes de ', '<') : `’${b.etiqueta.slice(2)}`}
            {b.etiqueta === enCurso && '*'}
          </span>
        </div>
      ))}
    </div>
  );
}

function BarrasHorizontales({ barras }: { barras: Barra[] }) {
  const max = Math.max(...barras.map((b) => b.valor), 1);
  return (
    <ul className="mt-3 space-y-1.5">
      {barras.map((b) => (
        <li key={b.etiqueta} className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-2 text-xs">
          <span className="truncate opacity-75">{b.etiqueta}</span>
          <span className="h-3 rounded-sm bg-black/5 dark:bg-white/10">
            <span
              className="block h-full rounded-sm"
              style={{ width: `${(b.valor / max) * 100}%`, background: ACENTO }}
            />
          </span>
          <span className="text-right tabular-nums opacity-70">{fmtNumero.format(b.valor)}</span>
        </li>
      ))}
    </ul>
  );
}
