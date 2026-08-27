# Plan: mapa de calor de valores y cartografía para difusión

> Redactado 2026-08-27. **Fase 1 implementada el 2026-08-27** (ver §6).
> Fases 2–4: pendientes.
> Alcance: capa de superficie de valor (`$/m²`) sobre los puntos CBR, escala de
> color, y un modo de exportación pensado para publicar en RRSS.
>
> Lee antes: [`estadisticas.md`](./estadisticas.md) (los tres denominadores y
> las dos lecturas del `$/m²`) y [`arquitectura-capas.md`](./arquitectura-capas.md).

---

## 1. Hallazgos de la investigación

### 1.1 La infraestructura ya está — no hace falta stack nuevo

Verificado contra la base de producción el 2026-08-27 con el rol `web_readonly`:

| Hecho | Valor |
|---|---|
| Postgres | 16.15 |
| PostGIS | **3.3.3 instalado** → `ST_HexagonGrid` disponible (existe desde 3.1) |
| `h3` / `h3_postgis` | 4.1.3 **disponibles pero NO instalados** (`CREATE EXTENSION` requiere owner) |
| Columna `geom` | existe, `geometry(Point,4326)`, con índice GiST `idx_referenciales_geom_gist` |
| Hexbin Santiago 250 m (`web_readonly`) | 606 celdas / 3.047 puntos en **224 ms** |
| Hexbin regional 2 km | 234 celdas / 9.797 puntos en **548 ms** |
| Hexbin ciudad 300 m (solo `destino='H'`) | 580 celdas / 3.348 puntos en **228 ms** |

Conclusión operativa: **la agregación se hace en Neon, no en el navegador.**
El cliente recibe 200–800 polígonos GeoJSON y los dibuja con el `L.geoJSON` +
`preferCanvas: true` que MapView ya usa. Cero dependencias nuevas.

### 1.2 Dos trampas que hay que evitar

**(a) Un heatmap clásico mide densidad, no valor.**
`Leaflet.heat` acumula intensidad por píxel: donde hay muchos puntos, rojo.
Con nuestros datos eso dibuja *dónde hay más inscripciones CBR* (es decir, dónde
hay más gente y más rotación), no *dónde el suelo vale más*. Son mapas
distintos y el segundo es el que el usuario cree estar viendo. La documentación
de deck.gl lo dice explícitamente: `aggregation: 'SUM'` (default) suma pesos —
para un promedio hay que usar `'MEAN'`, y aun así el resultado es un promedio
ponderado por kernel, no una mediana robusta.

Dado que el promedio/mediana de nuestros montos es **5,06×**
([`estadisticas.md` §1](./estadisticas.md)), cualquier agregación por promedio
va a estar dominada por outliers. La agregación honesta es **mediana por celda**,
y la mediana necesita bins discretos → hexágonos, no kernel continuo.

**(b) No se puede mezclar destinos en una sola escala.**
Medido hoy, `$/m²` de terreno:

| `destino` | p10 | p50 | p90 |
|---|---:|---:|---:|
| `H` (habitacional, 48.734 filas) | 68.837 | **348.997** | 800.000 |
| `A` (agrícola, 8.599 filas) | 218 | **1.337** | 7.111 |

Son **261×** de diferencia en la mediana. Una escala compartida pinta toda la
ciudad de rojo saturado y todo el campo de azul plano: cero información. La capa
**debe** filtrar por `destino` (o por lo menos usar una rampa por destino), y el
default para la vista urbana es `destino='H'`.

### 1.3 Estado del dato: `geom` está incompleto

`geom` está poblada en 74.835 de 85.800 filas (87,2%) y coincide exactamente con
`lat`/`lng` donde existe (0 discrepancias). **Pero en el Gran Santiago solo 6 de
5.029 filas tienen `geom`** — el índice GiST es inútil justo donde más densidad
hay. Además no hay índice sobre `lat`/`lng`, así que el filtro por viewport hace
seq scan de 85k filas (tolerable hoy: 150–600 ms; no escala a 500k).

---

## 2. La fórmula

Sí, basta una fórmula simple. Es esta:

