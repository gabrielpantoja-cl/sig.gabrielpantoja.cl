# Estadísticas del panel CBR

Cómo se calculan las seis cifras del panel **Estadísticas** (`/api/stats`), por
qué están ordenadas así y qué NO se puede concluir de ellas.

Código: [`src/app/api/stats/route.ts`](../src/app/api/stats/route.ts) ·
[`src/components/FieldGroups.tsx`](../src/components/FieldGroups.tsx) (`StatsFields`) ·
tipo `Stats` en [`src/lib/types.ts`](../src/lib/types.ts).

---

## 1. El problema que resuelve este diseño

El panel anterior mostraba seis métricas bajo un solo encabezado
—*"85.800 transacciones en la selección"*— como si las seis se calcularan sobre
esas 85.800 filas. No era así, y además el `$/m²` estaba mal ponderado.

Medido contra producción el 2026-08-26 (selección completa, sin filtros):

| Síntoma | Evidencia |
|---|---|
| Tres denominadores distintos presentados como uno | `count` = 85.800, pero `avg`/`mediana`/`min`/`max` salían de 85.763 filas y el `$/m²` de 71.919 (83,8%) |
| `$/m²` dominado por predios diminutos | Global $514.094/m²; solo predios ≥ 10.000 m²: $5.982/m² (86× menos) |
| El promedio describía a sus outliers, no al mercado | 44 transacciones (0,05%) concentran el **59%** de la masa monetaria: excluir montos ≥ $10.000M baja el promedio de $212.612.357 a $87.101.518 |
| Se destacaba el estadístico menos representativo | «Promedio» iba primero, con promedio/mediana = **5,06×** |

`avg()` y `percentile_cont()` descartan `NULL` en silencio, y
`NULLIF("superficieTerreno", 0)` descartaba otro 16% sin avisar: un perito que
citara ese `$/m²` en un informe estaba citando una submuestra sin saberlo.

## 2. Denominadores: las tres N

`/api/stats` devuelve los tres conteos de forma explícita para que la UI pueda
nombrar la base de cada métrica.

| Campo | Definición SQL | Métricas que sostiene |
|---|---|---|
| `count` | `count(*)` | El total de la selección (lo que dibuja el mapa) |
| `count_monto` | `count(monto)` | `avg`, `mediana`, `min`, `max` |
| `count_precio_m2` | filas con `monto IS NOT NULL AND "superficieTerreno" > 0` | `precio_m2`, `precio_m2_mediana` |

Siempre `count_precio_m2 ≤ count_monto ≤ count`. La UI imprime la cobertura al
pie de cada bloque (*"Calculado sobre 71.919 de 85.800 transacciones (83,8%)"*).

## 3. Las dos lecturas del $/m²

Un solo número no basta, porque las dos preguntas razonables tienen respuestas
distintas por dos órdenes de magnitud.

### `precio_m2_mediana` — «$/m² típico»

Mediana de la razón `monto / superficie` calculada **transacción por
transacción**. Es el valor central: la mitad de los predios se transó por
encima y la mitad por debajo. Robusto frente a outliers.

### `precio_m2` — «$/m² del conjunto»

Razón de totales: `sum(monto) / sum(superficie)`, con **el mismo subconjunto de
filas en numerador y denominador**. Pondera cada predio por su tamaño; responde
"cuánto costó el metro cuadrado en agregado".

### Lo que se eliminó y por qué

La versión anterior usaba `avg(monto / NULLIF("superficieTerreno", 0))`: un
**promedio de razones**, que da el mismo peso a un sitio de 5 m² que a un fundo
de 200 ha. En esta base seis predios de 1–10 m² promedian $36.041.212/m² y
arrastraban el agregado ellos solos.

> **Cambio semántico incompatible.** El campo `precio_m2` conserva el nombre
> pero cambió de fórmula (promedio de razones → razón de totales). Cualquier
> consumidor externo del endpoint verá un valor distinto para la misma
> selección. Es intencional: la fórmula anterior era incorrecta.

También se añadió un cast explícito a `float8` **antes** de dividir. Si
`monto` y `superficieTerreno` son ambos enteros en Neon, `monto / superficie`
es división entera y trunca cada razón antes de promediarla:

```sql
-- monto bigint, superficieTerreno integer
SELECT monto / NULLIF("superficieTerreno",0),  -- 3       ← truncado
       monto::float8 / "superficieTerreno";    -- 3.3333  ← correcto
```

