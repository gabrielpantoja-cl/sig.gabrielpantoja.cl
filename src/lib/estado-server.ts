import 'server-only';
import { COLUMNAS_VERIFICACION, type Verificacion } from '@/lib/estado';

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

/**
 * Verificaciones + la hora de lectura. La hora se toma aquí y no en el
 * componente: en ISR es la hora del render, que se repite cada 15 min.
 */
export async function leerEstado(): Promise<{ filas: Verificacion[] | null; ahora: number }> {
  const filas = await obtenerVerificaciones();
  return { filas, ahora: Date.now() };
}