```
Para cada hexágono h de arista R(zoom), en el viewport, con destino fijo D:

    n(h)   = número de transacciones en h con monto y superficie válidos
    v(h)   = mediana{ monto_i / superficieTerreno_i  :  i ∈ h }     ← $/m² típico
    color  = rampa( rank_percentil( v(h) ) )                        ← escala por cuantiles
    alpha  = clamp(0.25 + 0.75 · log(n)/log(n_max), 0.25, 1.0)      ← confianza

    se descarta h si n(h) < N_min   (N_min = 3, configurable a 5)
```

Tres decisiones que la sostienen:

- **Mediana, no promedio.** Misma razón que en el panel de estadísticas: el
  promedio de razones da el mismo peso a un sitio de 5 m² que a un fundo de
  200 ha, y seis predios de 1–10 m² ya arrastraron una vez el agregado.
- **Escala por cuantiles, no lineal.** Los deciles de `$/m²` habitacional van de
  68.837 a 1.194.774 (p98): 17× entre p10 y p90 con cola larga. Una rampa lineal
  deja el 90% del mapa en el primer color. Cuantiles (o log₁₀ si prefieres una
  leyenda con números redondos) reparten el color de forma pareja.
- **La opacidad codifica confianza, no valor.** Un hexágono con 3 ventas se ve
  translúcido; uno con 40, sólido. Esto es lo que separa un mapa profesional de
  uno decorativo: nunca pintas fuerte lo que no sabes.

`N_min = 3` es el mínimo defendible; con `N_min = 5` el mapa queda más limpio y
más honesto. Ambos deben ser parámetro y quedar impresos en la leyenda.

---

## 3. Arquitectura propuesta

### 3.1 Nuevo endpoint `GET /api/hexbins`

```
/api/hexbins?bbox=W,S,E,N&z=12&destino=H&anio=2025&metric=ppm2&min_n=3
```

Devuelve `FeatureCollection` de polígonos con propiedades
`{ n, mediana_ppm2, p25, p75, mediana_monto }`. Consulta base (probada, 224 ms):

```sql
WITH pts AS (
  SELECT ST_Transform(ST_SetSRID(ST_MakePoint(lng, lat), 4326), 3857) AS g,
         monto::float8 / "superficieTerreno" AS ppm2
  FROM referenciales
  WHERE monto IS NOT NULL AND "superficieTerreno" > 0
    AND lng BETWEEN $1 AND $3 AND lat BETWEEN $2 AND $4
    AND destino = $5
)
SELECT h.i, h.j,
       count(*)::int AS n,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY ppm2) AS mediana_ppm2,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY ppm2) AS p25,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY ppm2) AS p75,
       ST_AsGeoJSON(ST_Transform(h.geom, 4326)) AS geojson
FROM pts
JOIN LATERAL ST_HexagonGrid($6, pts.g) h ON ST_Intersects(pts.g, h.geom)
GROUP BY h.i, h.j, h.geom
HAVING count(*) >= $7;
```

Reglas del proyecto que hay que respetar: pasa por `enforce()` +
`corsHeaders()` de `src/lib/security.ts`, reutiliza `buildFilters()` de
`src/lib/filters.ts` para que la capa herede los filtros activos de la UI, y
`Cache-Control: s-maxage=3600` como los demás endpoints.

**El tamaño de celda se deriva del zoom en el servidor** (el cliente manda `z`,
no metros — así nadie pide 10 m sobre todo Chile):

| Zoom | Arista | Uso | Celdas medidas |
|---:|---:|---|---:|
| ≤ 8 | 10 km | país / macrozona | ~1.500 (nacional) |
| 9–10 | 5 km | región | — |
| 11–12 | 2 km | provincia / conurbación | 234 |
| 13–14 | 500 m | ciudad | 606 |
| 15–16 | 250 m | comuna urbana | 580 |
| ≥ 17 | 100 m | barrio | 6 (bajo `N_min`: la capa se apaga sola) |

### 3.2 Capa cliente en `MapView`