Y el `CASE WHEN "superficieTerreno" > 0` (en vez de `NULLIF(…, 0)`) cumple dos
funciones: excluye superficies negativas y garantiza que la división nunca se
evalúe con denominador cero — en `float8` Postgres lanza `division by zero`, no
devuelve `NaN`.

## 4. Jerarquía visual

El orden del panel no es decorativo; codifica cuánta confianza merece cada cifra.

```
MEDIANA DEL MONTO                 ← number grande: el estadístico robusto
$42.000.000
Valor central de 85.763 de 85.800 transacciones con monto informado.
─────────────────────────────
PROMEDIO      $212.612.357  [5,1× la mediana]   ← distintivo ámbar
MÍNIMO        $11.111
MÁXIMO        $998.642.878.800
─────────────────────────────
$/M² TÍPICO         $…       ← mediana de razones
$/M² DEL CONJUNTO   $…       ← razón de totales
Calculado sobre 71.919 de 85.800 transacciones (83,8%) con monto y superficie.
```

- **La mediana es el número grande.** Con promedio/mediana = 5,06×, destacar el
  promedio daba una lectura irreal del mercado de suelo.
- **El promedio lleva un distintivo** cuando `avg/mediana ≥ 2` (o `≤ 0,5`), con
  `title` explicando que unas pocas transacciones extremas dominan el resultado.
- **Mín/máx son filas a todo el ancho**, no una grilla de dos columnas: los
  montos CBR llegan a 15 dígitos (`$998.642.878.800`) y desbordaban el panel
  flotante de 288 px (`w-72`).
- **Con `count = 0`** todas las métricas llegan `null` y se renderizan `—`; no
  se muestran seis `$0` indistinguibles de datos reales.

## 5. Advertencias de interpretación

Cosas que el panel **no** dice y que conviene tener presente:

- **Mín y máx son valores de control, no un rango de mercado.** El mínimo
  ($11.111, una sola fila) es un monto simbólico o nominal; el máximo
  ($998.642.878.800 ≈ US$1.000 millones por una inscripción) es casi con certeza
  un error de captura o una transferencia de cartera. Sirven para detectar
  problemas de calidad de dato, no para acotar precios.
- **La selección completa es prácticamente una foto de 2025** (83.511 de 85.800
  registros, 97,3%). Ninguna lectura de tendencia temporal sobre este panel es
  válida sin filtrar por año.
- **La superficie es de terreno** (`superficieTerreno`), no construida. El
  `$/m²` no es comparable con precios de vivienda por m² edificado.

## 6. Verificación

La consulta se validó contra un Postgres 16 desechable con un fixture de
resultados calculables a mano (`monto` `bigint`, `superficieTerreno` `integer`,
incluyendo una fila con superficie `0`, una con `monto NULL` y una con
superficie `NULL`):

| Métrica | Esperado | Obtenido |
|---|---|---|
| `count` / `count_monto` / `count_precio_m2` | 6 / 5 / 3 | ✅ 6 / 5 / 3 |
| `avg` / `mediana` / `min` / `max` | 1200 / 600 / 100 / 4000 | ✅ idénticos |
| `precio_m2` = 4400 ÷ 40 | 110 | ✅ 110 |
| `precio_m2_mediana` = mediana[10, 30, 200] | 30 | ✅ 30 |
| Fórmula antigua `avg(razones)` sobre el mismo fixture | 80 | ⚠️ 80 (sesgo confirmado) |
| Selección vacía | `count = 0`, resto `NULL` | ✅ sin error |

Para repetirlo contra producción:

```bash
curl -s -H 'Origin: https://sig.gabrielpantoja.cl' \
  'https://sig.gabrielpantoja.cl/api/stats' | jq
```

## 7. Pendiente

Del diagnóstico original quedaron sin implementar (ver
[`roadmap.md`](./roadmap.md)):

- Reemplazar mín/máx por P10/P90, o mostrar los cuatro.
- Histograma de montos en escala logarítmica dentro del panel.
- Rango temporal cubierto en el encabezado (*"85.800 transacciones · 97% de 2025"*).
- Espejar los filtros activos dentro del panel de estadísticas
  (la lógica ya existe para el cajetín de exportación, `page.tsx`).
- Notación compacta en `fmtCLP` con el valor exacto en `title`.
