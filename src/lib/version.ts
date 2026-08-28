/**
 * Identidad de la versión desplegada.
 *
 * ## Esquema: SemVer `MAYOR.MENOR.PARCHE`, en `0.x` a propósito
 *
 * El `0` mayor no es falsa modestia: significa una cosa concreta y
 * verificable — **el contrato público todavía no está congelado**. Este SIG
 * expone rutas HTTP (`/api/points`, `/api/stats`, `/api/facets`,
 * `/api/export`, `/api/hexbins`) que un tercero puede consumir, y hasta que
 * la forma de esas respuestas esté documentada y estabilizada no se puede
 * prometer lo que promete un `1.0.0`. Publicar `1.0.0` antes de eso sería el
 * error opuesto al de subestimarse.
 *
 * Qué mueve cada número:
 *
 * | Número | Cuándo sube |
 * |---|---|
 * | **MAYOR** | Pasa a `1.0.0` cuando el contrato de `/api/*` esté documentado y se asuma el compromiso de no romperlo sin aviso. Después, cualquier cambio incompatible de esas respuestas. |
 * | **MENOR** | Una capacidad nueva visible para el usuario: una capa temática, el mapa de calor, el export PNG, el selector de mapa base. |
 * | **PARCHE** | Correcciones, ajustes de estilo, y regeneración de datos de una capa existente vía `npm run data:build:*`. |
 *
 * Cada release se etiqueta en git (`v0.5.0`) y se anota en `CHANGELOG.md`.
 *
 * ## Por qué `0.5.0` y no `0.1.0`
 *
 * `0.1.0` era el valor que dejó `create-next-app` y nunca se tocó: describía
 * el día 1, no las ~12 capas temáticas, el mapa de calor con PostGIS, el
 * export PNG con cajetín legal y el geocoder que hay hoy. Mantenerlo sería
 * tan poco honesto como saltar a `1.0.0`. `0.5.0` dice lo que es: producto
 * en uso y a mitad de camino de su propio `1.0`.
 *
 * ## BUILD_ID
 *
 * La versión sube a mano; el build cambia en cada deploy. El monitor de
 * actualizaciones (`components/UpdateNotice.tsx`) compara **el build**, no la
 * versión: así también detecta un despliegue de correcciones que no movió el
 * número. En Vercel es el SHA del commit; en local no hay deploys, así que
 * queda fijo en `dev` y el aviso nunca aparece.
 */

export const APP_VERSION = '0.5.0';

/** SHA del commit desplegado (Vercel) o `dev` fuera de él. Se congela en el
 *  bundle al construir, que es justo lo que necesita el comparador. */
export const BUILD_ID: string =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev';

/** Respuesta de `GET /api/version`. */
export type VersionInfo = {
  version: string;
  build: string;
};

/** Cada cuánto el cliente pregunta por una versión nueva. Cinco minutos es
 *  suficiente para enterarse en la misma sesión sin convertir el aviso en
 *  tráfico: la respuesta son ~40 bytes y solo se pide con la pestaña visible. */
export const UPDATE_POLL_MS = 5 * 60 * 1000;
