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

/**
 * Grilla de la copia restaurada para el micro visor de `/estado`: la copia
 * agrupada en celdas de 0,1° (~10 km) con su conteo. Solo coordenadas
 * redondeadas y conteos: menos detalle que el mapa principal.
 */
export interface CeldaRespaldo {
  lat: number;
  lng: number;
  n: number;
}

export interface GrillaRespaldo {
  total: number;
  celdas: CeldaRespaldo[];
}

/**
 * Valida lo que devuelve la función de la base (`{ total, celdas: [[lat, lng, n], …] }`).
 * Descarta celdas mal formadas o fuera de rango; `null` si la forma no calza.
 */
export function normalizarGrilla(raw: unknown): GrillaRespaldo | null {
  if (!raw || typeof raw !== 'object') return null;
  const { total, celdas } = raw as { total?: unknown; celdas?: unknown };
  if (typeof total !== 'number' || !Array.isArray(celdas)) return null;
  const salida: CeldaRespaldo[] = [];
  for (const c of celdas) {
    if (!Array.isArray(c) || c.length !== 3) continue;
    const [lat, lng, n] = c.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(n) || n <= 0) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    salida.push({ lat, lng, n });
  }
  return { total, celdas: salida };
}

/**
 * Radio en px de una celda: área proporcional al conteo (raíz), entre `min` y
 * `max`. Con radio lineal una celda de Santiago taparía regiones enteras.
 */
export function radioCelda(n: number, nMax: number, min = 2, max = 11): number {
  if (nMax <= 0 || n <= 0) return min;
  return min + (max - min) * Math.sqrt(Math.min(n, nMax) / nMax);
}

/** Zoom desde el que los círculos se dibujan a tamaño completo. */
export const ZOOM_RADIO_COMPLETO = 7;

/**
 * Factor del radio según el zoom: las celdas miden ~10 km, pero el radio está
 * en px, así que al alejar se enciman y Chile entero queda como una mancha.
 * Se achica con la raíz de la escala del mapa (×0,5 cada 2 niveles), con piso
 * 0,3 para que sigan siendo visibles.
 */
export function escalaPorZoom(zoom: number): number {
  return Math.min(1, Math.max(0.3, 2 ** ((zoom - ZOOM_RADIO_COMPLETO) / 2)));
}