Una capa más en el patrón que ya existe: `hexbinsRef`, toggle en
`LayersControl`, refetch en `moveend`/`zoomend` con debounce ~250 ms y
`AbortController` (mismo patrón que la capa de suelos CIREN, que ya refresca por
viewport). `L.geoJSON` con `style()` que aplica la fórmula de §2. Sin
dependencias nuevas.

Interacciones mínimas:

- **hover** → tooltip: `$348.997/m² · 12 transacciones`
- **click** → panel con mediana, P25–P75 y `n`, y botón «ver las 12
  transacciones» que filtra los puntos CBR a ese hexágono.

### 3.3 Lo que NO recomiendo (y por qué)

| Opción | Veredicto |
|---|---|
| `Leaflet.heat` como capa analítica | **No.** Mide densidad. Sirve solo como capa decorativa explícitamente rotulada «densidad de inscripciones». |
| `deck.gl` + `deck.gl-leaflet` | **Todavía no.** `deck.gl-leaflet` está deprecado en favor de `@deck.gl-community/leaflet`; agrega ~300–500 kB a un bundle que hoy no tiene WebGL. Se justifica solo si llegamos al modo 3D (§5). |
| Instalar la extensión `h3` | **Después.** H3 es mejor que `ST_HexagonGrid` (grid global, jerárquico, celdas estables entre zooms), pero requiere `CREATE EXTENSION` con rol owner y no aporta nada que `ST_HexagonGrid` no dé hoy. Migración natural en fase 3. |
| Interpolación IDW / KDE continua (superficie suave) | **No para el dato duro.** Inventa valor donde no hay transacciones. Reservado para el modo póster (§5), rotulado como interpolación. |

---

## 4. Escala de color: la parte que hace el mapa bonito

Tres rampas, elegidas para verse bien **y** ser legibles por daltónicos (evitan
el eje rojo↔verde):

| Rampa | Uso | Colores |
|---|---|---|
| **Plasma** (morado→magenta→naranjo→amarillo) | default sobre base oscura; es la que se ve «cara» en RRSS | `#0d0887 #6a00a8 #b12a90 #e16462 #fca636 #f0f921` |
| **Viridis** (azul→verde→amarillo) | default sobre base clara, perceptualmente uniforme | `#440154 #414487 #2a788e #22a884 #7ad151 #fde725` |
| **Divergente sobre la mediana comunal** | «¿está caro o barato *para esta comuna*?» — azul bajo la mediana, rojo sobre | `#2166ac … #f7f7f7 … #b2182b` |

La tercera es la más interesante analíticamente y la menos común en mapas
inmobiliarios chilenos: en vez de «cuánto vale», responde «cuánto se desvía de
su entorno». Es la que da titulares.

**Mapa base.** El OSM estándar, con sus verdes de parque y azules de agua,
pelea con cualquier overlay de color (por eso los pines CBR ya son carmesí — ver
`src/lib/cbr-points.ts`). Hacía falta un lienzo neutro.

> **Corrección (2026-08-27).** La versión original de este plan daba por
> gratuitos y sin API key los basemaps CARTO Positron / Dark Matter. **Es
> falso hoy.** Comprobado contra los endpoints:
>
> | Proveedor | Resultado |
> |---|---|
> | `basemaps.cartocdn.com/light_all` | HTTP 200 pero cada tile llega **estampado «API KEY REQUIRED»** |
> | `tiles.stadiamaps.com` (Stamen) | **HTTP 401** sin key |
> | `server.arcgisonline.com` (Esri Canvas Light/Dark Gray) | Sirve sin key, CORS `*`, hasta z23 |
>
> Esri funciona, pero es exactamente el mismo tipo de endpoint legacy sin
> contrato que acaba de fallarnos con CARTO. Se descartó por riesgo de
> repetir el problema en producción.

**Solución adoptada: filtrar OSM por CSS.** Los tiles de OSM se neutralizan con
un `filter` sobre `.leaflet-tile-pane`, seleccionado por `data-basemap` en el
contenedor del mapa (`src/lib/basemap.ts` + `globals.css`):

| Tema | Filtro |
|---|---|
| claro (tipo Positron) | `grayscale(0.92) brightness(1.06) contrast(0.9)` |
| oscuro (tipo Dark Matter) | `invert(1) hue-rotate(180deg) grayscale(0.86) brightness(0.82) contrast(1.08)` |

