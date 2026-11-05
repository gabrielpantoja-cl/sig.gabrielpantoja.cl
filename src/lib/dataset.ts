/**
 * Identidad del CONJUNTO DE DATOS CBR (no del despliegue — eso es
 * `lib/version.ts`).
 *
 * ## Por qué existe
 *
 * `/api/points` se sirve con `s-maxage=3600, stale-while-revalidate=86400`
 * porque el conjunto completo pesa ~31 MB y sin caché de CDN cada visita
 * golpearía Neon y el cupo de transferencia. El efecto secundario es que, tras
 * una carga de datos nueva, el mapa seguía mostrando la copia vieja hasta un
 * día entero: el operador cargaba miles de transacciones y en producción no
 * aparecía ninguna. Peor: al aplicar CUALQUIER filtro cambiaba la clave de
 * caché, la respuesta era MISS y los datos nuevos aparecían de golpe — así que
 * la lectura natural del bug era «el mapa sin filtros esconde los años
 * antiguos», cuando lo que pasaba es que sin filtros se servía otro conjunto.
 *
 * ## Cómo lo resuelve
 *
 * El cliente pide primero `/api/dataset` (barato, ~80 bytes) y adjunta el
 * `token` resultante como `?ds=…` a `/api/points`, `/api/stats`, `/api/facets`
 * y `/api/hexbins`. El token es parte de la clave de caché del CDN, así que:
 *
 * - mientras los datos no cambian, el token no cambia y todo sigue sirviéndose
 *   desde el borde, igual de barato que antes;
 * - en cuanto entra una carga nueva, el token cambia y TODAS esas rutas pasan
 *   a una clave nueva: MISS, consulta fresca, datos completos. La caché vieja
 *   expira sola sin que nadie la purgue.
 *
 * El parámetro se llama `ds` y no `v` a propósito: `v` ya es el encuadre del
 * permalink (`?v=lat,lng,zoom`) y confundir ambos sería un bug silencioso.
 * `buildFilters` ignora los parámetros que no conoce, así que `ds` no toca el
 * SQL: su único efecto es la clave de caché.
 */

/** Respuesta de `GET /api/dataset`. */
export type DatasetVersion = {
  /** Token opaco: cambia si y solo si cambió el conjunto geolocalizado. */
  token: string;
  /** Transacciones geolocalizadas (las que el mapa puede dibujar). */
  count: number;
  /** Última escritura conocida sobre `referenciales`, ISO-8601, o null. */
  updated: string | null;
};

/** Nombre del parámetro de versión del dataset en las URLs de `/api/*`. */
export const DATASET_PARAM = 'ds';

/**
 * Cuánto cachea el CDN `/api/dataset`. Treinta segundos es el techo del
 * retraso con que el operador ve su carga reflejada en producción, y a la vez
 * el piso de una consulta a Neon cada 30 s por región, sin importar cuántas
 * pestañas haya abiertas.
 */
export const DATASET_MAX_AGE_S = 30;

/**
 * Cada cuánto el cliente vuelve a preguntar por el conjunto. Un minuto con la
 * pestaña visible: suficiente para que quien está cargando datos se entere en
 * la misma sesión, y despreciable al lado de los ~31 MB del dataset.
 */
export const DATASET_POLL_MS = 60 * 1000;

/**
 * Huella del conjunto. `count` sola no basta (un borrado más una inserción la
 * dejan igual) y la marca de tiempo sola tampoco (una carga que no toca
 * `updatedAt` pasaría inadvertida): juntas cubren todo lo que un ETL puede
 * hacerle a la tabla.
 */
export function datasetToken(count: number, updated: string | null): string {
  const stamp = updated ? Date.parse(updated) : NaN;
  return `${count}.${Number.isFinite(stamp) ? stamp : 0}`;
}

/**
 * Añade el token a un query string de filtros ya serializado. Sin token
 * devuelve el query intacto: si `/api/dataset` falla, el mapa sigue cargando
 * con el comportamiento de caché anterior en vez de quedarse en blanco.
 */
export function withDataset(qs: string, token: string | null): string {
  if (!token) return qs;
  const params = new URLSearchParams(qs);
  params.set(DATASET_PARAM, token);
  return params.toString();
}
