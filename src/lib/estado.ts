/**
 * Estado de los datos de transacciones CBR para la página `/estado` y
 * `/api/health`. Funciones puras: la lectura vive en `estado-server.ts`.
 *
 * La fuente es una tabla de verificaciones diarias que escribe el proceso de
 * respaldo: cada día se restaura el respaldo en una base independiente, se
 * cuentan las filas y se publica una fila con agregados (nunca filas de
 * transacciones ni el detalle de un error). Leerla no consulta la base
 * principal, así que la página no gasta su cuota de transferencia y sigue
 * respondiendo aunque esa base esté caída.
 */

export interface Verificacion {
  verificado_en: string;
  ok: boolean;
  respaldo_fecha: string | null;
  referenciales: number | null;
  conservadores: number | null;
  comunas: number | null;
  ultimo_ingreso: string | null;
  anio_min: number | null;
  anio_max: number | null;
  por_anio: Record<string, number> | null;
  por_region: Record<string, number> | null;
}

/** Columnas que se piden a la tabla (mismo orden que `Verificacion`). */
export const COLUMNAS_VERIFICACION =
  'verificado_en,ok,respaldo_fecha,referenciales,conservadores,comunas,ultimo_ingreso,anio_min,anio_max,por_anio,por_region';

/**
 * La verificación corre una vez al día. Con más de 30 h sin una fila nueva el
 * proceso dejó de correr: eso es una falla aunque la última fila diga `ok`.
 */
export const MAX_HORAS_SIN_VERIFICAR = 30;

export type NivelEstado = 'al-dia' | 'falla' | 'atrasado' | 'sin-datos';

export interface ResumenEstado {
  nivel: NivelEstado;
  /** Fila más reciente, sea o no exitosa. */
  ultima: Verificacion | null;
  /** Fila exitosa más reciente: sus cifras son las que se muestran. */
  ultimaOk: Verificacion | null;
}

const HORA_MS = 60 * 60 * 1000;

/** `filas` en cualquier orden; `ahora` en ms (inyectable para los tests). */
export function resumirEstado(filas: Verificacion[] | null, ahora: number): ResumenEstado {
  if (!filas || filas.length === 0) return { nivel: 'sin-datos', ultima: null, ultimaOk: null };
  const ordenadas = [...filas].sort(
    (a, b) => Date.parse(b.verificado_en) - Date.parse(a.verificado_en),
  );
  const ultima = ordenadas[0];
  const ultimaOk = ordenadas.find((f) => f.ok) ?? null;
  const horas = (ahora - Date.parse(ultima.verificado_en)) / HORA_MS;
  let nivel: NivelEstado;
  if (horas > MAX_HORAS_SIN_VERIFICAR) nivel = 'atrasado';
  else if (!ultima.ok) nivel = 'falla';
  else nivel = 'al-dia';
  return { nivel, ultima, ultimaOk };
}

export type EstadoDia = 'ok' | 'falla' | 'sin-registro';

export interface DiaHistorial {
  /** `YYYY-MM-DD` en hora de Chile. */
  fecha: string;
  estado: EstadoDia;
}

/** Fecha calendario en hora de Chile, `YYYY-MM-DD`. */
export function fechaChile(ms: number): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/**
 * Últimos `dias` días (el más antiguo primero). Un día cuenta como `ok` si
 * tuvo al menos una verificación exitosa, aunque otra del mismo día fallara.
 */
export function historialDiario(
  filas: Verificacion[] | null,
  ahora: number,
  dias: number,
): DiaHistorial[] {
  const porFecha = new Map<string, EstadoDia>();
  for (const f of filas ?? []) {
    const fecha = fechaChile(Date.parse(f.verificado_en));
    if (f.ok) porFecha.set(fecha, 'ok');
    else if (!porFecha.has(fecha)) porFecha.set(fecha, 'falla');
  }
  const salida: DiaHistorial[] = [];
  for (let i = dias - 1; i >= 0; i--) {
    const fecha = fechaChile(ahora - i * 24 * HORA_MS);
    salida.push({ fecha, estado: porFecha.get(fecha) ?? 'sin-registro' });
  }
  return salida;
}

export interface Barra {
  etiqueta: string;
  valor: number;
}

/**
 * Registros por año para el gráfico: los últimos `ultimos` años con datos y
 * el resto sumado en una barra «Anteriores» al comienzo.
 */
export function barrasPorAnio(porAnio: Record<string, number> | null, ultimos: number): Barra[] {
  const anios = Object.entries(porAnio ?? {})
    .map(([anio, n]) => ({ anio: Number(anio), n }))
    .filter((a) => Number.isFinite(a.anio))
    .sort((a, b) => a.anio - b.anio);
  if (anios.length <= ultimos) return anios.map((a) => ({ etiqueta: String(a.anio), valor: a.n }));
  const corte = anios.length - ultimos;
  const anteriores = anios.slice(0, corte).reduce((s, a) => s + a.n, 0);
  return [
    { etiqueta: `Antes de ${anios[corte].anio}`, valor: anteriores },
    ...anios.slice(corte).map((a) => ({ etiqueta: String(a.anio), valor: a.n })),
  ];
}

/** Registros por región, de mayor a menor (jsonb no conserva el orden). */
export function barrasPorRegion(porRegion: Record<string, number> | null): Barra[] {
  return Object.entries(porRegion ?? {})
    .map(([etiqueta, valor]) => ({ etiqueta, valor }))
    .sort((a, b) => b.valor - a.valor || a.etiqueta.localeCompare(b.etiqueta, 'es'));
}
