# Estado de los datos (`/estado` y `/api/health`)

**Creado:** 2026-10-26.

Esta página le dice a quien usa el SIG si puede confiar en los datos de
transacciones CBR: si están respaldados, si el respaldo de verdad se puede
recuperar y qué tan al día están. No es un panel de infraestructura: no
muestra CPU, conexiones ni dónde se guardan los respaldos.

## Qué muestra

| Bloque | Origen |
|---|---|
| Estado general (al día / falla / atrasado / no disponible) | Última verificación diaria (`resumirEstado`) |
| Transacciones, comunas, período, último ingreso | Última verificación **exitosa** |
| Copia restaurada en el mapa (micro visor) | `/api/estado/grilla`: la copia restaurada agrupada en celdas de 0,1° (~10 km) |
| Historial de 30 días | Una casilla por día en hora de Chile: verificado, falló o sin registro |
| Transacciones por año y por región | Agregados de la última verificación exitosa |
| «Cómo cuidamos los datos» | Texto fijo |

Niveles (`src/lib/estado.ts`):

| Nivel | Cuándo |
|---|---|
| `al-dia` | La última verificación tiene menos de 30 h y fue exitosa |
| `falla` | La última verificación tiene menos de 30 h y falló. Las cifras siguen siendo las de la última exitosa |
| `atrasado` | Más de 30 h sin verificaciones: el proceso dejó de correr. Es una falla aunque la última fila diga `ok` |
| `sin-datos` | No se pudo leer la tabla o faltan las variables de entorno |

## De dónde salen los datos

Cada día un proceso externo al SIG restaura el respaldo de la base de
transacciones en una base independiente, compara los conteos y publica **una
fila de agregados** en la tabla `estado_respaldo` de esa base. La tabla es de
solo lectura pública (RLS + `SELECT` para el rol anónimo) y nunca contiene filas
de transacciones ni el motivo de un error.

El SIG la lee por la API REST de esa base con una **clave publicable**
(`src/lib/estado-server.ts`), con caché de 15 minutos; `/estado` se regenera por
ISR cada 5 minutos (para que el aviso de servicio cambie a tiempo).

Columnas: `verificado_en`, `ok`, `respaldo_fecha`, `referenciales`,
`conservadores`, `comunas`, `ultimo_ingreso`, `anio_min`, `anio_max`,
`por_anio` (jsonb año → n), `por_region` (jsonb región → n).

### Por qué no se consulta Neon

1. **Cuota de transferencia.** El plan gratuito de Neon tiene 5 GB/mes de
   salida; la tabla de transacciones se lee completa unas 90 veces y se acaba.
2. **Cómputo.** Un monitor que sondee cada 5 minutos mantendría despierta la
   base todo el día y agotaría las horas de cómputo del plan.
3. **Independencia.** Si Neon se cae, la página igual puede decir que la base
   principal no responde y que hay una copia verificada.

Regla: **ni `/estado`, ni `/api/health`, ni `/api/estado/grilla` consultan Neon.**

### Micro visor

Muestra que la copia restaurada trae datos en todo el territorio, no solo el
conteo correcto. La base del respaldo expone la función
`estado_respaldo_grilla()` (`SECURITY DEFINER`, ejecutable por el rol
anónimo): agrupa la copia en celdas de 0,1° y devuelve un solo `jsonb`
`{ total, celdas: [[lat, lng, n], …] }`. El rol anónimo no lee la tabla, solo
ese resultado; nunca salen filas de transacciones. Un solo valor y no un
conjunto de filas porque la API REST corta en 1.000 filas.

`/api/estado/grilla` la lee con la misma clave publicable (caché 1 h en el
servidor y `s-maxage=3600` en la CDN) y responde `{ total, celdas: [{ lat,
lng, n }] }`, o 503 si no está disponible. `src/components/EstadoMapa.tsx`
importa Leaflet recién al montar y dibuja círculos en canvas (área
proporcional al conteo) sobre el fondo neutro.