No depende de ningún tercero nuevo, no cambia la atribución (OSM ya estaba
acreditado), funciona en todos los zooms y nadie puede desactivarlo. El mismo
filtro se replica con `ctx.filter` en `map-export.ts` para que el PNG salga
igual que la pantalla.

---

## 5. Modo póster: contenido para LinkedIn / Instagram

Ya existe `src/lib/map-export.ts` (920 líneas) que rasteriza tiles + vectores +
pines + brújula + escala + atribución a PNG. **La base está hecha.** Lo que falta
es un preset:

1. **Formatos de salida.** Hoy exporta el viewport tal cual. Agregar
   1080×1350 (IG retrato), 1080×1080 (IG feed), 1200×627 (LinkedIn), además de
   «viewport actual». Implica recalcular el encuadre, no solo recortar.
2. **Chrome de póster.** Título grande, bajada de una línea, leyenda de cuantiles
   con valores en CLP, `N_min` y cobertura declarados, marca
   `sig.gabrielpantoja.cl`, y la atribución legal abajo en cuerpo pequeño.
   Tipografía: la Geist que ya carga `layout.tsx`.
3. **Base sin etiquetas + hexágonos.** `invert` + plasma = la estética que
   funciona en feed. El texto lo pone el chrome, no el tile.
4. **Un dato que sea titular.** El póster debe llevar una cifra grande, no solo
   un mapa lindo. Ej.: *«El m² habitacional en el hexágono más caro de Temuco
   vale 14× el del más barato»* — se calcula gratis desde el mismo endpoint
   (`max(mediana_ppm2) / min(mediana_ppm2)` sobre el viewport).

Un modo 3D (columnas extruidas: altura = `n`, color = `$/m²`, estilo kepler.gl)
es la versión que más circula en RRSS, pero exige deck.gl + WebGL. Va a fase 4,
como vista aparte, no como reemplazo del mapa 2D.

---

## 6. Fases

### Fase 1 — La capa (el 80% del valor) — ✅ implementada 2026-08-27

- [x] `GET /api/hexbins` con `ST_HexagonGrid`, ladder de zoom, `N_min`, filtro
      por `destino`, integrado a `buildFilters()` y `security.ts`.
      (`src/app/api/hexbins/route.ts`)
- [x] `src/lib/hexbins.ts`: tipos, rampas, ladder zoom→arista, cortes por
      cuantiles, opacidad por confianza, atribución y disclaimer.
- [x] Capa en `MapView` (refetch por `moveend` con debounce 250 ms,
      `AbortController` y contador de secuencia) + toggle, selector de destino,
      slider de `N_min` y leyenda de cuantiles en `LayersControl`.
- [x] Tooltip (`$/m² · n transacciones`) y popup con mediana, P25–P75, `n`,
      mediana del monto, resolución y destino.
- [x] Mapa base neutro por filtro CSS sobre los tiles de OSM
      (`src/lib/basemap.ts` + `globals.css`), replicado con `ctx.filter` en
      `map-export.ts`, más la entrada de la capa en el cajetín del PNG.
      **No** se usó CARTO: exige API key (ver §4).

Verificado en navegador (Playwright, Chillán z13–14): 102 celdas de 500 m sobre
1.999 transacciones habitacionales, cortes $48k–$527k, tooltip y popup con
valores reales, en tema claro (viridis) y oscuro (plasma).

### Fase 2 — Honestidad estadística visible

- [ ] Selector de rampa manual (hoy la rampa la elige el tema: plasma en
      oscuro, viridis en claro; falta poder forzarla y añadir la divergente
      contra la mediana comunal).
- [ ] `N_min` ajustable en la UI con el efecto visible en el mapa.
- [ ] Leyenda que declara: destino, año, `N_min`, cobertura (`count_precio_m2`
      del viewport / total) — el mismo criterio de §2 de `estadisticas.md`.
- [ ] Nota fija: *«mediana de $/m² de terreno por hexágono; no es tasación»*.

