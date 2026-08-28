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
 * Cada release se etiqueta en git (`v0.1.0`) y se anota en `CHANGELOG.md`.
 *
 * ## Por qué `0.1.0` y no un número más alto
 *
 * Decisión del mantenedor (2026-08-28): empezar por lo más bajo. `v0.1.0` es
 * el **primer release etiquetado** del proyecto — todo lo anterior es
 * prehistoria sin versionar, que vive en los commits. El número no intenta
 * resumir cuánto se ha construido; eso lo cuenta el CHANGELOG. Lo que declara
 * es dónde empieza la disciplina de versionado.
 *
 * Nota para quien venga después: entre este archivo y el tag `v0.1.0` hubo un
 * `0.5.0` que existió durante una hora en `main` y **nunca se etiquetó ni se
 * desplegó como release**. Por eso volver a `0.1.0` no es una regresión de
 * versión (que SemVer no admite entre releases): no había release del cual
 * regresar. A partir de `v0.1.0` los números solo suben.
 *
 * ## BUILD_ID
 *
 * La versión sube a mano; el build cambia en cada deploy. El monitor de
 * actualizaciones (`components/UpdateNotice.tsx`) compara **el build**, no la
 * versión: así también detecta un despliegue de correcciones que no movió el
 * número. En Vercel es el SHA del commit; en local no hay deploys, así que
 * queda fijo en `dev` y el aviso nunca aparece.
 */

export const APP_VERSION = '0.1.0';

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
