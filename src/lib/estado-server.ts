import 'server-only';
import {
  COLUMNAS_VERIFICACION,
  normalizarGrilla,
  type GrillaRespaldo,
  type MarcaRespaldo,
  type Verificacion,
} from '@/lib/estado';

/**
 * Lee las verificaciones diarias del respaldo (ver `estado.ts`). Es una tabla
 * de solo lectura pública en una base aparte de la principal; se accede por
 * su API REST con una clave publicable, que solo permite ese SELECT.
 *
 * Sin ESTADO_SUPABASE_URL / ESTADO_SUPABASE_KEY devuelve `null` y la página
 * muestra «sin datos»: un clon del repo funciona sin configurar nada.
 * Caché de 15 minutos: la tabla cambia una vez al día.
 */

export const REVALIDAR_ESTADO_S = 900;

export async function obtenerVerificaciones(limite = 60): Promise<Verificacion[] | null> {
  const base = process.env.ESTADO_SUPABASE_URL;
  const clave = process.env.ESTADO_SUPABASE_KEY;
  if (!base || !clave) return null;

  const url =
    `${base.replace(/\/$/, '')}/rest/v1/estado_respaldo` +
    `?select=${COLUMNAS_VERIFICACION}&order=verificado_en.desc&limit=${limite}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: clave },
      next: { revalidate: REVALIDAR_ESTADO_S },
    });
    if (!res.ok) {
      console.error('estado_respaldo respondió', res.status);
      return null;
    }
    return (await res.json()) as Verificacion[];
  } catch (error) {
    console.error('Error leyendo estado_respaldo:', error);
    return null;
  }
}

/** La copia cambia una vez al día; una hora de caché basta para el visor. */
export const REVALIDAR_GRILLA_S = 3600;

/**
 * Grilla de la copia restaurada (ver `normalizarGrilla`), por la función
 * `estado_respaldo_grilla` de la misma base y con la misma clave publicable.
 * La función agrupa del lado de la base: nunca viajan filas de transacciones.
 * `null` si falta configuración, la función no existe o la forma no calza.
 */
export async function obtenerGrilla(): Promise<GrillaRespaldo | null> {
  const base = process.env.ESTADO_SUPABASE_URL;
  const clave = process.env.ESTADO_SUPABASE_KEY;
  if (!base || !clave) return null;

  const url = `${base.replace(/\/$/, '')}/rest/v1/rpc/estado_respaldo_grilla`;
  try {
    const res = await fetch(url, {
      headers: { apikey: clave },
      next: { revalidate: REVALIDAR_GRILLA_S },
    });
    if (!res.ok) {
      console.error('estado_respaldo_grilla respondió', res.status);
      return null;
    }
    return normalizarGrilla(await res.json());
  } catch (error) {
    console.error('Error leyendo estado_respaldo_grilla:', error);
    return null;
  }
}

/**
 * Verificaciones + la hora de lectura. La hora se toma aquí y no en el
 * componente: en ISR es la hora del render, que se repite cada 15 min.
 */
export async function leerEstado(): Promise<{
  filas: Verificacion[] | null;
  marca: MarcaRespaldo;
  ahora: number;
}> {
  const [filas, marca] = await Promise.all([obtenerVerificaciones(), obtenerMarcaRespaldo()]);
  return { filas, marca, ahora: Date.now() };
}

/**
 * Últimos eventos de servicio (tabla `estado_servicio`, una sola fila, misma
 * base y clave publicable): último uso de la copia y último éxito de la base
 * principal. Caché de 1 min. `select=*` a propósito: si la columna
 * `principal_ok_en` todavía no existe, se lee igual (queda `null`).
 * `disponible: false` si falta configuración o la tabla no existe.
 */
export async function obtenerMarcaRespaldo(): Promise<MarcaRespaldo> {
  const base = process.env.ESTADO_SUPABASE_URL;
  const clave = process.env.ESTADO_SUPABASE_KEY;
  const sinDatos: MarcaRespaldo = { disponible: false, respaldoUsadoEn: null, principalOkEn: null };
  if (!base || !clave) return sinDatos;

  const url = `${base.replace(/\/$/, '')}/rest/v1/estado_servicio?select=*&id=eq.1`;
  try {
    const res = await fetch(url, { headers: { apikey: clave }, next: { revalidate: 60 } });
    if (!res.ok) return sinDatos;
    const filas = (await res.json()) as {
      respaldo_usado_en?: string | null;
      principal_ok_en?: string | null;
    }[];
    if (!Array.isArray(filas) || filas.length === 0) return sinDatos;
    return {
      disponible: true,
      respaldoUsadoEn: filas[0].respaldo_usado_en ?? null,
      principalOkEn: filas[0].principal_ok_en ?? null,
    };
  } catch {
    return sinDatos;
  }
}