### Fase 3 — Rendimiento y dato

- [ ] **Backfill de `geom`** en las 10.965 filas que la tienen `NULL`
      (crítico: hoy Santiago no usa el índice GiST). Requiere rol de escritura.
- [ ] Índice `btree (lng, lat)` o, mejor, apoyarse en el GiST ya existente una
      vez completo el backfill.
- [ ] Evaluar `CREATE EXTENSION h3` y migrar a celdas H3 (grid global,
      jerárquico, celdas estables al hacer zoom → cacheables por celda).
- [ ] Cache por tile de hexbins en el borde de Vercel.

### Fase 4 — Difusión

- [ ] Presets de exportación 1080×1350 / 1080×1080 / 1200×627.
- [ ] Chrome de póster (título, leyenda, marca, atribución).
- [ ] Cifra-titular automática desde el viewport.
- [ ] (Opcional) vista 3D con deck.gl como ruta separada.

---

## 7. Riesgos y límites que hay que escribir en la UI

- **No es una tasación.** Una mediana de 5 transacciones en 250 m no es un valor
  de mercado; es una señal. Debe decirlo la leyenda, no el pie de página.
- **La superficie es de terreno**, no construida. `superficieConstruida` existe
  en la base (43.385 filas) pero hoy no se expone; un `$/m²` construido sería
  otra métrica, no un refinamiento de ésta.
- **El 97,3% de la base es 2025.** El mapa es una foto de un año. Cualquier
  lectura de «el barrio subió» es inválida sin filtro temporal explícito, y hoy
  no hay serie suficiente para hacerla.
- **`montoUf` existe** (67.692 filas) y no se usa. Para comparar entre años, UF
  es la unidad correcta, no CLP. Vale la pena exponerla como métrica alternativa
  antes que cualquier análisis temporal.
- **PII**: el endpoint agrega, así que no hay riesgo nuevo — pero la consulta
  debe seguir seleccionando solo `monto`, `superficieTerreno`, `destino`, `lat`,
  `lng`. Nunca `comprador`, `vendedor`, `rut`, `userId`, `observaciones`.

---

## 8. Fuentes consultadas

- [PostGIS · ST_HexagonGrid](https://postgis.net/docs/ST_HexagonGrid.html)
- [deck.gl · HeatmapLayer](https://deck.gl/docs/api-reference/aggregation-layers/heatmap-layer) — `aggregation: SUM|MEAN`, `getWeight`, `colorDomain`
- [deck.gl · HexagonLayer](https://deck.gl/docs/api-reference/aggregation-layers/hexagon-layer)
- [deck.gl · Aggregation Layers overview](https://deck.gl/docs/api-reference/aggregation-layers/overview) — binning vs. continuidad
- [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) — `radius`, `blur`, `max`, `gradient`; intensidad como tercer argumento del punto
- [CARTO · A new look for Positron and Dark Matter](https://carto.com/blog/positron-dark-matter-new-look/)
- [Stamen · Introducing Positron & Dark Matter](https://stamen.com/introducing-positron-dark-matter-new-basemap-styles-for-cartodb-d02172610baa/)
- [OSM community · The free OSM-based Stamen tile layers are going away](https://community.openstreetmap.org/t/the-free-osm-based-stamen-tile-layers-are-going-away/101866)
- [UCGIS GIS&T BoK · Hot Spots and Getis-Ord Gi\* Analysis](https://gistbok-ltb.ucgis.org/25/concept/7928)
- [ArcGIS Pro · How Hot Spot Analysis (Getis-Ord Gi\*) works](https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-statistics/h-how-hot-spot-analysis-getis-ord-gi-spatial-stati.htm)
- [Felt · Understanding spatial indexes: H3 explained](https://felt.com/blog/h3-spatial-index-hexagons)
- [GEOLYTIX · What the hex? Grid aggregations with PostGIS](https://medium.com/geolytix/what-the-hex-grid-aggregations-with-postgis-a7d5feaec442)
- [zakjan/deck.gl-leaflet](https://github.com/zakjan/deck.gl-leaflet) — deprecado en favor de `@deck.gl-community/leaflet`
