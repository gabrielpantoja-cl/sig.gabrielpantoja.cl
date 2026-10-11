# Roadmap del SIG de suelo — `sig.gabrielpantoja.cl`

> Documento vivo. Última actualización: 2026-10-10.
> Próxima revisión sugerida: trimestral o cuando se cierre una fase.
>
> **¿Retomas el proyecto?** Lee primero [«Por dónde retomar»](#por-dónde-retomar):
> la cola ordenada de lo siguiente que conviene hacer. El horizonte largo está
> en [«Ruta GIS de largo plazo»](#ruta-gis-de-largo-plazo-horizontes-h1h5), y su
> relación con la investigación del autor en
> [«Alineación con la investigación»](#alineación-con-la-investigación-gabrielpantojacl).
>
> **Este proyecto es open source** ([MIT](../LICENSE)) y se desarrolla
> públicamente en https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl.
> Este documento contiene exclusivamente decisiones y prioridades publicables.

## Visión

Convertir el SIG en una plataforma **geoespacial integrada** que sirva tres públicos
simultáneamente en una sola vista: **tasación rural, ecoinformática y conservación**.

### Para tasadores / peritos rurales:
Visualizar, en una sola vista, qué es cada predio, qué se puede hacer en él, qué 
restricciones tiene y cuánto paga el mercado por predios comparables. Tres direcciones:

1. **Datos del predio**: capas rurales (Catastro Frutícola, deslindes prediales, ROL
   validado contra CIREN).
2. **Restricciones del predio**: derechos de agua, áreas protegidas, zonas de riesgo,
   erosión, bosque nativo, planes reguladores.
3. **Inteligencia de mercado**: comparador de transacciones, estadísticas con cuartiles
   (no solo promedio), series de tiempo, exportación a DXF. — *En producción: el
   mapa de calor de valor ($/m², `/api/hexbins`); fases pendientes en
   [`plan-mapa-de-calor.md`](./plan-mapa-de-calor.md).*

### Para ecoinformáticos / investigadores en conservación:
Acceder a capas de **biodiversidad, hidrología, vegetación y clima** con series temporales
para análisis de paisaje, nichos ecológicos, cambio climático y fragmentación de hábitats.
Cuatro direcciones:

1. **Bioclima e hidrología**: temperatura, precipitación, índices de aridez, ciclo del agua.
2. **Cobertura y cambios**: NDVI dinámico, uso de suelo, bosque nativo, monitoreo temporal.
3. **Eventos naturales**: incendios, inundaciones, glaciares como indicadores.
4. **Análisis espacial**: corredores biológicos, conectividad, fragmentación derivada de
   capas base.

**Las cuatro direcciones se sirven en la misma vista**, con la misma UX ya probada
(paneles flotantes, capas estáticas + dinámicas, atribución obligatoria, selectors de
rango temporal para series).

## Estado actual (al 2026-10-10)

**Quince capas en producción** (detalle técnico en
[`arquitectura-capas.md`](./arquitectura-capas.md)):

| # | Capa | Tipo | Peso |
|---|---|---|---|
| 1 | Transacciones CBR (~85k puntos) | Dinámica (Neon vía `/api/points`) | 21 MB en el cable |
| 2 | Mapa de calor de valor ($/m²) | Derivada (PostGIS `ST_HexagonGrid` + interpolación) | — |
| 3 | Propiedades rurales (CIREN) | Dinámica remota (PNG por viewport + `identify`) | — |
| 4 | Áreas protegidas (RNAP) | Estática | 6,0 MB |
| 5 | Límite urbano (PRC) | Estática | 0,9 MB |
| 6 | Límites comunales (DPA) | Estática | 2,8 MB |
| 7 | Red caminera (MOP) | Estática | 6,2 MB |
| 8 | Red de drenaje (DGA) | Estática | 13,9 MB |
| 9 | Catastro frutícola (CIREN) | Estática | 31,5 MB |
| 10 | Líneas de transmisión eléctrica | Estática | 3,1 MB |
| 11 | Recursos vegetacionales (CONAF) | Dinámica remota (PNG por viewport + `identify`) | — |
| 12 | Suelos agrológicos (CIREN) | Dinámica remota (PNG por viewport + `identify`) | — |
| 13 | Bioclima (WorldClim) | Estática, PNG reproyectado | 75 KB |
| 14 | NDVI Visual (Sentinel-2) | Dinámica remota (PNG compuesto en el servidor por viewport) | — |
| 15 | Humedales (MMA): inventario nacional + urbanos Ley 21.202 | Dinámica remota (PNG por viewport + `identify`) | — |

Además:

- **Serie mensual de NDVI** (`/api/ndvi/serie`): 36 meses de mediana, P25/P75 y
  fracción descartada para un punto o un polígono de hasta 3 km de lado.
- **Capas KML/KMZ del usuario**, procesadas en el navegador; nunca salen del
  dispositivo (`src/lib/kml.ts`; KMZ desde 2026-10-06).
- **Coordenadas del cursor** al pie del mapa (decimal, GMS y UTM 18S/19S,
  2026-10-06) y **Neutro** como mapa base por defecto.
- **Panel de capas** `LayerSidebar` (dock en escritorio, drawer en mobile, con
  buscador y grupos) e inspector «Capas activas» con opacidad por capa.
- **Selector de mapa base** (cinco fondos), **export PNG** con cajetín y
  **analítica interna sin cookies**.

`public/data/` pesa **62 MB**, la mitad del catastro frutícola: es lo que
empuja la «Migración de almacenamiento» de más abajo.

## Por dónde retomar

Cola corta y ordenada. Al cerrar un ítem, tacharlo aquí y en su sección, y
subir el siguiente. **Regla:** la deuda marcada 🔴 va antes que cualquier
capa nueva; con la 🟡 se intercala (una deuda por cada capa o función).

| # | Qué | Por qué ahora | Sección |
|---|---|---|---|
| 1 | ~~🔴 Subir `sharp` (CVE alto en producción) y correr `npm ci` local~~ ✅ 2026-10-10 | Única vulnerabilidad de `npm audit --omit=dev` | [Deuda › Seguridad](#seguridad-y-operación) |
| 1b | 🔴 Auditoría de reidentificación de `/api/points` y `/api/export` (k-anonimato de rol + fecha + monto + fojas/número) | La Ley 21.719 rige desde diciembre de 2026 y la propia propuesta doctoral lo advierte | [Investigación › Eje 1](#eje-1--el-registro-datos-calidad-y-apertura) |
| 2 | ~~🔴 Node 22 en CI + Vercel, `engines`~~ ✅ 2026-10-10 | Node 20 está fuera de soporte desde abril 2026 | [Deuda › Plataforma](#plataforma-y-release) |
| 3 | ~~🔴 Fijar el runner de CI y añadir `npm run build` al workflow~~ ✅ 2026-10-10 | `ubuntu-latest` cambia el 2026-10-19; hoy CI no compila | [Deuda › Plataforma](#plataforma-y-release) |
| 4 | ~~🟡 Etiquetar `v0.2.0`~~ ✅ 2026-10-10 | Cambio incompatible + KMZ + coordenadas sin release | [Deuda › Plataforma](#plataforma-y-release) |
| 5 | 🟡 CONAF informa su estado a la leyenda + popups inline a `map-popups.ts` | Fallas silenciosas y HTML sin tests de escape | [Deuda › Frontend](#arquitectura-del-frontend) |
| 6 | 🟢 Permalink con estado completo | Habilita compartir hallazgos; barato | [Producto](#producto-y-mercado) |
| 7 | 🟢 Escala numérica + medición | Lo pide el informe de tasación | [Herramientas SIG](#herramientas-mínimas-de-sig-que-faltan-auditoría-2026-08-28) |
| 7b | ~~🟡 Capa de humedales (Inventario Nacional + humedales urbanos Ley 21.202)~~ ✅ 2026-10-10 | Caso de estudio de la tesis | [Investigación › Eje 3](#eje-3--coberturas-humedales-bosque-nativo-y-agua) |
| 8 | 🟢 Carta IGM 1:50.000 o DEM libre (decidir juntas) | Única capa aprobada en cola; el relieve no existe hoy | [§ 1.4](#14-carta-topográfica-igm-150000-vía-mop-rest-sit---aprobada-en-cola) |
| 9 | 🟡 Dividir `LayersControl.tsx` y terminar `MapView.tsx` | Siguen creciendo (1.419 y 1.111 líneas) | [Deuda › Frontend](#arquitectura-del-frontend) |
| 10 | 🟢 Humo E2E con Playwright | Protege el export PNG y las capas remotas | [Deuda › Tests](#tests) |

## Criterios de priorización

Cada ítem se evalúa en una matriz rápida de 4 ejes (ambos públicos cuentan):

- **Valor para tasación rural** — ¿acelera una decisión del perito? (alto =
  reduce horas-hombre en gabinete, medio = contexto, bajo = nice-to-have).
- **Valor para ecoinformática** — ¿es crítico para análisis de biodiversidad,
  cambio climático, fragmentación o degradación? (alto = backbone del análisis,
  medio = contexto, bajo = enriquecimiento).
- **Accesibilidad del dato** — público, oficial, descargable en masa
  (alto), o solo accesible vía visor web/API no documentada (bajo).
- **Costo de implementación** — S (≤ 1 día), M (≤ 1 semana), L (> 1 semana
  o dependencias externas pesadas).

Reglas duras (heredadas de AGENTS.md y `arquitectura-capas.md`):

- Solo datos **públicos y oficiales**, sin PII (Ley 19.628).
- Atribución obligatoria en 3 lugares (panel, popup, meta.json).
- Nada de WMS teselado contra servidores del Estado — `L.ImageOverlay`
  con `moveend`, según la lección CIREN documentada.
- El dato geoespacial es **referencial, solo visualización**; para uso
  normativo se remite a la fuente original.

## Fase 1 — Fundamentos rurales (Q2/Q3 2026)

### 1.1 Catastro Frutícola CIREN-ODEPA — ✅ en producción (2026-07-16)

Estático desde IDE Minagri (`IDEMINAGRI/CATASTRO_FRUTICOLA`, ~95k productores).
El servicio público solo trae especie, ROL y comuna: variedad, superficie, riego
y fecha de plantación son producto comercial de CIREN. El año que se muestra es
el del **levantamiento regional**, nunca el de plantación.

### 1.2 Propiedades rurales CIREN — ✅ en producción (2026-08-28)

Capa dinámica remota (`IDEMINAGRI/PROPIEDADES_RURALES`, 14 sublayers
regionales) con búsqueda exacta por ROL + comuna y descarga de la geometría solo
del resultado elegido. Polígonos y ROL referenciales: no acreditan dominio,
deslindes ni vigencia registral. Se descartó traer la geometría a `public/data/`:
consultable no significa redistribuible.

### 1.3 Búsqueda mejorada por ROL/predio (usando la API pública CIREN)

- **Fuente**: API pública de IDE Minagri — endpoint
  `valida-rol-comuna` (`https://api-ideminagri.ciren.cl/api/validador/`).
  Accesible sin autenticación.
- **Qué agrega**: cuando el usuario escribe un ROL en el buscador,
  validar en tiempo real que (a) el ROL existe para esa comuna, (b)
  está aproximadamente en el lugar donde dice el CBR, (c) tiene
  coincidencia con la capa Catastro Frutícola si está activa. Mejora la
  confianza del "buscar por ROL" sin agregar geometría nueva.
- **Tipo**: **API de servidor** (route handler nuevo, sin nueva capa
  visual).
- **Esfuerzo**: **S-M** — añadir `src/lib/ciren-rol.ts` con rate-limit
  client-side (recomendable: cachear en memoria de proceso del route
  handler 24 h por `(rol, comuna)`); cablear en `GeocoderSearch.tsx`.
- **Riesgos**: CIREN no garantiza SLA; usar cache LRU en servidor y
  fallback silencioso al modo actual si el endpoint está caído.
- **Nota (2026-10)**: la búsqueda por ROL contra la capa de propiedades rurales
  ya existe (§ 1.2); lo que falta es validar en vivo el ROL de los puntos CBR.

### 1.4 Carta topográfica IGM 1:50.000 (vía MOP rest-sit) — 🟢 **aprobada, en cola**

> **Documentada y priorizada el 2026-09-07. Aún NO implementada.** El servicio
> se sondeó y verificó en vivo. **Decisión tomada**: entra como *capa temática
> con opacidad ajustable*. Su prerrequisito duro, la opacidad por capa, **ya
> está hecho** (2026-09-07): la capa está desbloqueada.

- **Fuente**: `https://rest-sit.mop.gob.cl/arcgis/rest/services/MAPA_BASE/IGM50/MapServer`
  — MapServer publicado por IDEMOP (MOP) con la cartografía regular del
  **Instituto Geográfico Militar a escala 1:50.000**. El propio servicio se
  declara: `copyrightText: "Instituto Geográfico Militar"` y
  `documentInfo.Title: "Mapa base IGM 50.000"`.

**Lo verificado el 2026-09-07** (dos consultas de metadata y un export; es el
mismo host que colapsó con la red vial, así que se sondeó con cuidado):

| Propiedad | Valor | Consecuencia |
|---|---|---|
| `currentVersion` | 10.21 | El mismo ArcGIS frágil de VIALIDAD: sin `f=geojson`, sin paginación |
| `capabilities` | `Map,Query,Data` | Sirve `export` e `identify`; no hay descarga masiva |
| `singleFusedMapCache` | `false` | **Sin caché de teselas**: cada request se renderiza en el momento |
| `exportTilesAllowed` | `false` | El servicio prohíbe explícitamente extraer el teselado |
| `maxRecordCount` | 1.000 | Techo por consulta, y sin paginación para saltarlo |
| `spatialReference` | 3857 nativo | No hay que reproyectar nada |
| `maxImageWidth/Height` | 4.096 | De sobra para un viewport |
| Latencia medida | metadata 0,12 s · **export 1024×683 = 675 KB en 7,2 s** | Ver «lo que hay que decidir» |
| CORS | sin `Access-Control-Allow-Origin` | El proxy en `/api/*` es obligatorio, no opcional |

Las 24 subcapas, agrupadas por lo que aportan:

- **Relieve** — `13 Curvas de Nivel` (polilínea; campos `TIPO`, `ZV2` = cota,
  `LENGTH`; visible bajo 1:250.000), `3 Puntos acotados` (cotas puntuales,
  bajo 1:100.000), `14`/`20 Fisiografía` (líneas y áreas).
- **Toponimia oficial** — `2 Nombres Geográficos` y `0 Anotaciones`. Es lo que
  ninguna otra capa del SIG tiene.
- **Hidrografía IGM** — `4` puntos, `15` líneas, `18` áreas (independiente de
  la red DGA que ya está en producción).
- **Contexto** — `17 Viario`, `6`/`21 Población`, `19 Zonas de vegetación`,
  `22 Áreas de transporte`, `23 Industria`, `9-12 DPA`.

**Qué agrega** (y es justamente lo que hoy falta):

- **Para tasación rural**: (a) **relieve** — no hay ninguna capa en el SIG que
  muestre pendiente, y la pendiente manda en el valor de un predio rural; hoy
  el perito tiene que salir a otra herramienta. (b) **Toponimia rural
  oficial** — las escrituras del Conservador describen el predio por nombre
  («predio denominado El Laurel», «sector Angachilla»), no por ROL ni por
  coordenada. La carta IGM es la fuente canónica de esos nombres en Chile y
  permite amarrar la descripción de la escritura a un lugar del mapa. En la
  prueba sobre Valdivia aparecieron decenas de nombres de sector que no están
  ni en OSM ni en la red vial MOP.
- **Para ecoinformática**: valor bajo-medio. Las curvas sirven de contexto,
  pero un análisis necesita un DEM manipulable, no una carta rasterizada (ver
  la alternativa al final).

**Tipo de capa: dinámica remota, y no por elección.** Dos bloqueos
independientes, cada uno suficiente por sí solo:

1. **Legal.** La cartografía del IGM está protegida por la Ley 17.336 de
   propiedad intelectual y se **vende** (tienda oficial: 1:50.000 y 1:250.000
   en papel, JPG, SHP y GEOTIFF), y sus condiciones exigen no separar de la
   obra la identificación del titular. Traer los vectores a `public/data/` y
   republicarlos desde un repo MIT sería redistribuir una obra que no es
   libre. Consumir la imagen renderizada por el servicio oficial del MOP, con
   la atribución «Instituto Geográfico Militar» a la vista, es la vía
   defendible — y es exactamente lo que ya hacemos con CIREN.
2. **Técnico.** Aunque fuera libre: ArcGIS 10.21, 1.000 registros por
   consulta, sin paginación, y este mismo host respondió 500 en TODO el
   servicio por más de 30 minutos tras la descarga masiva de la red vial
   (`fuentes-gis-chile.md` § ecosistema MOP). Un ETL de curvas de nivel
   nacionales lo tumbaría.

Corolario: **no escribir `scripts/build-igm.mjs`**. Esta capa es un clon del
patrón de suelos CIREN — `/api/igm/export` + `/api/igm/identify` +
`L.ImageOverlay` refrescado en `moveend` — o no es.

**Esfuerzo: S-M.** El patrón está resuelto tres veces (suelos, vegetacional,
propiedades rurales): es copiar `src/lib/suelos.ts` y `src/app/api/suelos/*`
cambiando endpoint, `layers=show:...` y leyenda. Un día si no aparece nada
raro.

**Lo que hay que decidir antes de implementar** — este es el trabajo real, no
el código:

- [x] **¿Capa temática o mapa base? → capa temática** (decidido 2026-09-07).
      Es una carta completa, no un tema: trae
      su propio relleno de suelo, hidrografía, viario y toponimia, y tapa el
      mapa base. Como entrada del `BasemapSwitcher` («Topográfico IGM») sería
      más honesta visualmente y competiría con OpenTopoMap, pero el switcher
      está construido sobre `L.TileLayer` con URL de teselas
      (`src/lib/basemap.ts`) y esto es un export por viewport a través de un
      proxy: **mecanismos distintos**. Como capa temática entra sin tocar el
      switcher, pero exige opacidad ajustable sí o sí — que hoy no existe y
      está en el backlog de la auditoría UX. **Se eligió la capa temática**:
      no fuerza al switcher a soportar dos mecanismos distintos, y la opacidad
      resuelve el problema visual que motivaba la otra opción.
- [ ] **7,2 segundos por viewport.** CIREN sano responde en ~1,2 s; esto es 6×
      más lento y sin caché de teselas del lado del servidor. Con `moveend`
      encadenados la experiencia sería mala. A evaluar: gate de zoom más alto
      que el de suelos, debounce largo, pedir solo el subconjunto útil
      (`layers=show:2,3,13,14` = relieve + nombres, que debería renderizar
      bastante más rápido que las 24) y caché en el route handler por bbox
      redondeado.
- [ ] **Qué subcapas mostrar.** Encender las 24 duplica hidrografía (ya está
      DGA), viario (ya está MOP Vialidad) y límites (ya está DPA), con
      simbologías que no coinciden. La versión útil es probablemente «curvas +
      cotas + fisiografía + nombres geográficos» y nada más.
- [ ] **Vintage.** El servicio no declara fecha de corte en su metadata, y la
      carta regular 1:50.000 tiene planchetas de épocas muy distintas. Hay que
      averiguar qué edición está cargada antes de publicar un `meta.json`, o
      declarar explícitamente «vintage no declarado por la fuente» (regla 2 de
      `fuentes-gis-chile.md`).
- [ ] **`identify` sobre curvas**: el campo de cota es `ZV2`. Confirmar unidad
      (se asume m s.n.m.) y si el clic devuelve la curva más cercana con una
      tolerancia usable.

**Alternativa complementaria — no sustituta — un DEM libre.** Si lo que se
busca es *pendiente*, el camino barato y sin ataduras es un modelo de
elevación (SRTM 30 m o Copernicus GLO-30, ambos libres y redistribuibles),
procesado como hillshade + curvas derivadas en el ETL y servido como PNG
estático, exactamente como bioclima. Sin proxy, sin dependencia de un servidor
estatal en runtime, y analizable (pendiente en grados, exposición). Lo que el
DEM **no** da es la toponimia rural oficial ni las curvas levantadas por el
IGM. Son dos capas distintas resolviendo dos necesidades distintas, y conviene
decidirlas juntas:

| | IGM 50.000 (vía MOP) | DEM libre (SRTM / Copernicus) |
|---|---|---|
| Relieve | Curvas oficiales, rasterizadas | Hillshade + pendiente calculable |
| Toponimia rural | **Sí, canónica** | No |
| Licencia | IGM, Ley 17.336 — solo visualización vía el servicio oficial | Libre, redistribuible |
| Runtime | Proxy + ~7 s por viewport | PNG estático, cero dependencias |
| Esfuerzo | S-M | M (el ETL raster ya se aprendió en bioclima) |

## Fase 2 — Restricciones del predio (Q3/Q4 2026)

### 2.1 Inventario Nacional de Erosión de Suelos (CIREN, GeoNode público)

- **Fuente**: <https://inventarioerosion.ciren.cl/> — instancia GeoNode
  (cartografía digital y mapas públicos). Cobertura progresiva
  O'Higgins → Los Lagos; el resto del país en vías.
- **Qué agrega**: erosión actual (estado) y potencial (riesgo), en
  ton/ha/año, con categorías estandarizadas.
  - **Para tasación**: crucial para predios con pendiente (afecta productividad).
  - **Para ecoinformática**: indicador de degradación de suelos, susceptibilidad
    a cambio climático, y pérdida de servicios ecosistémicos.
- **Tipo de capa esperada**: **estática** (descarga WFS → GeoJSON + el
  ETL habitual de mapshaper) si el GeoNode lo soporta, o **dinámica
  remota** estilo CIREN-suelos si el dataset pesa > 50 MB.
- **Esfuerzo**: **M** — clon del patrón de la receta en
  `arquitectura-capas.md`; validar tamaño y rendimiento del GeoNode
  (`/services/?limit=5` lista los WMS/WFS publicados).
- **Riesgo**: cobertura incompleta nacional → mostrar siempre un aviso
  en el panel ("Cobertura: O'Higgins a Los Lagos") y deshabilitar el
  resto.

### 2.2 Derechos de aprovechamiento de aguas (DGA) — 🔍 INVESTIGACIÓN

> **Status: 2026-10-05** — La **red de drenaje DGA** (ríos + esteros, ~35,5k
> tramos) ya está en producción. Sigue en investigación el resto del contexto
> hídrico (glaciares SNIA, cuencas como polígono); `scripts/build-derechos-agua.mjs`
> es todavía un stub. Los derechos individuales quedan como link-outs.

- **Fuente**: Catastro Público de Aguas, 12 registros públicos
  disponibles en <https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/>,
  visualizadores nacionales:
  - Visualizador Hidrométrico Nacional: <https://vipnet.mop.gob.cl/>
  - Hidrolínea: <https://snia.mop.gob.cl/sat/site/informes/mapas/mapas.xhtml>
  - Estadística Hidrométrica: <https://mapas2.mop.gob.cl/>
  - Inventario Público de Glaciares: <https://snia.mop.gob.cl/observatorio/>
- **Qué agrega**:
  - **Para tasación rural**: el derecho de agua es tanto o más decisivo que el suelo mismo.
    Visualizar puntos de captación, derechos consuntivos/no consuntivos, permanentes/eventuales,
    y el estado de la cuenca.
  - **Para ecoinformática**: los glaciares son indicadores clave de cambio climático;
    la red hidrográfica es la columna vertebral del análisis de conectividad y ciclo
    de agua; las cuencas permiten análisis hidrológico integrado.
- **Tipo de capa esperada**: **mixta** — los *registros de derechos individuales* se
  consultan por expediente y probablemente no hay endpoint masivo; lo que sí existe
  público es **glaciares** (SNIA, formato WFS) y **red hidrográfica nacional**
  (probablemente en geoportal.cl). Tratar esa primera entrega como "contexto hídrico"
  (glaciares, cauces DGA, cuencas) y dejar el query por expediente a un link-out del popup.
- **Esfuerzo**: **L** — evaluar primero qué de DGA está realmente servido como WFS
  masivo y qué no.
- **Riesgo**: cada registro de derechos es un expediente (PDF + shapefile individual);
  abrirlos y consolidar es un proyecto en sí mismo. Reencuadrar la Fase 2.2 como
  *"capa de contexto hídrico (glaciares + red de drenaje)"* y dejar la integración
  de expedientes individuales para una fase posterior si el valor lo justifica.

### 2.3 SERNAGEOMIN — Peligros geológicos (remociones en masa, volcanismo)

- **Fuente**: SERNAGEOMIN vía portal geológico (no accesible durante
  este inventario; espejo histórico en `ideserver.sma.gob.cl`,
  mencionado en `fuentes-gis-chile.md:51`).
- **Qué agrega**: zonas de restricción de uso por riesgo geológico,
  relevant para peritaje en zonas cordilleranas y/o post-incendio.
- **Tipo**: **estática** si se obtiene shapefile consolidado, **dinámica
  remota** si solo se accede vía servicio.
- **Esfuerzo**: **L** — el endpoint directo está intermitente; hay
  que identificar el canal estable de descarga.
- **Riesgo**: si SERNAGEOMIN no ofrece canal masivo público, evaluar
  el **espejo SMA** (ya documentado) o posponer.

## Fase 3 — Densificación (Q1/Q2 2027)

### 3.1 SII cartografía predial

- **Fuente**: <https://mapas.sii.cl/> (consulta público de roles,
  avalúos y áreas homogéneas por manzana).
- **Qué agrega**: la fuente oficial del ROL. Permite **validar el
  destino SII** del predio contra el destino declarado en el CBR y
  referenciar el avalúo fiscal desde el popup (no exponemos el
  monto; sí un "Ver avalúo fiscal en SII →").
- **Tipo**: **link-out** en popup + opcional enriquecimiento servidor
  via API pública si la hay.
- **Esfuerzo**: **S-M**.

### 3.2 CONAF — Catastro vegetacional — ✅ en producción (2026-08-22)

Capa dinámica remota (PNG por viewport + `identify` de uso, subuso, estructura,
cobertura y especies dominantes), con vintages regionales 2014–2024 a la vista.
Pendiente: series de cambio de uso desde SIMEF (<https://simef.minagri.gob.cl/>).

### 3.3 SHOA — Línea de costa oficial

- **Fuente**: SHOA cartas náuticas / línea de costa.
- **Qué agrega**: borde costero oficial, fundamental para predios con
  frente de mar (tasación de playa, leyes de concesiones marítimas).
- **Tipo**: **estática** (vector).
- **Esfuerzo**: **S** si la descarga está disponible, **M** si hay que
  generarla desde cartas.
- **Riesgo**: hoy `shoa.cl` no expone un endpoint claro durante este
  inventario; verificar canal antes de comprometer.

## Fase 4 — Largo plazo (segundo semestre 2027+)

### 4.1 INE — Manzanas censales y entidades pobladas (Censo 2024)

- **Fuente**: <https://geoine-ine-chile.opendata.arcgis.com/>.
- **Valor**: densidad/contexto demográfico, áreas urbanas/
  ruralesINE según definición censal (overlay interesante con la capa
  de límite urbano existente).
- **Tipo**: **estática**.
- **Esfuerzo**: **S-M**.

### 4.2 SNIA — Inventario Público de Glaciares (parte DGA Fase 2)

- Lo que no se pudo empaquetar en la fase 2.2 entra acá si el valor
  para la tasación es significativo.

### 4.3 CIREN — Ortoimágenes históricas (fotomosaicos PAF)

- **Fuente**: <https://www.ciren.cl/productos/fotmosaicos-paf/>.
- **Qué agrega**: una capa raster histórica (referencia visual) para
  ver la evolución de cobertura de un mismo potrero. Útil para
  acreditar bien aéreo e historia predial.
- **Tipo**: **raster** servido como `L.ImageOverlay` por tiles
  pre-generados (no en vivo, ya que son imágenes estáticas).
- **Esfuerzo**: **L** — la cobertura geográfica es parcial (los PAF
  son proyectos específicos); requiere cuidadoso manejo de licencias
  (muchos PAF son de pago).

### 4.4 ODEPA — Tablas de apoyo (no son capas, pero alimentan el SIG)

- *Base de datos infraestructura frutícola* (descarga directa desde
  `bibliotecadigital.odepa.gob.cl`, datos 1999–2025) → integrar como
  autocomplete / enriquecimiento del popup de los puntos CBR
  identificados con Catastro Frutícola (capacidad de packing,
  frigorífico, agroindustria cercanos).
- *Directorio Agroindustria Hortofrutícola Ciren-Odepa* (descarga
  XLSX directa, datos 2017–2019) → segunda tabla de enriquecimiento.

## Fase 5 — Ecoinformática & Análisis de paisaje (Q4 2026 — Q1/Q2 2027)

**Núcleo de capas dedicadas a biodiversidad, conservación e investigación ambiental.**
Todas las capas de esta fase agregan valor a los dos públicos: contexto ambiental
para la tasación rural, y base de análisis para la ecoinformática.

> **Progreso: 2 de 5.** Bioclima (§ 5.1) y NDVI (§ 5.2) están en producción.
> El siguiente candidato es § 5.3a (incendios), que reutiliza la serie temporal
> de NDVI para leer la recuperación post-fuego.
>
> **Lecciones de 5.1 y 5.2 que aplican al resto de la fase:**
> 1. Antes de montar un servicio por viewport, calcular cuánto pesa el recorte:
>    un raster pintado en el ETL puede pesar 75 KB para todo Chile.
> 2. Todo raster servido como `L.ImageOverlay` va **reproyectado a Web
>    Mercator**, o queda corrido en latitud (bioclima salió 287 km al sur).
> 3. Verificar contra una **costa o frontera concreta**; una isla es el mejor
>    testigo. «Se ve razonable» no detecta desfases que son cero en los bordes.
> 4. Nunca confiar en las banderas de metadatos de una fuente satelital sin
>    medirlas (el offset BOA de Sentinel-2 venía mal declarado en ~4 % de escenas).

### 5.1 Bioclima (WorldClim 2.1) — ✅ en producción (2026-09-03)

Temperatura media anual (BIO1) y precipitación anual (BIO12), climatología
1970–2000 a 2,5′, como PNG estático recortado a Chile (75 KB entre ambas), con
selector de variable, opacidad, leyenda y export PNG. Rampa compartida entre ETL
y leyenda (`src/lib/bioclima-ramp.json`). Detalle de diseño en `AGENTS.md` y
`arquitectura-capas.md`.

**Lo que falta:**

- [ ] **Consulta puntual**: clic → «1.240 mm/año · 11,3 °C». El PNG solo guarda
      color; hace falta publicar los valores crudos (Int16 recortado, ~400 KB
      por variable) y cargarlos al primer clic.
- [ ] **En el sur, la precipitación se confunde con el mar.** Los tramos altos
      de la rampa son azules, como el agua de OpenStreetMap. Correr esos tramos
      hacia violeta/turquesa, o sugerir el mapa base «Neutro» al encenderla.

### 5.2 NDVI (Sentinel-2) — ✅ en producción (2026-09-17 / 2026-09-27)

Se hizo con **Sentinel-2 L2A a 10 m** (COG en AWS Open Data, catálogo STAC de
Element 84) en vez del MODIS de 500 m previsto: a escala predial MODIS no sirve.
Dos entregas:

- **Serie mensual** (`/api/ndvi/serie`, 2026-09-17): 36 meses de mediana,
  P25/P75 y fracción descartada para un punto o un polígono de hasta 3 km.
  Máscara SCL + filtro de neblina (azul > 0,10) + compuesto de máximo valor
  mensual; meses sin dato quedan como hueco, nunca interpolados.
- **NDVI Visual** (`/api/ndvi/export`, 2026-09-27): PNG por viewport desde
  zoom 10, escena más despejada por grilla MGRS, rampa compartida con la
  leyenda (`src/lib/ndvi-ramp.json`).

**Lo que falta:**

- [ ] Selector de fecha en NDVI Visual (hoy: escenas de los últimos 45 días).
- [ ] Serie larga 2000–presente con MODIS como contexto regional, si el uso
      lo justifica (las cifras de analítica dirán si la serie se usa).

### 5.3 Eventos naturales: Incendios + Inundaciones

#### 5.3a Incendios históricos (FIRMS NASA + CONAF Catastro)

- **Fuente**: FIRMS (<https://firms.modaps.eosdis.nasa.gov/>) exporta VIIRS/MODIS
  hotspots diarios (2012–presente); CONAF publica polígonos quemados anuales
  (<https://www.conaf.cl/incendios-forestales/informacion-de-utilidad/>).
- **Qué agrega**:
  - **Para tasación**: documentar si predio está en zona de riesgo alto de incendios,
    o tuvo quema reciente (afecta seguros, crédito, productividad).
  - **Para ecoinformática**: eventos de perturbación; analizar patrones espaciales,
    tendencias de frecuencia/severidad, recuperación post-fuego (sobreposición con
    NDVI timeline).
- **Tipo**: **puntos dinámicos + polígonos históricos estáticos**. Puntos FIRMS como
  marcadores con popup "fecha, confianza, potencia radiativa"; polígonos CONAF por
  año (estilo choropleth por año de quema).
- **Esfuerzo**: **M** — FIRMS es API fácil pero requiere ingesta de 12 años de
  datos; CONAF shapefile descargable; cruzar y simplificar.

#### 5.3b Inundaciones recientes (ECHOE Chile + DGA Alerta)

- **Fuente**: ECHOE (<https://www.echochile.cl/>) publica análisis de eventos de
  inundación; DGA exposición de eventos críticos por cuenca.
- **Qué agrega**: contexto de riesgo hidrológico, eventos documentados de desastre
  natural.
- **Tipo**: **polígonos de evento + timeline limitado** (últimos 10 años).
- **Esfuerzo**: **S-M** (es parcialmente manual, pero disponible en geoportal.cl).

### 5.4 Corredores biológicos y fragmentación de hábitat (derivado)

- **Fuente**: derivado de Áreas Protegidas (MMA) + Recursos vegetacionales (CONAF, ya en producción)
  + DTM (GEBCO/SRTM para resistencia de elevación).
- **Qué agrega**:
  - **Para tasación**: identifica si predio conecta ecosistemas protegidos (valor
    de conservación, potencial pago por servicios ecosistémicos).
  - **Para ecoinformática**: FUNDAMENTAL para análisis de conectividad, fragmentación,
    dispersión de especies. Usar algoritmos de least-cost paths (PostGIS + una librería
    como `gdal_translate` + `r.cost`) para derivar índices de centralidad/resistencia.
- **Tipo de capa esperada**: **estática vectorial** — polígonos/líneas de corredores
  coloreados por calidad (ancho, densidad de cobertura nativa, pendiente).
- **Esfuerzo**: **M** — es PostGIS avanzado (connectivity analysis con movimiento), pero
  la receta está en `docs/arquitectura-capas.md`; reutilizar patrón de otras capas derivadas.
- **Nota metodológica**: este análisis es exactamente lo que hizo Horacio Samaniego con
  su spatial Durbin model — aplicar esa lección aquí: la fragmentación del hábitat
  (distancia a protegidas, ancho de corredor) es un predictor de precio más robusto que
  la precipitación cruda. Documentar en el popup.

### 5.5 Series climáticas futuras (CMIP6 downscaled, opcional)

- **Fuente**: ClimateChile (<https://www.climatechile.cl/>, datos CMIP6 downscaleados
  a 5 km para escenarios SSP1-2.6, SSP2-4.5, SSP5-8.5).
- **Qué agrega**: proyecciones de cambio climático (temp, precip) a 2050, 2070, 2100.
- **Tipo**: **raster estático multi-escenario** con UI de selector de escenario + década.
- **Esfuerzo**: **L** — si ClimateChile expone descarga directa; M si hay que
  descargar/reempaquetar de CMIP6 crudo.
- **Prioridad**: posponer a Fase 6; Fase 5 se centra en observado + índices derivados.

## Fase 6 — Biodiversidad (Q2 2027+)

Capas de distribuciones de especies, endemismos, y datos de biodiversidad observada.
Estas son más caras (requieren ingesta de datos de terceros: eBird, FloraChile, SiBB)
y tienen lag de actualización. Propias de ecoinformática pura, no tanto de tasación.

### 6.1 Distribuciones de especies (eBird, FloraChile, SiBB)

- **Fuente**: eBird (<https://ebird.org/>, descargable por región), FloraChile
  (<https://www.florachile.cl/>, repositorio de plantas nativas), SiBB
  (<https://sibchia.mma.gob.cl/>, Sistema de Información de Biodiversidad).
- **Qué agrega**: heatmaps de riqueza de especies (aves, plantas), endemismos,
  nichos observados. Análisis de qué especies coexisten en un predio.
- **Tipo**: **puntos de observación estáticos** + **heatmaps derivados de densidad**.
- **Esfuerzo**: **M** (cada fuente tiene ciclo de ingesta diferente; eBird es
  mensual, FloraChile anual, SiBB irregular).

---

## Backlog sin priorizar

Ítems identificados en este recorrido que **no entran en las fases
anteriores** por ahora. Marcar con `[ ]` cuando se evalúe de nuevo.

- [ ] **ODEPA Sistema de Catastros superficie frutícola regional**
      (visor interactivo `reportes.odepa.gob.cl`) — más analítica que
      geomántica; podría reusarse como link-out desde el popup.
- [ ] **Catastro vitícola nacional SAG (Ley 18.455)** — página ODEPA
      remite; subset del Catastro Frutícola pero con zonificación y
      denominaciones de origen (útil para viñas, no para frutales
      generales).
- [ ] **SMA espejo de capas** (`ideserver.sma.gob.cl`) — usar solo
      como fallback documentado si la fuente primaria está caída (ya
      está la regla en `fuentes-gis-chile.md:51`).
- [ ] **CONAF ENCCRV** (Estrategia Nacional de Cambio Climático y
      Recursos Vegetacionales) — más relevante para reporting
      ambiental que para tasación; pospuesto.
- [ ] **MOP GEOMOP — direcciones no viales** (DOH, DOP, Concesiones,
      Aeropuertos) — útil si en el futuro la app quiere mostrar
      infraestructura pública cercana; sin valor inmediato para
      tasación rural.
- [ ] **Geoportal.cl / IDE Chile catálogo general** — referencia
      permanente para descubrir nuevas capas publicadas por
      ministerios no considerados en este roadmap.

## Migración de almacenamiento de GeoJSON (planeada Q4-2026)

**Hoy**: los GeoJSON están commiteados en `public/data/` (62 MB). Cada `npm run data:build:<capa>` los regenera desde fuentes
oficiales; los manifests `*.meta.json` van junto. La receta está en
`docs/arquitectura-capas.md` y funciona, pero tiene tres problemas que nos
empujan a migrar:

1. **Tamaño del repo en GitHub**: hoy 62 MB totales. La capa Catastro
   Frutícola pesa ~31,5 MB y podría crecer a 50–80 MB cuando CIREN libere el
   próximo catastro. GitHub avisa desde los 50 MB por archivo y bloquea
   desde 100 MB. Si el repo gana tracción, clonar el árbol completo
   empieza a ser molesto.
2. **Git LFS no escala bien aquí**: funciona, pero ocupa ancho de banda de
   la cuota gratuita de LFS (1 GB/mes en GitHub Free) y los punteros
   ensucian el historial. Pasa a ser un dolor de cabeza si una capa
   pasa de 50 MB a 500 MB.
3. **Optimizaciones del pipeline**: queremos convertir las capas grandes a
   **PMTiles** o **Vector Tiles** en el ETL (formato binario con
   range-request HTTP, renderizado nativo en Leaflet/MapLibre). Eso
   generará artefactos `.pbf`, `.mbtiles`, `.pmtiles` aún más grandes que
   los GeoJSON actuales — definitivamente no caben en git.

**Decisión (target)**: mover el output del ETL a un bucket externo (R2 / S3
/ GCS), entregar vía CDN/cloudfront-style, y dejar en el repo solo:

- `public/data/<capa>.meta.json` — el manifiesto de procedencia (es un
  contrato pequeño, no los datos).
- `scripts/build-<capa>.mjs` — el ETL reproducible.
- Una URL pública por capa (versionada por fecha de build) en el meta.json.

**Pasos concretos (cuando se inicie)**:

1. Definir el proveedor (R2 / S3 / Vercel Blob). Costo mensual esperado
   despreciable para < 1 GB total.
2. Mover los `public/data/*.geojson` al bucket. Mantener los `*.meta.json`
   en el repo (son pequeños y versionarlos en git es útil).
3. Cambiar `MapView.tsx` para que las capas estáticas se carguen desde
   una URL configurable (env var `NEXT_PUBLIC_LAYER_BASE_URL`).
4. Los scripts ETL suben al bucket y actualizan el `meta.json` con la URL
   resultante (CI / GitHub Action si se quiere automatizar).
5. Documentar en `docs/arquitectura-capas.md` que el output del ETL ya
   no va al repo.

**Backwards compat durante la migración**: mantener un fallback que lea
del path local (`/data/<capa>.geojson`) si la URL externa falla. Útil
para desarrollo offline y para los clones existentes.

**Esfuerzo**: M (1 sprint). Depende de haber elegido proveedor y tener el
acceso a Vercel configurado. Se hace junto con la siguiente capa grande
del roadmap (probablemente Predios Rurales CIREN o Catastro Frutícola
actualizado), no como tarea aislada.

## Mejoras no-capa (UX y producto) — independiente de las fases

Estas se entrelazan con cualquier fase; el orden propuesto prioriza las
que amplían el uso diario del perito:

> **Auditoría de uso 2026-08-28** — una sesión de inspección del visor con
> criterio de usuario avanzado de SIG levantó 14 hallazgos con evidencia,
> desde un export PNG roto hasta la ausencia de lectura de coordenadas.
> Detalle, causa raíz y prioridades en
> [`auditoria-ux-2026-08.md`](./auditoria-ux-2026-08.md). Los ítems que
> siguen incorporan sus conclusiones.

### Export PNG (auditoría 2026-08-28)

- [x] **El export a PNG estaba roto** — corregido el 2026-08-28 (tres fallos
      encadenados; detalle en `CHANGELOG.md`).
- [ ] **Fidelidad del PNG**: las burbujas de clúster se exportan en azul plano
      mientras en pantalla se colorean por conteo (verde/amarillo/naranja).
- [ ] **Prueba de humo del export**: tres bugs distintos convivieron en esa
      ruta sin que nada los ejercitara. Desde el 2026-10-05 el cajetín
      (`src/lib/export-metadata.ts`) tiene tests unitarios; la rasterización
      sigue sin cobertura.

### Herramientas mínimas de SIG que faltan (auditoría 2026-08-28)

- [~] **Lectura de coordenadas** del cursor en lat/lon y **UTM 19S**
      (EPSG:32719, el huso de los deslindes y de las coordenadas del
      Conservador), con copiar al portapapeles. Es la otra mitad de
      «Búsqueda por coordenadas», más abajo.
      *Hecho (2026-10-06)*: renglón al pie con decimal, GMS y UTM 18S/19S
      (`src/lib/coordenadas.ts`, con tests). *Pendiente*: copiar al
      portapapeles (clic derecho o atajo) y una lectura equivalente en
      pantallas táctiles, donde hoy se oculta.
- [ ] **Escala numérica** (`1:25.000`) junto a la barra gráfica, en pantalla
      y en el PNG: el informe de tasación la cita.
- [ ] **Medición** de distancias y superficies (m/km, m²/ha), fijable para
      que salga en el PNG exportado.
- [x] **Opacidad por capa** — 2026-09-07, en «Capas activas». El alfa del
      mapa de calor no se toca: codifica soporte de datos.
- [ ] **Reordenar capas** (o al menos «traer al frente»): el apilado de
      `reorderOverlays()` es fijo.

### Leyendas (auditoría 2026-08-28)

- [x] **Lectura de capas activas integrada al inspector**, con **solo las capas
      temáticas encendidas** (2026-09-07). Catálogo y lectura comparten una
      tarjeta en dos columnas de escritorio y dos pestañas en móvil; reutiliza
      el mismo catálogo de escalas, controles y atribuciones.
- [x] **El mapa de calor muestra su leyenda por defecto** en «Capas activas»
      (2026-09-07).
- [ ] **Señalar visualmente el n bajo**: con 2 celdas y 4 transacciones la
      superficie se dibuja igual de suave que con miles. Degradar el render
      o avisar sobre el mapa bajo cierto umbral.

### Analítica

- [x] **Sistema de Analítica y Telemetría Interna (Privacy-First)**: medir uso
      agregado, interacción con funciones (por ejemplo, consultas NDVI y
      exportaciones) y ubicación general mediante un sistema interno,
      independiente, sin cookies y sin dependencia de proveedores externos.
      Diseñar la recopilación y retención conforme a la Ley 19.628 y preparar
      el cumplimiento de la próxima Ley 21.719.
      *Hecho 2026-10-04/05*: eventos del navegador por `sendBeacon` y acceso a
      la API de datos registrado desde `src/proxy.ts`; esquema aislado con rol
      propio, sin IP ni valores de filtros, retención 13 meses. Reporte:
      `npm run analytics:report`. Diseño completo en `AGENTS.md`.
      *Pendiente*: panel web del reporte (hoy es CLI) y usar las cifras de
      `boot` para priorizar «Aligerar la carga».

### Accesibilidad y mobile (auditoría 2026-08-28)

- [ ] **Completar el patrón combobox del geocoder**: las sugerencias no
      llevan `role="option"` ni hay `aria-activedescendant`, así que para un
      lector de pantalla el listbox está vacío. Sacar también la atribución
      de dentro del `<ul>`.
- [ ] **Un solo geocoder en el DOM**: hoy se renderizan la variante mobile y
      la desktop a la vez, con la misma etiqueta accesible.
      *Confirmado en producción el 2026-09-03*: apuntar al buscador por su
      etiqueta accesible devuelve dos nodos, y el primero del DOM es
      precisamente el que está oculto por CSS. Un lector de pantalla anuncia dos
      buscadores idénticos, y cualquier automatización que tome «el primero»
      toma el invisible.
- [x] **Panel de capas como drawer inferior en mobile** — 2026-09-27,
      `LayerSidebar.tsx` (dock de 320 px en escritorio, drawer de `70vh` en
      mobile, con buscador y grupos).
- [ ] **Repartir el borde inferior en mobile**: atribución, escala, chip de
      mapa base y FAB se superponen.

### Producto y mercado

- [ ] **Comparador de transacciones lado a lado**: cuando el usuario
      abre el popup de un CBR, permitir comparar hasta 3 transacciones
      comparables (misma comuna + rango de superficie + mismo destino)
      en una vista expandida del `InfoPanel.tsx`. Cubre "inteligencia
      de mercado" sin agregar capas nuevas.
- [~] **Estadísticas con distribución** (no solo promedio/suma).
      *Hecho (2026-08-26)*: denominadores reales por métrica, `$/m²`
      como razón de totales + mediana de razones, y mediana promovida a
      cifra principal con marca de asimetría. Ver
      [`estadisticas.md`](./estadisticas.md).
      *Pendiente*: percentiles 25/75 (o P10/P90 en lugar de mín/máx),
      histograma de montos en escala logarítmica, rango temporal
      cubierto en el encabezado, filtros activos espejados dentro del
      panel, y notación compacta en `fmtCLP` con el valor exacto en
      `title` (hoy `$998.642.878.800` desborda el panel de 288 px).
- [ ] **Series de tiempo**: mini-chart de `monto` por `año` por
      comuna y por destino. Server-side barato, UI es lo caro.
- [ ] **Búsqueda por coordenadas**: pegar lat/lng o click derecho para
      centrar — útil cuando el perito tiene coordenadas del conservador.
- [ ] **Export DXF** (AutoCAD) del viewport + el punto seleccionado con
      capas activas: para peritos que llevan la información a su
      software CAD. Complemento al export CSV/GeoJSON ya existente.
- [ ] **Permalink con estado completo** (filtros, capas, zoom, marker
      seleccionado): hoy el URL no captura la sesión. Es un cambio
      chico pero habilita compartir hallazgos.
- [ ] **Modo "imprimir" / PDF** de la vista con leyenda: para anexar
      al informe de tasación.
- [ ] **Reverso del geocoder**: click derecho sobre cualquier punto
      CBR para pedir la dirección/nombre de camino más cercano
      (Nominatim inverso).
- [ ] **Comparativa de avalúo fiscal** (cuando se integre SII):
      mostrar relación monto CBR / avalúo fiscal como métrica
      contextual.
- [ ] **Soporte para capas raster del usuario**: hoy se aceptan KML
      (vectoriales). Aceptar GeoTIFF/PNG con georreferencia para
      facilitar overlays de anteproyectos del perito.
- [ ] **Aligerar la carga** (auditoría 2026-08-28): `/api/points` devuelve
      21,4 MB de JSON y las capas estáticas suman 5,6 MB cuando se encienden
      cinco, todo descargado completo antes de pintar. El arranque medido
      hoy es bueno (~1,0 s), así que es un techo, no una urgencia: se ataca
      junto con la «Migración de almacenamiento de GeoJSON» de Q4-2026,
      evaluando carga por viewport o teselado vectorial. Vía barata previa:
      acortar los nombres de campo en el payload de `/api/points`.

## Deuda técnica (revisiones 2026-10-05 y 2026-10-10)

Una revisión del código fuente cerró la mayor parte de lo que encontró
(dependencias vulnerables, rate limiters sin evicción, comodines en `ILIKE`,
proxies ArcGIS duplicados, contrato de error NDVI, una carrera al apagar capas
GeoJSON, un `javascript:` posible en un popup, Vitest y la división de
`MapView`/`page.tsx` en hooks; detalle en `CHANGELOG.md`). Lo que sigue quedó
pendiente, ordenado por prioridad. La revisión del 2026-10-10 verificó cada
ítem contra el código y sumó los marcados *(nuevo)*.

Leyenda de severidad: 🔴 bloquea o expone (hacer antes que cualquier capa) ·
🟡 frena el desarrollo (intercalar) · 🟢 mejora la calidad (cuando toque).

### Plataforma y release

- [x] **Etiquetar `v0.2.0`** — hecho el 2026-10-10 (tag + release en GitHub). `/api/ndvi/serie` cambió su cuerpo de error
      (`codigo`/`mensaje` → `code`/`message`): es incompatible, así que no
      corresponde un parche. Desde entonces se sumaron KMZ, coordenadas del
      cursor y el fondo Neutro, que también son MENOR. Subir `package.json` y
      `src/lib/version.ts`, fechar la sección «No publicado» del
      `CHANGELOG.md`, actualizar `CITATION.cff` y crear el tag (y el release
      en GitHub: hoy no hay ninguno publicado).
- [x] **Salir de Node 20** — hecho el 2026-10-10: CI en `22.x`, `engines.node: 22.x` (Vercel lo lee) y `@types/node` 22. Vitest 5 queda desbloqueado, sin migrar. Texto original: (fin de vida: abril de 2026). CI corre `20.x`; hay
      que pasar a Node 22 en `.github/workflows/lint.yml`, en la configuración
      del proyecto en Vercel (tienen que coincidir) y en `@types/node` (hoy
      `^20`), y declarar `engines.node`. Desbloquea Vitest 5, que exige
      Node ≥ 22.12.
- [x] **Runner de CI** — fijado en `ubuntu-24.04` el 2026-10-10. Pendiente: probar Ubuntu 26 en una rama y subirlo en su propio commit. `ubuntu-latest` pasa a Ubuntu 26 desde el
      2026-10-19. Fijar `ubuntu-24.04` antes de esa fecha y migrar con calma.
- [x] **CI no compila** — resuelto el 2026-10-10: el workflow ejecuta `npm run build` sin secretos. El workflow corre lint, typecheck y
      tests, pero nunca `npm run build`: un error que solo aparece al
      compilar (rutas, `server-only`, prerender) llega a Vercel sin aviso.
      Añadir el paso (sin variables de entorno, las rutas deben tolerar su
      ausencia en build).
- [ ] 🟡 **Vulnerabilidades de desarrollo**: `npm audit` (sin `--omit=dev`)
      reporta `file-type`, `image-size` y `adm-zip` vía `mapshaper`, y
      `braces` vía `@next/eslint-plugin-next`. Solo afectan al ETL local y al
      lint, no a producción; el arreglo automático baja `mapshaper` a 0.6
      (incompatible). Esperar versiones corregidas; revisar en cada bump de
      Dependabot.
- [ ] 🟡 **npm 10.x falla al instalar dependencias nuevas** (`Cannot read
      properties of null (reading 'edgesOut')`, bug del resolvedor de peers).
      Con `npx npm@11 install …` funciona y el lockfile resultante lo acepta
      `npm ci` de npm 10. Fijar la versión con `packageManager` en
      `package.json` junto con el paso a Node 22.
      *Nota 2026-10-10*: no se fijó `packageManager` (Vercel solo lo respeta
      con corepack experimental). Para agregar dependencias usar
      `npx npm@11 install …` y luego `npm install --package-lock-only` con el
      npm de Node 22, que deja el lockfile en la forma que espera CI.
- [ ] 🟢 **Releases automáticos** *(nuevo)*: un workflow que, al empujar un
      tag `v*`, cree el release de GitHub con la sección correspondiente del
      `CHANGELOG.md`. Evita que versión, tag y changelog se desalineen.

### Higiene del repositorio público *(nuevo, 2026-10-10)*

- [x] **Historia de `main` reescrita** (2026-10). `main`, el tag `v0.1.0` y
      las ramas remotas apuntan a la historia vigente; las ramas viejas de
      Dependabot se borraron.
- [ ] 🔴 **Clones antiguos** (cualquier copia anterior a la reescritura) no
      deben volver a empujar ramas ni tags previos: harían reaparecer la
      historia anterior. En cada clon: `git fetch --prune --force`,
      `git reset --hard origin/main` y borrar ramas locales previas.
- [ ] 🟡 **Escaneo de secretos y código en CI**: activar *secret scanning* +
      *push protection* en la configuración del repo y añadir CodeQL (o
      `gitleaks`) como workflow. Hoy la única barrera es la disciplina.
- [ ] 🟢 **Política de mensajes de commit**: anotar en `CONTRIBUTING.md` que
      ni los mensajes ni las descripciones de PR llevan datos de tasaciones,
      clientes, rutas locales ni credenciales — la historia es pública y
      reescribirla es caro.

### Arquitectura del frontend

- [ ] 🟡 **Dividir `LayersControl.tsx` (1.419 líneas)**: una leyenda por capa en
      su propio componente, como ya se hizo con los hooks del mapa.
- [ ] 🟡 **Dividir `page.tsx` (808 líneas)** *(nuevo)*: tras sacar el estado a
      hooks, el JSX de filtros, barra de estadísticas y layout mobile/desktop
      sigue junto. Candidatos: `FilterBar`, `StatsBar`, `MobileShell`.
- [ ] 🟡 **Terminar `MapView.tsx` (1.111 líneas, creció desde ~1.070)**: quedan en el componente el
      clúster CBR, la sincronización de capas KML y la publicación del export;
      candidatos a `useCbrClusterLayer` y `useKmlMapLayers`.
- [ ] 🟡 **Un solo ciclo de vida para los rasters por viewport.** `useSuelosLayer`,
      `useVegetacionalLayer`, `usePropiedadesRuralesLayer` y
      `useNdviVisualLayer` repiten overlay + secuencia + abort + blob +
      precarga. No se unificaron porque difieren a propósito (suelos borra la
      imagen al pedir otra para no mostrar un raster viejo si CIREN cae;
      NDVI hace debounce y cuantiza el bbox para la CDN). Un hook común debe
      hacer explícitas esas diferencias como opciones. Es **prerrequisito**
      de la carta IGM (§ 1.4): sin él, sería la quinta copia.
- [ ] 🟡 **CONAF no informa su estado a la leyenda.** A diferencia de suelos,
      propiedades rurales y NDVI, `useVegetacionalLayer` no emite
      `loading`/`error`/`zoom-required`: si el servicio cae, la capa queda
      vacía sin explicación. (Verificado 2026-10-10: sigue igual.)
- [ ] 🟡 **Popups que siguen inline**: los de `identify` de suelos (tres
      variantes, incluidos los errores) y propiedades rurales se arman dentro
      de sus hooks. Moverlos a `src/lib/map-popups.ts` para que queden bajo
      los tests de escape. (Verificado 2026-10-10: sigue igual.)
- [ ] 🟡 **Dos geocoders en el DOM** (ver «Accesibilidad»): es deuda de
      arquitectura además de accesibilidad; `page.tsx` monta
      `<GeocoderSearch>` dos veces y deja a CSS elegir cuál se ve.
- [ ] 🟢 **Estilos inline en el HTML de popups**: cada popup repite
      `style="font-size:…"`. Pasar a clases (`.sig-popup-*`) en
      `globals.css` para que el tema oscuro y la impresión los alcancen.
- [ ] 🟢 **Estado de la página en la URL**: filtros, capas, zoom y base viven
      en estado de React y `localStorage`; un único módulo de estado
      serializable sería la base del permalink y de las vistas guardadas.

### Datos y ETL *(nuevo, 2026-10-10)*

- [ ] 🟡 **Capas estáticas sin calendario de refresco.** Áreas protegidas es
      de 2026-06, catastro frutícola y red vial de 2026-07. Nada avisa cuando
      la fuente publica algo nuevo. Propuesta: workflow mensual que consulte
      la metadata de cada fuente (fecha de edición del servicio ArcGIS,
      `Last-Modified`) y abra un issue si cambió — **sin** descargar nada,
      para no castigar servidores frágiles.
- [ ] 🟡 **Los ETL no tienen tests.** `scripts/build-*.mjs` concentran la
      lógica más delicada (reproyección, paginación, recorte de bioclima) y
      nada la ejercita. Extraer las funciones puras a un módulo compartido y
      testearlas con fixtures pequeños: el desfase de 287 km de bioclima
      habría saltado con un test de una isla.
- [ ] 🟡 **Contrato de `meta.json` sin esquema.** Cada capa escribe campos
      parecidos con nombres distintos (`fecha_levantamiento`, `vintage`, …).
      Definir un esquema (zod o JSON Schema) y validarlo en tests: es la base
      del tooltip «vintage: AAAA-MM» de los riesgos transversales.
- [ ] 🟢 **`derechos-agua.meta.json` publicado sin capa.** El stub
      `scripts/build-derechos-agua.mjs` genera un manifiesto con
      «Por determinar»; o se completa § 2.2 o se retira del árbol público.
- [ ] 🟢 **ETL reproducibles**: fijar en cada `meta.json` la URL exacta, la
      fecha de descarga y un hash del archivo fuente, para poder demostrar
      de dónde salió cada geometría.

### Rendimiento *(nuevo, 2026-10-10)*

- [ ] 🟡 **`/api/points` entrega 21 MB de JSON** y el clúster pinta ~85k
      marcadores en el cliente. Ruta incremental: (1) nombres de campo
      cortos o arreglo de columnas; (2) carga por viewport + zoom con
      clúster en el servidor (PostGIS `ST_ClusterDBSCAN` o la grilla de
      hexbins); (3) teselas vectoriales (ver H2 de la ruta larga).
- [ ] 🟢 **Presupuesto de rendimiento** medido por la analítica (`boot`): fijar
      un umbral (p. ej. p75 < 2,5 s) y revisarlo en cada release.

### Tests

- [ ] 🟡 **Hooks y componentes**: los tests actuales cubren solo `src/lib/`
      (10 archivos). Sumar Testing Library + jsdom para `useCbrData`,
      `useRuralRolSearch` y las leyendas.
- [ ] 🟡 **Humo end-to-end en CI** con Playwright: cargar el mapa, encender cada
      capa, abrir un popup y exportar el PNG. Hoy esto se verifica a mano (ver
      «Prueba de humo del export»). Las capas remotas se prueban contra
      respuestas grabadas, nunca contra CIREN/MOP en vivo.
- [ ] 🟢 **Tests de las rutas `/api/*`** con la base mockeada: validación de
      parámetros, que nunca salga un campo PII (regla dura de `AGENTS.md`) y
      el contrato de error.

### Seguridad y operación

- [x] **`sharp` 0.35.4 vulnerable** — subido a 0.35.5 el 2026-10-10: CVE-2026-96889 vía
      `librsvg` (GHSA-wq5f-xc86-pv6w), severidad alta, es la única alerta de
      `npm audit --omit=dev`. Llega como dependencia de `next`; `npm audit
      fix` la sube a ≥ 0.35.5 sin tocar `next`. Verificar luego que
      Dependabot abra el PR equivalente.
- [x] **`node_modules` local desalineado** — resuelto con `npm ci` el 2026-10-10. en la máquina Linux
      `next` instalado es 16.3.4 mientras el lockfile pide 16.3.8. Correr
      `npm ci` al retomar en cualquier máquina.
- [ ] 🟡 **Rate limit y cachés por instancia.** `createRateLimiter`, la caché de
      geocodificación y la de polígonos NDVI viven en memoria: se reinician
      en cada arranque en frío y no se comparten entre instancias. Para un
      límite real hace falta un almacén compartido o reglas del firewall de
      Vercel.
- [ ] 🟡 **Sin monitoreo de errores ni de las fuentes remotas** *(nuevo)*.
      Si CIREN, CONAF o Earth Search caen, nadie se entera hasta que un
      usuario lo ve. Un chequeo programado (GitHub Actions o el n8n que ya
      lee la analítica) que haga **una** petición liviana por servicio al día
      y registre el estado basta; publicarlo en una página `/estado` sería un
      plus para los usuarios.
- [ ] 🟢 **Cabeceras de seguridad** *(nuevo)*: CSP (con los orígenes de
      teselas permitidos), `Referrer-Policy`, `Permissions-Policy` en
      `next.config`. Verificar contra securityheaders.com.
- [ ] 🟢 **Documentar el contrato público de `/api/*`** (por ejemplo, OpenAPI):
      es el requisito explícito para `1.0.0` según la política de versiones
      de `AGENTS.md`. Las rutas ya comparten el formato de error
      `{ error: { code, message, service, operation } }`.

## Alineación con la investigación (gabrielpantoja.cl)

> Revisado el 2026-10-10 sobre <https://gabrielpantoja.cl/investigacion> y
> las ~30 notas de <https://gabrielpantoja.cl/notas>. El SIG es el
> instrumento público de esa línea: **un registro abierto de transacciones
> de suelo rural para la conservación**. Esta sección traduce cada eje de
> las notas a trabajo concreto del SIG, para que el producto y la
> investigación avancen juntos. Los ítems se reparten luego en las fases y
> en los horizontes H1–H5.

La propuesta tiene dos partes que el SIG debe servir: **(1) el dato** — qué
se puede afirmar con el registro, con qué error, y cómo publicarlo sin
exponer a las personas — y **(2) el sistema** — la estructura del precio
integrada con capas ecológicas y normativas, con los humedales como caso
de estudio y el bosque nativo como segundo caso.

### Eje 1 — El registro: datos, calidad y apertura

*Notas: datos abiertos de compraventa y conservación, Conservador de Bienes
Raíces, principios FAIR, anatomía de un dato ecológico, PostGIS + Python,
coordenadas sin metadatos (datum, huso, proyección).*

- [ ] 🔴 **Auditoría de reidentificación del endpoint público.** La propia
      propuesta afirma que *rol + fecha + comuna + monto*, juntos, permiten
      volver a la persona usando el Conservador; `/api/points` y
      `/api/export` exponen esos campos **y además `fojas`, `numero` y
      `conservador`**, que apuntan directo a la inscripción. Medir cuántas
      filas son únicas por combinación de campos (k-anonimato) y decidir qué
      generalizar (año en vez de fecha, monto en tramos, sin fojas/número)
      **antes de la entrada en vigor de la Ley 21.719 (diciembre de 2026)**.
      Es una decisión del autor, no de implementación: cambia el contrato
      público y la regla «`rol` es intencionalmente público» de `AGENTS.md`.
- [ ] 🟡 **Capas de calidad del dato** como filtros y como color del punto:
      monto cercano al avalúo fiscal (posible subdeclaración), montos
      redondos, duplicados, inscripciones que no son compraventa entre
      partes independientes y precisión de la georreferenciación. Es el
      «error caracterizado» del data descriptor hecho visible.
- [ ] 🟡 **Metadatos FAIR por capa**: cada `meta.json` exportable como DCAT /
      ISO 19115 mínimo, con licencia, vintage, CRS y procedencia; un
      catálogo `/datos` que los liste. Se apoya en el esquema de `meta.json`
      pedido en «Deuda › Datos y ETL».
- [ ] 🟡 **Releases del registro con DOI** (Zenodo), versionados igual que
      las notas: la capa de investigación seudonimizada, su diccionario de
      datos y el protocolo de anonimización. El SIG enlaza la versión que
      está mostrando.
- [ ] 🟢 **Conversión de datum en la entrada de coordenadas**: las
      escrituras y planos antiguos vienen en PSAD56 o SAD69; la búsqueda
      por coordenadas debe aceptar el datum de origen y convertir a
      SIRGAS-Chile/WGS84 (la nota sobre CRS explica el desfase de cientos
      de metros si no se hace).

### Eje 2 — Precio y territorio: métodos espaciales

*Notas: precios hedónicos, autocorrelación espacial (Moran), econometría
espacial (SEM, Durbin), efectos directos e indirectos, cross-validation
espacial, Random Forest + SHAP.*

- [ ] 🟡 **Ficha del predio con covariables del modelo** (H3): pendiente,
      clase de capacidad de uso, cobertura, distancia a camino, a área
      protegida y a humedal, límite urbano/PRC. Son exactamente las
      variables con que la propuesta une cada transacción al territorio;
      el SIG debe calcularlas igual que el notebook de la tesis (mismo
      código, mismo resultado).
- [ ] 🟢 **Mapa LISA / Moran local** del $/m² por destino: dónde hay
      agrupamientos de precios altos o bajos y dónde hay valores atípicos
      espaciales. Derivado de la misma agregación de `/api/hexbins`.
- [ ] 🟢 **Capa de residuos del modelo hedónico** (cuando exista uno
      publicado): dónde el mercado paga más o menos de lo que explican los
      atributos. Con su intervalo, nunca como «precio automático».
- [ ] 🟢 **Bloques de validación espacial** visibles: la grilla con que se
      hace la cross-validation espacial, para que el lector vea por qué un
      error aleatorio sería demasiado optimista.

### Eje 3 — Coberturas: humedales, bosque nativo y agua

*Notas: humedales urbanos de Valdivia, NDVI no separa nativo de plantación,
NDVI y Sentinel-2, Google Earth Engine, agua y derechos de agua, áreas
protegidas y precio, GBIF.*

- [x] **Humedales** — el caso de estudio de la propuesta. *Hecho
      (2026-10-10)*: capa dinámica remota contra `SIMBIO_HUMEDALES` del MMA
      con el **Inventario Nacional** (~118 mil polígonos) y los **137
      humedales urbanos declarados** (Ley 21.202) con su resolución.
      No fue estática: 118 mil polígonos no caben en el presupuesto de
      `public/data/`. *Pendiente*: (a) distancia al humedal más cercano
      en el popup del punto CBR y en la ficha del predio (covariable de la
      tesis); (b) filtro de transacciones «dentro / a menos de X m de un
      humedal»; (c) consultar si el MMA publica la fecha de corte del
      inventario, hoy no declarada en el servicio.
- [ ] 🟡 **Bosque nativo vs. plantación**: la leyenda de NDVI Visual debe
      advertir que verde no es nativo (lo que dice la nota), y sumar una
      capa que sí los separe — el mapa de dinámica de bosque nativo y
      exótico de Martin-Gallego et al. (2024) si su licencia lo permite, o
      el uso/subuso de CONAF ya disponible como filtro «nativo / plantación».
- [ ] 🟡 **Riqueza de especies desde GBIF** (Darwin Core): GBIF agrega eBird,
      herbarios y SiB en un solo API; empezar por ahí en vez de tres
      ingestas separadas (§ 6.1). Mostrar el **esfuerzo de muestreo** junto
      a la riqueza: una celda sin registros no es una celda sin especies
      (nota «Anatomía de un dato ecológico»).
- [ ] 🟡 **Derechos de agua** (§ 2.2): la nota sobre el Código de Aguas
      refuerza su prioridad; mínimo, link-out por punto CBR al Catastro
      Público de Aguas.
- [ ] 🟢 **Distancia al área protegida más cercana** en el popup del punto
      CBR (la variable de la nota «¿Cuánto vale estar cerca de un parque?»).

### Eje 4 — Valoración y contabilidad del capital natural (contexto)

*Notas: capital natural, TEEB, SEEA EA, InVEST en la cuenca del río
Valdivia, análisis multicriterio para restauración, tasación de arbolado
urbano.*

- [ ] 🟢 **Servicios ecosistémicos de la cuenca del río Valdivia**: salidas
      de InVEST (retención de sedimento, rendimiento hídrico, carbono)
      corridas con datos abiertos, como raster estático del mismo tipo que
      bioclima. Piloto acotado a una cuenca antes de pensar en escala
      nacional.
- [ ] 🟢 **Herramienta multicriterio (AHP)**: el usuario pondera capas
      activas (pendiente, cobertura, distancia a cauce, áreas protegidas) y
      obtiene un mapa de prioridad de restauración. Todo en el navegador,
      sobre rasters ya publicados.
- [ ] 🟢 **Cuentas de extensión SEEA EA por comuna**: hectáreas por tipo de
      ecosistema (CONAF + humedales) en una tabla descargable. Es el primer
      peldaño de las cuentas que describe la nota.

### Eje 5 — Escala del precio (contexto)

*Notas: efecto escala, alometría del precio del suelo (exponente 0,677 del
SII).*

- [ ] 🟢 **Gráfico log-log de $/ha contra superficie** para la selección
      actual, con el exponente ajustado y su intervalo, y la recta del SII
      (0,677) como referencia.
- [ ] 🟢 **Exponente por comuna** como capa coropleta, con `n` y bandas de
      confianza; comunas con pocos datos en gris.

### Eje 6 — Normativa y práctica pericial (contexto)

*Notas: expropiaciones (DL 2.186), decretos de perito, PRC de Valdivia.*

- [ ] 🟢 **Planes reguladores comunales** completos (zonificación, no solo
      el límite urbano), empezando por el PRC de Valdivia que analiza la
      nota de humedales urbanos.
- [ ] 🟢 **Contexto expropiatorio**: el art. 38 del DL 2.186 tasa existencia
      extraíble y no ve el humedal; una vista que muestre, para un polígono,
      qué cubre la tasación expropiatoria y qué capital natural queda
      fuera. Producto de la ficha del predio (H3).

### Enlaces entre el sitio y el SIG

- [ ] 🟢 **Cada capa enlaza su nota**: en el panel de capas, un «Leer la
      nota →» hacia el artículo que explica la fuente o el método (NDVI,
      áreas protegidas, agua, CBR, coordenadas). Y en sentido inverso, las
      notas pueden abrir el SIG con un permalink a la vista que discuten
      — otra razón para priorizar el permalink.

## Ruta GIS de largo plazo (horizontes H1–H5)

Mirada de varios años, ordenada por **horizontes**, no por fechas. Cada
horizonte supone el anterior casi cerrado; dentro de uno, el orden es
sugerencia. Las fases 1–6 de arriba son el detalle de capas; esto es la
dirección del producto. Al retomar, el horizonte activo es el primero con
ítems abiertos.

### H1 — Cimientos sanos (horizonte activo)

*Objetivo: que agregar una capa sea barato y no rompa nada.*

- Deuda 🔴 y 🟡 de arriba cerrada; CI con build + E2E de humo.
- Un hook genérico de raster por viewport y una **ficha de capa declarativa**
  (catálogo único: fuente, licencia, vintage, leyenda, estilos) de la que
  salgan panel, popup, export y `meta.json`. Agregar una capa pasa a ser
  «llenar una ficha + escribir el ETL».
- Permalink completo, escala numérica, medición, copiar coordenadas.
- Carta IGM 1:50.000 **y** DEM libre (hillshade + pendiente): el relieve es la
  ausencia más grande para la tasación rural.
- `v0.2.0` … `v0.4.0` etiquetados con su changelog.

### H2 — Datos que escalan

*Objetivo: dejar de bajar archivos completos al navegador.*

- Migración de almacenamiento (bucket + CDN) y **PMTiles** para las capas
  vectoriales grandes (catastro frutícola, drenaje, red vial).
- Evaluar **MapLibre GL** como motor (teselas vectoriales, estilos por
  datos, relieve 3D, rotación). Es el cambio más grande del proyecto:
  hacerlo detrás de una bandera y migrando capa por capa, no en bloque.
- CBR por viewport con agregación en el servidor; el cliente nunca recibe
  los ~85k puntos.
- Raster propio en COG (bioclima, DEM, pendiente) leído por rangos HTTP, el
  mismo patrón que ya usa NDVI con Sentinel-2.
- Consulta puntual de cualquier raster (clic → valor real, no color).

### H3 — Del visor al análisis del predio

*Objetivo: que el perito salga con una respuesta, no solo con un mapa.*

- **Ficha del predio**: dibujar o elegir un polígono (KML, ROL CIREN o a
  mano) y obtener en una sola vista lo que el SIG sabe de él: superficie,
  pendiente media, clases de suelo (% por clase CIREN), cobertura CONAF,
  NDVI histórico, distancia a camino/río/línea eléctrica/área protegida,
  si cae en límite urbano y transacciones CBR comparables cercanas.
- Exportar esa ficha como **anexo PDF** con mapa, leyenda, fuentes y
  vintages (cumple la regla de los tres lugares de atribución).
- **Comparables**: selección de transacciones por cercanía + destino +
  superficie, con su estadística (mediana, P25/P75) y su mapa.
- Herramientas clásicas: buffer, intersección con capas activas, perfil de
  elevación sobre una línea, distancia a la red vial.
- Export **DXF** y **GeoPackage** del viewport y de la ficha.
- Restricciones de la Fase 2 (erosión, peligros geológicos, contexto
  hídrico) entran aquí como insumos de la ficha.

### H4 — Tiempo y cambio

*Objetivo: responder «qué cambió en este predio y cuándo».*

- Selector temporal transversal: NDVI por fecha, cicatrices de incendio por
  temporada, cambio de uso CONAF/SIMEF entre catastros.
- Detección de cambio sobre Sentinel-2 (pérdida de cobertura, nuevas
  plantaciones, construcción) por predio y por comuna.
- Series del mercado: $/m² mediano por comuna y año, con el mapa de calor
  animado por período.
- Ortoimágenes históricas donde la licencia lo permita (§ 4.3).
- Escenarios climáticos CMIP6 (§ 5.5) como el «tiempo futuro» del mismo
  selector.

### H5 — Modelos, apertura y comunidad

*Objetivo: que el SIG produzca conocimiento y que otros construyan encima.*

- **Modelo de valor explicable**: regresión espacial (hedónica / Durbin
  espacial, la línea de la tesis) con las capas del SIG como covariables;
  publicar coeficientes, error y mapa de residuos — nunca un «precio
  automático» sin intervalo.
- Conectividad y fragmentación de hábitat (§ 5.4) y biodiversidad (Fase 6)
  como capas derivadas, reproducibles desde el ETL.
- **API pública `1.0.0`** documentada (OpenAPI), con cuotas y ejemplos en
  Python/R; datasets derivados con DOI (Zenodo) y `CITATION.cff` al día.
- Notebook o paquete de reproducción para investigadores (el mismo cálculo
  que el visor, fuera del navegador).
- Internacionalización (inglés) del visor y de la documentación.
- Comunidad: issues `good first issue`, guía paso a paso de «cómo agregar
  una capa» y un proceso para que terceros propongan fuentes.

### Banco de ideas (sin horizonte)

Ideas que todavía no tienen lugar; se promueven a un horizonte cuando la
analítica o un usuario las justifique.

- Modo offline (PWA) para terreno, con las capas del predio en caché.
- Captura en terreno: fotos georreferenciadas y notas ligadas a un punto,
  guardadas solo en el dispositivo.
- Vista 3D del relieve con las capas drapeadas.
- Isócronas de acceso (tiempo a la ciudad o al puerto más cercano por la
  red vial MOP).
- Radiación solar y exposición derivadas del DEM (frutales, viñas).
- Riesgo de helada a partir de bioclima + relieve.
- Integración con QGIS: publicar las capas derivadas como servicio OGC
  (WMS/WFS/OGC API Features) de solo lectura.
- Alertas: «avísame si aparece una transacción nueva en esta comuna».

## Riesgos transversales (revisar al cerrar cada fase)

1. **Fragilidad de servidores del Estado**. Documentado en
   `fuentes-gis-chile.md` § «Hallazgo transversal» (CIREN y MOP colapsan). Aplicar la regla
   *"1 sola request masiva cacheada, reintento con backoff largo"*.
2. **Vintages desalineados**. Cada capa trae su propia fecha de corte;
   el SIG termina mezclando capas con hasta 5 años de desfase.
   Documentar siempre en `meta.json` y mostrar en el panel un tooltip
   "vintage: YYYY-MM".
3. **Cobertura nacional incompleta**. CIREN-Suelos no cubre todo Chile;
   la Catastro Frutícola tampoco; NDVI Visual exige zoom ≥ 10 y escenas
   recientes despejadas. Manejar ausencias como *primera
   clase de feature* (gris + mensaje), no como bug. Documentar umbral de
   resolución en el panel de cada capa.
4. **Licencias y atribución**. La regla de los "3 lugares" (panel,
   popup, meta.json) vale para todas las capas nuevas. Cualquier
   capa nueva que entre con pago o con condiciones de uso restrictivas tiene que tener la
   aprobación del usuario en CHANGELOG antes de mergear. Atención especial
   con datos de biodiversidad (eBird, FloraChile): tienen licencias
   específicas de atribución y cita de investigación.
5. **PII**. Catastro Frutícola y Directorio Frutícola CIREN contienen
   *Productor con razón social* y *rol*. El popup del CBR nunca debe
   exponer razón social ni el nombre del productor; usar el ROL
   como pivote y dejar el link-out a CIREN si el usuario quiere
   profundizar.
6. **Series temporales y lag de datos**. Capas como NDVI o eBird
   tienen delays (MODIS es 1–2 días, eBird es agregación mensual,
   datos de biodiversidad tienen lag de años). Documentar en `meta.json`
   la fecha de actualización esperada y en el panel mostrar "datos
   actualizados al YYYY-MM-DD; próxima actualización: YYYY-MM-DD".

## Fuentes por evaluar

Las fuentes encontradas al armar este roadmap (IDE Minagri, erosión CIREN,
SIMEF, SNIA, IGM, ODEPA) están catalogadas en
[`fuentes-gis-chile.md`](./fuentes-gis-chile.md).

## Cómo actualizar este documento

1. Al cerrar un ítem de cualquier fase, moverlo a un historial breve
   bajo "Hitos" (abajo) con la fecha y el commit/versión.
2. Al proponer un nuevo ítem, evaluarlo contra los **4 ejes de
   priorización** (valor tasación rural + valor ecoinformática +
   accesibilidad + costo) y justificar la fase asignada en el PR.
   Un ítem entra más rápido si suma valor en ambos públicos.
3. Trimestral: revisar `fuentes-gis-chile.md` para ver si
   algún organismo publicó una capa relevante (especialmente IDE
   Minagri, ClimateChile, datos de biodiversidad emergentes).
4. Priorizar con lo que mide la analítica interna: una capa o función que
   nadie usa no justifica su costo de mantenimiento.
5. Mantener viva la tabla [«Por dónde retomar»](#por-dónde-retomar): al
   cerrar un ítem, sacarlo y subir el siguiente desde la deuda 🔴/🟡 o desde
   el horizonte activo de la [ruta larga](#ruta-gis-de-largo-plazo-horizontes-h1h5).
   Cuando un horizonte quede sin ítems abiertos, marcar el siguiente como
   activo.
6. Cada revisión de deuda verifica los ítems contra el código (tamaños de
   archivo, `npm audit --omit=dev`, versión de Node en CI) antes de copiarlos:
   un roadmap que repite deuda ya pagada pierde credibilidad.

## Hitos

- **2026-10-10 — v0.2.0**: humedales, ubicación GPS, Node 22 en CI y Vercel,
  runner fijo, build en CI y el aviso de error CBR que ya no bloquea el mapa.
- **2026-10-10 — Humedales (MMA)**: Inventario Nacional + humedales urbanos
  declarados (Ley 21.202), capa dinámica remota con estado en la leyenda.
- **2026-10-10 — Alineación con la investigación**: los seis ejes de
  gabrielpantoja.cl traducidos a trabajo del SIG; humedales y auditoría de
  reidentificación entran a la cola.
- **2026-10-10 — Revisión del roadmap**: deuda verificada contra el código,
  nuevas secciones (higiene del repo público, datos/ETL, rendimiento), cola
  «Por dónde retomar» y ruta de largo plazo H1–H5.
- **2026-10-06 — Coordenadas del cursor** (decimal, GMS, UTM), **Neutro**
  como fondo por defecto y **carga de KMZ**.
- **2026-10-05 — Revisión de deuda técnica**: Next 16.3.8 (CVE crítico),
  Vitest en CI, contrato de error único en la API y `MapView`/`page.tsx`
  divididos en hooks. Pendientes en «Deuda técnica».
- **2026-10-04/05 — Analítica interna sin cookies** y registro de acceso a la
  API de datos desde el proxy.
- **2026-09-27 — NDVI Visual (Sentinel-2)** por viewport y nuevo panel de
  capas `LayerSidebar` (dock + drawer mobile, buscador, grupos).
- **2026-09-17 — Serie mensual de NDVI** por punto o polígono (PR #12).
- **2026-09-07 — Lectura multicapa**: inspector «Capas activas», opacidad por
  capa y PNG que respeta el alfa de cada capa.
- **2026-09-03 — Bioclima (WorldClim 2.1)**, primera capa de la Fase 5. El PNG
  se reproyectó a Web Mercator tras salir corrido hasta 287 km al sur.
- **2026-08-28 — v0.1.0**, primer release etiquetado: propiedades rurales y
  export PNG reparado.
- **2026-08-27 — Mapa de calor de valor** ($/m²) y selector de mapa base.
- **2026-08-26 — Estadísticas del panel CBR corregidas**: denominadores reales,
  `$/m²` como razón de totales + mediana ([`estadisticas.md`](./estadisticas.md)).
  Cambio incompatible en el campo `precio_m2` del endpoint público.
- **2026-08-22/24 — Recursos vegetacionales (CONAF)** y **líneas de transmisión**.
- **2026-07 — Catastro frutícola y red de drenaje DGA**; el repositorio se
  publica como open source el 2026-07-22.