### Base que atiende el mapa (`estado_servicio`)

Las verificaciones dicen si el **respaldo** está sano, no qué base atiende
**hoy** al mapa. Cada servidor anota dos eventos en la única fila de
`public.estado_servicio` de la base del respaldo, cada uno a lo más una vez
cada 5 min (`src/lib/neon.ts`):

| Evento | Columna | Función |
|---|---|---|
| Una consulta CBR se respondió con la copia (`FALLBACK_DATABASE_URL`) | `respaldo_usado_en` | `public.marcar_uso_respaldo()` |
| Una consulta a la base principal funcionó | `principal_ok_en` | `public.marcar_exito_principal()` |

Son funciones `SECURITY DEFINER` que solo escriben esa hora; el rol del
respaldo tiene `EXECUTE` sobre ellas y nada más escribible, y el rol anónimo
solo lee la fila. La marca del éxito de la principal no se espera: nunca demora
ni hace fallar una respuesta que la principal ya dio.

`/estado` y `/api/health` (`servicio`, `servicio_desde`) leen la fila por REST
(caché 1 min) y `estadoServicio()` decide por el **evento más reciente**, sin
vencimiento: uso de la copia más nuevo que el último éxito de la principal →
`respaldo` (aviso ámbar, ficha del predio parcial: sin las capas `capas.*`);
lo contrario → `principal`; sin eventos o sin lectura → `desconocida`.

Por qué sin vencimiento: si la CDN atiende todas las visitas no se anota nada,
y la falta de marcas no prueba que la principal haya vuelto. La primera versión
apagaba el aviso cuando la marca cumplía 15 min, y el 2026-11-13 dijo
«principal» con la base principal todavía bloqueada. Ahora el aviso se quita
recién al ver un éxito de la principal. Tampoco aquí se consulta Neon.

## `/api/health`

```json
{
  "status": "ok",
  "version": "0.2.0",
  "build": "…",
  "servicio": "principal",
  "servicio_desde": "2026-12-01T00:05:00Z",
  "datos": {
    "nivel": "al-dia",
    "ultima_verificacion": "2026-10-26T15:55:07Z",
    "ultimo_respaldo_verificado": "2026-10-26T15:55:07Z",
    "transacciones": 107743
  }
}
```

- Responde **200 mientras la app esté arriba**, aunque el respaldo haya
  fallado: una falla de datos no es una caída del sitio.
- Para vigilar también los datos, usar un monitor **de palabra clave** que
  exija `"nivel":"al-dia"` en la respuesta. Así detecta tanto una caída como un
  proceso de respaldo que dejó de correr (nivel `atrasado`).
- `no-store` y pasa por `enforce()` (60 req/min/IP): un monitor sondea muy por
  debajo de ese límite.

## Configuración

| Variable | Valor |
|---|---|
| `ESTADO_SUPABASE_URL` | URL del proyecto que guarda `estado_respaldo` |
| `ESTADO_SUPABASE_KEY` | Su clave **publicable** (`sb_publishable_…`) |

Ambas son de servidor (sin `NEXT_PUBLIC_`), aunque la clave sea publicable: así
se puede rotar sin rebuild del cliente. Sin ellas la página muestra «Estado no
disponible por ahora» y el resto del SIG funciona igual.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/lib/estado.ts` | Tipos y funciones puras: nivel, historial diario, barras |
| `src/lib/estado.test.ts` | Tests de los niveles, la fecha de Chile y las barras |
| `src/lib/estado-server.ts` | Lectura de la tabla (server-only, caché 15 min) |
| `src/app/estado/page.tsx` | La página |
| `src/app/api/health/route.ts` | El JSON para monitores |
| `src/app/api/estado/grilla/route.ts` | La grilla de la copia para el micro visor (+ `route.test.ts`) |
| `src/components/EstadoMapa.tsx` | El micro visor |
