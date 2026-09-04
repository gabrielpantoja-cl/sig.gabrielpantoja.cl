# Roadmap del SIG de suelo — `sig.gabrielpantoja.cl`

> Documento vivo. Última actualización: 2026-08-28.
> Próxima revisión sugerida: trimestral o cuando se cierre una fase.
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
   (no solo promedio), series de tiempo, exportación a DXF. — *Primer entregable en
   producción: el mapa de calor de valor ($/m² por hexágono, `/api/hexbins`). Plan y
   fases pendientes en [`plan-mapa-de-calor.md`](./plan-mapa-de-calor.md).*

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

## Estado actual (al 2026-07-16)

Cinco capas en producción (`docs/arquitectura-capas.md:13-21`):

| # | Capa | Tipo |
|---|---|---|
| 1 | Puntos CBR ~85k | Dinámica (Neon vía `/api/points`) |
| 2 | Áreas protegidas RNAP | Estática (GeoJSON, 6,0 MB) |
| 3 | Límite urbano PRC | Estática (0,9 MB) |
| 4 | Límites comunales DPA | Estática (2,7 MB) |
| 5 | Red caminera MOP | Estática (5,9 MB) |
| 6 | Suelos agrológicos CIREN | Dinámica remota (PNG por viewport) |

Backlog de fuentes no integradas — ya inventariado en
`docs/fuentes-gis-chile.md:42-53` y ampliado con este roadmap.

## Criterios de priorización

Cada ítem se evalúa en una matriz rápida de 4 ejes (ambos públicos cuentan):

- **Valor para tasación rural** — ¿acelera una decisión del perito? (alto =
  reduce horas-hombre en gabinete, medio = contexto, bajo = nice-to-have).
- **Valor para ecoinformática** — ¿es crítico para análisis de biodiversidad,
  cambio climático, fragmentación o degradación? (alto = backbone del análisis,
  medio = contexto, bajo = enriquecimiento).
- **Accesibilidad del dato** — público, oficial, descargable en masa
  (alto), o requiere scraping/API frágil (bajo).
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

### 1.1 Catastro Frutícola CIREN-ODEPA ⭐ **prioridad del usuario**

- **Fuente**: CIREN-Catastro Frutícola, levantado anualmente en regiones
  rotativas con apoyo de ODEPA. Última noticia (2026-07): inicio en
  Coquimbo y O'Higgins.
- **Encontrado en**:
  - Catálogo de capas SHP de IDE Minagri:
    <https://ide.minagri.gob.cl/descarga-de-capas-shp/>
    (categoría *"Agricultura y ganadería"*).
  - Hub ArcGIS público del proyecto:
    <https://catastro-fruticola-inicio-esri-ciren.hub.arcgis.com/>
  - Página CIREN: <https://www.ciren.cl/productos/directorio-fruticola/>
  - Página ODEPA: <https://www.odepa.gob.cl/estadisticas-del-sector/catastros-fruticolas>
    (con sistema interactivo y base de infraestructura frutícola
    descargable desde `bibliotecadigital.odepa.gob.cl`).
- **Qué agrega**: huertos por especie (uva, palto, cerezo, manzano,
  nogal, etc.) con superficie, variedad, edad, método de riego y
  georreferenciación a nivel de potrero/predio. Aclara qué se está
  vendiendo en las transacciones CBR rurales — pivote entre "monto" y
  "uso real del suelo".
- **Tipo de capa esperada**: **estática** (GeoJSON regional por ETL) +
  cruzada en el cliente con los puntos CBR por `rol`/`comuna`.
- **Esfuerzo**: **M** — verificar disponibilidad real (la página
  CIREN dice *"Cotizar producto"*; IDE Minagri podría tener un
  extracto libre). Si el shapefile no se puede bajar en masa, evaluar
  el endpoint `FeatureServer` del Hub ArcGIS (la página carga
  lazy, hay que validar endpoints al implementar).
- **Riesgos / decisiones**:
  - License: confirmar que la versión descargable de IDE Minagri es
    libre (CIREN vende el *"vectorial empaquetado"* como producto, pero
    el hub.catastrofruticola parece ser visor público).
  - Vintage irregular por región (Coquimbo se está catastrando ahora;
    la Metropolitana probablemente esté más antigua). Documentar en
    `meta.json` el campo `region_vintage` por feature o un aviso
    general en el panel.
  - Los ROL del catastro frutícola pueden no coincidir con los del CBR
    por desfase CIREN↔SII (la propia API de validación de CIREN lo
    advierte: <https://ideminagriapi.ciren.cl/>). Documentar.

### 1.2 Predios rurales (deslindes vectoriales CIREN, derivados SII)

- **Fuente**: CIREN "Propiedades Rurales Vectoriales", derivado de las
  divisiones prediales remitidas por el SII.
  <https://www.ciren.cl/productos/propiedades-rurales/>
- **Qué agrega**: la geometría del polígono del predio rural, lo que
  abre la puerta a un **análisis espacial real** (overlay con
  Catastro Frutícola, intersect con DGA, área afecta a plan regulador).
- **Tipo de capa esperada**: **estática** con cuidadosa simplificación
  (los deslindes se miran a zoom alto).
- **Esfuerzo**: **L** — el producto base es de pago ("Cotizar producto"
  en la página), pero el **`validador-rol-comuna`** público de IDE
  Minagri (<https://ideminagriapi.ciren.cl/>) confirma que existe un
  dataset nacional de predios rurales por ROL/comuna. Hay que negociar
  o identificar el canal de descarga. Si no se obtiene la geometría
  completa, al menos exponer el `rol-comuna → [lat,lng]` del endpoint
  público como **click-through** sobre los puntos CBR.
- **Riesgos / decisiones**:
  - Licencia: evaluar si conviene el *Informe Predial* de pago o
    hacer scrapping del visualizador web.
  - En realidad la opción B es un derivado público pero con valor
    agregado de CIREN — no replicable. La **API de validación de ROL
    pública es el camino recto**: integrar como servicio de autocompletar
    el campo `rol` y como link-out en el popup del punto CBR.

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

> **Status: 2026-08-28** — Se inició investigación de fuentes WFS públicas.
> Ver `scripts/build-derechos-agua.mjs` para la estrategia: Fase 1 mapeará
> **contexto hídrico** (glaciares SNIA + cuencas), dejando derechos
> individuales como link-outs.

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

### 3.2 CONAF — Catastro vegetacional / uso de suelo

- **Fuente**: CONAF (<https://www.conaf.cl/regulacion/informacion-geografica-o-territorial/catastro-vegetacional/>)
  + Simef (SIMEF — monitoreo de ecosistemas forestales nativos,
  <https://simef.minagri.gob.cl/>). Simef publica Reportes Estadísticos
  con *"Uso de la Tierra, Cambio de Uso de la Tierra, Incendios
  Forestales"* (última carga 31/12/2025).
- **Qué agrega**:
  - **Para tasación**: clasificación de uso de suelo (bosque nativo, plantaciones,
    matorral, praderas, etc.) y contexto ecológico/incendios.
  - **Para ecoinformática**: CENTRAL para análisis de ecosistemas, fragmentación,
    pérdida de hábitat, cambios de cobertura temporal, y nichos de biodiversidad.
    CONAF + Simef juntos permiten series temporales de cambio de uso.
- **Tipo**: **dinámica remota**, implementada mediante PNG por viewport y
  consulta puntual `identify` al servicio oficial.
- **Esfuerzo**: **M**.
- **Potencial futuro**: integrar índices derivados (NDVI histórico desde MODIS
  para 2000–presente) como capa paralela para análisis de tendencias más finas.

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
Reutiliza la infraestructura de remote layers + time series. Todas las capas de esta fase
agregan valor tanto para tasación rural (contexto ambiental) como para ecoinformática
(backbone del análisis).

### 5.1 Bioclima (WorldClim 2.1) — ✅ **EN PRODUCCIÓN**

> **Cerrado el 2026-09-03.** La capa se dibuja, se puede alternar entre
> temperatura y precipitación, y quedó verificada en el navegador. Queda
> pendiente solo la consulta puntual (ver «Lo que falta» abajo).
>
> **La decisión de diseño que importa**: recortado a Chile el raster mide
> 224 × 924 px —**50 KB temperatura, 25 KB precipitación**—, así que NO se
> siguió el patrón de suelos CIREN de renderizar un PNG por viewport. El ETL
> pinta las dos imágenes una vez y el mapa las cuelga como `L.ImageOverlay`
> estático. Sin route handler, sin refresco en `moveend`, sin dependencia de
> terceros en runtime y cacheable por el navegador. El patrón por viewport
> existe para datasets de 500 MB en servidores ajenos; aplicarlo aquí habría
> sido complejidad sin beneficio.

- **Fuente**: WorldClim 2.1 (<https://www.worldclim.org/data/worldclim21.html>),
  climatología **1970-2000**, 2.5 min de arco (≈4,6 km en el ecuador). Descarga
  directa verificada: `https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_2.5m_bio.zip`.
- **Qué agrega**:
  - **Para tasación**: contexto climático del predio (precipitación anual,
    temperatura media) como referencia de capacidad productiva.
  - **Para ecoinformática**: base de cualquier análisis de nichos ecológicos,
    áreas de aptitud y refugia climática; entrada obligatoria para modelar
    distribuciones de especies.
- **Tipo**: **raster estático** recortado a Chile, servido como `L.ImageOverlay`.

**Hecho:**

- [x] ETL `scripts/build-bioclima.mjs`: descarga el paquete oficial
      (`wc2.1_2.5m_bio.zip`, 628 MiB), extrae solo BIO1 y BIO12 de las 19,
      recorta la ventana de Chile del GeoTIFF global (8640 × 4320) con
      `geotiff`, pinta el PNG con `pngjs` y emite el manifiesto.
- [x] **Escala de color en un solo archivo** (`src/lib/bioclima-ramp.json`), que
      leen tanto el ETL —para pintar— como la leyenda del panel. Es lo que
      garantiza que leyenda y mapa no puedan desalinearse: con copias separadas
      se separarían en silencio, sin que nada fallara de forma visible.
- [x] **Bounds derivados del recorte real**, no de los grados pedidos. El ETL
      redondea a píxel y publica los bounds efectivos en el manifiesto; el mapa
      los lee de ahí. Usar los grados nominales habría corrido la imagen hasta
      medio píxel.
- [x] **Océano transparente**: el TIFF marca el mar como `NaN` o con un centinela
      muy negativo según cómo se escribió; ambos casos se descartan, o el mar se
      habría pintado con el color del tramo más frío.
- [x] `L.ImageOverlay` montado en `MapView`, al fondo del apilado (es una
      superficie continua: sobre cualquier otra capa la taparía entera).
- [x] `LayersControl`: fila, selector de variable y leyenda; estados en `page.tsx`.
- [x] **Verificado en el navegador**, y no solo que el `<img>` cargara: en
      precipitación se ve el contraste húmedo/árido cruzando los Andes (sombra
      de lluvia) y en temperatura la franja fría siguiendo la cordillera. Los
      rangos observados son los correctos para Chile —0 a 6.733 mm y −12 a
      20,7 °C—, lo que confirma que la georreferenciación es real.

**Lo que falta:**

- [ ] **Consulta puntual**: clic → «1.240 mm/año · 11,3 °C». El PNG solo guarda
      color, así que hace falta publicar además los valores crudos (Int16
      recortado, ~400 KB por variable, o comprimido bastante menos) y cargarlos
      de forma diferida al primer clic. Sin esto la capa se lee, pero no se
      consulta.
- [ ] **Incluirla en el PNG exportado** (`map-export.ts`) para que la lámina del
      informe muestre lo mismo que la pantalla, con su atribución.
- [ ] **Opacidad ajustable**: hoy va fija en 0,6. Se cruza con el ítem general de
      «opacidad por capa» de la auditoría de UX.

- **Riesgo asumido y documentado**: 2.5 min de arco es una superficie
  **interpolada desde estaciones meteorológicas**, no una medición del predio.
  La atribución del panel lo dice de forma explícita para que nadie la cite como
  dato de sitio en un informe de tasación.
- **Nota de almacenamiento**: los 73 MB de GeoTIFF globales quedan en
  `.research/` (gitignored); al repositorio solo entran los dos PNG recortados,
  75 KB entre ambos. Esta capa NO participa de la migración a bucket de Q4-2026.

### 5.2 Índices de vegetación dinámicos (MODIS NDVI/EVI 2000–presente)

- **Fuente**: USGS LPDAAC (MODIS MOD13Q1 500 m, 16-day composites, 2000–presente,
  descargable por tiles regionales vía `AppEEARS`).
- **Qué agrega**:
  - **Para tasación**: tendencia de productividad/cobertura del predio a lo largo
    de 20 años; detección de estrés vegetacional (sequía, plagas).
  - **Para ecoinformática**: CRÍTICO — NDVI es la señal más directa de salud del
    ecosistema. Series temporales permiten: (a) detección de cambios de uso/degradación,
    (b) ciclos de estrés climático (acoplamiento con SPI), (c) respuesta a incendios
    (recuperación post-fuego), (d) comparación inter-anual de productividad.
- **Tipo de capa esperada**: **dinámica con timeline** — raster servido por
  `/api/ndvi/export?date=YYYY-MM-DD&bbox=...` que retorna PNG + stats, o
  **PMTiles** (vector tiles binarios con range-request HTTP) si peso lo justifica.
- **Esfuerzo**: **M** — descargar serie MODIS (tedioso pero uno-a-uno), preprocesar
  (cloud mask, reproject EPSG:4326), agregar a temporal pyramid en PMTiles o
  generar series de PNG mensuales, exponer UI con date picker.
- **Riesgo**: MODIS es 500 m (resolución gruesa para predio individual); ofrecer
  fallback a Sentinel-2 (10 m, 2015–presente) si peso lo permite, pero implica
  replicar ETL.

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

- **Fuente**: derivado de Áreas Protegidas (MMA, Fase 1) + Bosque Nativo (CONAF, Fase 3)
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

## Resumen de la fusión: De tasación rural a plataforma ecoinformática integrada

**Antes (roadmap original, Fases 1–4):**
- 100 % enfocado en tasación rural y mercado inmobiliario.
- Capas económicas: CBR, Catastro Frutícola, suelos, derechos de agua.
- Capas de restricción: áreas protegidas, red vial, erosión.

**Después (con Fase 5–6):**
- Tasación rural + Ecoinformática + Conservación en una sola plataforma.
- Capas económicas: ídem (sin cambios).
- Capas de contexto ambiental: erosión, CONAF vegetación, DGA hidrología, glaciares.
- **Capas de ciencia ambiental (Fase 5): bioclima, NDVI series, incendios, fragmentación.**
- **Capas de biodiversidad (Fase 6): distribuciones de especies, endemismos.**

**Beneficiarios:**
- Perito rural: ve restricciones + mercado + contexto en una vista.
- Ecoinformático: ve series temporales, análisis de fragmentación, nichos, cambio climático.
- Conservacionista: ve estado de hábitat, tendencias de degradación, corredores de conectividad.

**Ganancia arquitectónica:**
- Misma UX para todos (paneles, capas, leyendas, exportación).
- Mismas rutas de API (remote layers via `/api/*/export`, `identify`).
- Mismo versionado de datos (meta.json, atribución, vintage).
- Reutilización de infraestructura: timeline de NDVI = timeline de MODIS = timeline de
  incendios FIRMS.

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

## Fase 0 — Higiene del repositorio público (pre-publish, jul-2026)

Antes de abrir el repo, saneamos lo siguiente:

- [x] **Privacidad**: ningún endpoint expone PII bajo Ley 19.628
      (`comprador, vendedor, rut, user_id, observaciones`). Reforzado en
      `src/lib/security.ts` y en el SELECT explícito de cada route handler.
- [x] **AI tooling**: AGENTS.md técnico, AGENTS.local.md (gitignored) con
      el setup personal del operador. `opencode.json` commiteado con
      `model` + `enabled_providers` del maintainer (sin credenciales — auth
      del provider se hace por env var / Token Plan, no en el repo).
- [x] **Documentación comunitaria**: CONTRIBUTING.md, CODE_OF_CONDUCT.md,
      SECURITY.md, templates de issues y PR, dependabot, CI con
      `npm run lint`.
- [x] **Licencia**: MIT en código; tabla de licencias por capa en el README.
- [ ] **Almacenamiento de GeoJSON**: hoy los 5 GeoJSON pre-construidos
      (`public/data/*.geojson`, ~45 MB en total) viven commiteados al repo.
      Bajo el umbral de aviso de GitHub (50 MB por archivo) y la lectura
      funciona offline. **Migración planeada a bucket + CDN**: ver
      sección siguiente.

### Migración de almacenamiento de GeoJSON (planeada Q4-2026)

**Hoy (temporal, para publicar)**: los GeoJSON están commiteados en
`public/data/`. Cada `npm run data:build:<capa>` los regenera desde fuentes
oficiales; los manifests `*.meta.json` van junto. La receta está en
`docs/arquitectura-capas.md` y funciona, pero tiene tres problemas que nos
empujan a migrar:

1. **Tamaño del repo en GitHub**: hoy 45 MB totales. La capa Catastro
   Frutícola pesa ~30 MB y podría crecer a 50–80 MB cuando CIREN libere el
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

### Bloqueante (de la auditoría 2026-08-28)

- [x] **P0 · El export a PNG está roto.** *Corregido el 2026-08-28.* Al
      arreglar la llamada aparecieron dos fallos más encadenados que el
      primero ocultaba (sprite del pin con XML inválido por un `replace` que
      sustituía en vez de insertar, y `getVisibleParent()` devolviendo `null`
      sin guard). Verificado end-to-end. Descripción original abajo: `drawCbrMarkers` llama
      `cluster.getAllChildMarkers()` sobre el `MarkerClusterGroup`, método
      que solo existe en `L.MarkerCluster`; el grupo expone `getLayers()`.
      Los tipos de `@types/leaflet.markercluster` lo declaran igual, así que
      `tsc` pasa en verde y el fallo aparece recién al pulsar el botón — que
      además vuelve a su estado normal **sin mostrar error**. Arreglar la
      llamada, informar el fallo en pantalla y cubrirlo con una prueba de
      humo.
- [ ] **Fidelidad del PNG**: las burbujas de clúster se exportan en azul plano
      mientras en pantalla se colorean por conteo (verde/amarillo/naranja).
- [ ] **Prueba de humo del export**: tres bugs distintos convivieron en esa
      ruta sin que nada los ejercitara.

### Herramientas mínimas de SIG que faltan (auditoría 2026-08-28)

- [ ] **Lectura de coordenadas** del cursor en lat/lon y **UTM 19S**
      (EPSG:32719, el huso de los deslindes y de las coordenadas del
      Conservador), con copiar al portapapeles. Es la otra mitad de
      «Búsqueda por coordenadas», más abajo.
- [ ] **Escala numérica** (`1:25.000`) junto a la barra gráfica, en pantalla
      y en el PNG: el informe de tasación la cita.
- [ ] **Medición** de distancias y superficies (m/km, m²/ha), fijable para
      que salga en el PNG exportado.
- [ ] **Opacidad por capa** en `LayersControl`. Hoy suelos agrológicos +
      límites comunales dejan el mapa base ilegible y no hay forma de
      atenuarlos.
- [ ] **Reordenar capas** (o al menos «traer al frente»): el apilado de
      `reorderOverlays()` es fijo.

### Leyendas (auditoría 2026-08-28)

- [ ] **Leyenda flotante sobre el mapa**, colapsable, con **solo las capas
      encendidas**. Hoy viven dentro del panel de capas: con cinco capas
      activas quedan cortadas por el `max-h`, y la leyenda de una capa
      apagada sigue mostrándose.
- [ ] **El mapa de calor debe mostrar su leyenda por defecto.** Un mapa de
      calor sin escala de color no significa nada, y la que tiene —cortes de
      cuantiles, n, opacidad como cobertura, descargo de «señal de mercado,
      no tasación»— es buena y está escondida tras un chevron.
- [ ] **Señalar visualmente el n bajo**: con 2 celdas y 4 transacciones la
      superficie se dibuja igual de suave que con miles. Degradar el render
      o avisar sobre el mapa bajo cierto umbral.

### Accesibilidad y mobile (auditoría 2026-08-28)

- [ ] **Completar el patrón combobox del geocoder**: las sugerencias no
      llevan `role="option"` ni hay `aria-activedescendant`, así que para un
      lector de pantalla el listbox está vacío. Sacar también la atribución
      de dentro del `<ul>`.
- [ ] **Un solo geocoder en el DOM**: hoy se renderizan la variante mobile y
      la desktop a la vez, con la misma etiqueta accesible.
- [ ] **Panel de capas como drawer inferior en mobile**, igual que el de
      filtros: hoy tapa ~80 % de la pantalla.
- [ ] **Repartir el borde inferior en mobile**: atribución, escala, chip de
      mapa base y FAB se superponen.

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

## Riesgos transversales (revisar al cerrar cada fase)

1. **Frágilidad de servidores del Estado**. Ya documentado en
   `fuentes-gis-chile.md:55-69` (CIREN y MOP colapsan). Aplicar la regla
   *"1 sola request masiva cacheada, reintento con backoff largo"*.
2. **Vintages desalineados**. Cada capa trae su propia fecha de corte;
   el SIG termina mezclando capas con hasta 5 años de desfase.
   Documentar siempre en `meta.json` y mostrar en el panel un tooltip
   "vintage: YYYY-MM".
3. **Cobertura nacional incompleta**. CIREN-Suelos no cubre todo Chile;
   la Catastro Frutícola tampoco. MODIS 500 m no detecta fragmentación fina;
   Sentinel-2 lo hace pero pesa. Manejar ausencias como *primera
   clase de feature* (gris + mensaje), no como bug. Documentar umbral de
   resolución en el panel de cada capa.
4. **Licencias y atribución**. La regla de los "3 lugares" (panel,
   popup, meta.json) vale para todas las capas nuevas. Cualquier
   capa nueva que entre con pago o scraping tiene que tener la
   aprobación del usuario en CHANGELOG antes de mergear. Atención especial
   con datos de biodiversidad (eBird, FloraChile): tienen licencias
   específicas de atribución y cita de investigación.
5. **PII**. Catastro Frutícola y Directorio Frutícola CIREN contienen
   *Productor con razón social* y *rol*. El popup del CBR nunca debe
   exponer razón social ni el nombre del productor; usar el ROL
   como pivote y dejar el link-out a CIREN si el usuario quiere
   profundizar.
6. **Series temporales y lag de datos**. Capas como MODIS NDVI o eBird
   tienen delays (MODIS es 1–2 días, eBird es agregación mensual,
   datos de biodiversidad tienen lag de años). Documentar en `meta.json`
   la fecha de actualización esperada y en el panel mostrar "datos
   actualizados al YYYY-MM-DD; próxima actualización: YYYY-MM-DD".

## Catálogo actualizado de fuentes (síntesis de la investigación)

Las siguientes fuentes se descubrieron durante la confección de este
roadmap y **deben incorporarse a `docs/fuentes-gis-chile.md`** en su
próxima revisión:

| Organismo | Servicio | URL | Notas |
|---|---|---|---|
| **IDE Minagri** (CIREN-MINAGRI) | Catálogo unificado de capas SHP + API REST | <https://ide.minagri.gob.cl/descarga-de-capas-shp/> · <https://ideminagriapi.ciren.cl/> | Punto de partida único para cualquier capa agrícola/forestal. La API `valida-rol-comuna` es la única vía pública de CIREN para ROLs rurales. |
| **CIREN** | Hub Catastro Frutícola (ArcGIS Hub) | <https://catastro-fruticola-inicio-esri-ciren.hub.arcgis.com/> | Visualizador público; el shapefile empaquetado es de pago ("Cotizar"). Pendiente validar si el `FeatureServer` subyacente es accesible. |
| **CIREN** | GeoNode Inventario Nacional de Erosión | <https://inventarioerosion.ciren.cl/> | Cobertura O'Higgins → Los Lagos. WFS público vía GeoNode. |
| **CIREN** | Productos Propiedades Rurales Vectoriales | <https://www.ciren.cl/productos/propiedades-rurales/> | De pago ("Cotizar"). Derivado de SII. |
| **SIMEF** (Minagri-INFOR-CONAF) | Monitoreo ecosistemas forestales nativos | <https://simef.minagri.gob.cl/> | Datos de uso/cambio de uso de la tierra e incendios al 31/12/2025. |
| **DGA / SNIA** | Catastro Público de Aguas + Visualizadores | <https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/> · <https://snia.mop.gob.cl/observatorio/> | 12 registros públicos. Cobertura variable: glaciares como vector, derechos individuales por expediente. |
| **ODEPA** | Biblioteca Digital abierta | <https://bibliotecadigital.odepa.gob.cl/> | Bases de datos infraestructura frutícola (1999–2025) y directorio agroindustria (2017–2019) descargables en XLSX. |
| **ODEPA** | Reportes interactivos | <https://reportes.odepa.gob.cl/> | Catastros regionales, infraestructura frutícola. Visor público. |

## Cómo actualizar este documento

1. Al cerrar un ítem de cualquier fase, moverlo a un historial breve
   bajo "Hitos" (abajo) con la fecha y el commit/versión.
2. Al proponer un nuevo ítem, evaluarlo contra los **4 ejes de
   priorización** (valor tasación rural + valor ecoinformática +
   accesibilidad + costo) y justificar la fase asignada en el PR.
   Un ítem entra más rápido si suma valor en ambos públicos.
3. Trimestral: revisar el catálogo actualizado de fuentes para ver si
   algún organismo publicó una capa relevante (especialmente IDE
   Minagri, ClimateChile, datos de biodiversidad emergentes).
4. Fase 5 es la transición: priorizar capas bioclimáticas + NDVI series
   antes de biodiversidad observada (Fase 6). Esto maximiza valor para
   ambos públicos en menos tiempo.

## Hitos (a llenar al cerrar tareas)

- **2026-08-26 — Corrección de las estadísticas del panel CBR.**
  `/api/stats` expone los tres denominadores reales (`count`,
  `count_monto`, `count_precio_m2`); el `$/m²` pasa de promedio de
  razones a razón de totales y suma una mediana de razones; la mediana
  del monto reemplaza al promedio como cifra destacada. Documentado en
  [`estadisticas.md`](./estadisticas.md). Cambio semántico incompatible
  en el campo `precio_m2` del endpoint público.
