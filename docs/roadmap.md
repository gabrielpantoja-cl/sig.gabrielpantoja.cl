# Roadmap del SIG de suelo — `sig.gabrielpantoja.cl`

> Documento vivo. Última actualización: 2026-07-22.
> Próxima revisión sugerida: trimestral o cuando se cierre una fase.
>
> **Este proyecto es open source** ([MIT](../LICENSE)) y se desarrolla
> públicamente en https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl.
> Las decisiones arquitecturales internas del operador viven en el mirror
> privado (`infra/privado/sig.gabrielpantoja.cl/architecture/`); este repo
> contiene solo lo publicable.

## Visión

Convertir el SIG en una herramienta de **tasación rural asistida**: además de
los puntos CBR ya implementados, el usuario (perito, tasador, abogado,
ingeniero agrónomo) debe poder ver, en una sola vista, qué es cada predio,
qué se puede hacer en él, qué restricciones tiene y cuánto paga el mercado
por predios comparables. Esto implica tres direcciones:

1. **Datos del predio**: capas rurales (Catastro Frutícola, deslindes
   prediales, ROL validado contra CIREN).
2. **Restricciones del predio**: derechos de agua, áreas protegidas, zonas
   de riesgo, erosión, bosque nativo, planes reguladores.
3. **Inteligencia de mercado**: comparador de transacciones, estadísticas
   con cuartiles (no solo promedio), series de tiempo, exportación a DXF.

Las tres direcciones se sirven en la misma vista, con la misma UX ya probada
(paneles flotantes, capas estáticas + dinámicas, atribución obligatoria).

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

Cada ítem se evalúa en una matriz rápida de 3 ejes:

- **Valor para tasación rural** — ¿acelera una decisión del perito? (alto =
  reduce horas-hombre en gabinete, medio = contexto, bajo = nice-to-have).
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
  ton/ha/año, con categorías estandarizadas. Crucial para tasación de
  predios con pendiente.
- **Tipo de capa esperada**: **estática** (descarga WFS → GeoJSON + el
  ETL habitual de mapshaper) si el GeoNode lo soporta, o **dinámica
  remota** estilo CIREN-suelos si el dataset pesa > 50 MB.
- **Esfuerzo**: **M** — clon del patrón de la receta en
  `arquitectura-capas.md`; validar tamaño y rendimiento del GeoNode
  (`/services/?limit=5` lista los WMS/WFS publicados).
- **Riesgo**: cobertura incompleta nacional → mostrar siempre un aviso
  en el panel ("Cobertura: O'Higgins a Los Lagos") y deshabilitar el
  resto.

### 2.2 Derechos de aprovechamiento de aguas (DGA)

- **Fuente**: Catastro Público de Aguas, 12 registros públicos
  disponibles en <https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/>,
  visualizadores nacionales:
  - Visualizador Hidrométrico Nacional: <https://vipnet.mop.gob.cl/>
  - Hidrolínea: <https://snia.mop.gob.cl/sat/site/informes/mapas/mapas.xhtml>
  - Estadística Hidrométrica: <https://mapas2.mop.gob.cl/>
  - Inventario Público de Glaciares: <https://snia.mop.gob.cl/observatorio/>
- **Qué agrega**: para tasación rural, el derecho de agua es tanto o más
  decisivo que el suelo mismo. Visualizar puntos de captación,
  derechos consuntivos/no consuntivos, permanentes/eventuales, y el
  estado de la cuenca.
- **Tipo de capa esperada**: **mixta** — los *registros de derechos
  individuales* se consultan por expediente y probablemente no hay
  endpoint masivo; lo que sí existe público es **glaciares** (SNIA,
  formato WFS) y **red hidrográfica nacional** (probablemente en
  geoportal.cl). Tratar esa primera entrega como "contexto hídrico"
  (glaciares, cauces DGA, cuencas) y dejar el query por expediente a
  un link-out del popup.
- **Esfuerzo**: **L** — evaluar primero qué de DGA está realmente
  servido como WFS masivo y qué no.
- **Riesgo**: cada registro de derechos es un expediente (PDF +
  shapefile individual); abrirlos y consolidar es un proyecto en sí
  mismo. Reencuadrar la Fase 2.2 como *"capa de contexto hídrico
  (glaciares + red de drenaje)"* y dejar la integración de expedientes
  individuales para una fase posterior si el valor lo justifica.

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
- **Qué agrega**: clasificación de uso de suelo (bosque nativo,
  plantaciones, matorral, praderas, etc.) y contexto ecológico/
  incendios para predios rurales.
- **Tipo**: **estática**.
- **Esfuerzo**: **M**.

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
- [x] **AI tooling**: `opencode.json` con seed neutro, AGENTS.md técnico,
      AGENTS.local.md (gitignored) con el setup personal del operador.
      Sin credenciales ni modelos commiteados.
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

- [ ] **Comparador de transacciones lado a lado**: cuando el usuario
      abre el popup de un CBR, permitir comparar hasta 3 transacciones
      comparables (misma comuna + rango de superficie + mismo destino)
      en una vista expandida del `InfoPanel.tsx`. Cubre "inteligencia
      de mercado" sin agregar capas nuevas.
- [ ] **Estadísticas con distribución** (no solo promedio/suma):
      mediana, percentiles 25/75, histograma por rango de precio
      según filtros activos. Esto ya vive en la franja de stats;
      bastaría con cambiar la agregación server-side.
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

## Riesgos transversales (revisar al cerrar cada fase)

1. **Frágilidad de servidores del Estado**. Ya documentado en
   `fuentes-gis-chile.md:55-69` (CIREN y MOP colapsan). Aplicar la regla
   *"1 sola request masiva cacheada, reintento con backoff largo"*.
2. **Vintages desalineados**. Cada capa trae su propia fecha de corte;
   el SIG termina mezclando capas con hasta 5 años de desfase.
   Documentar siempre en `meta.json` y mostrar en el panel un tooltip
   "vintage: YYYY-MM".
3. **Cobertura nacional incompleta**. CIREN-Suelos no cubre todo Chile;
   la Catastro Frutícola tampoco. Manejar ausencias como *primera
   clase de feature* (gris + mensaje), no como bug.
4. **Licencias y atribución**. La regla de los "3 lugares" (panel,
   popup, meta.json) vale para todas las capas nuevas. Cualquier
   capa nueva que entre con pago o scraping tiene que tener la
   aprobación del usuario en CHANGELOG antes de mergear.
5. **PII**. Catastro Frutícola y Directorio Frutícola CIREN contienen
   *Productor con razón social* y *rol*. El popup del CBR nunca debe
   exponer razón social ni el nombre del productor; usar el ROL
   como pivote y dejar el link-out a CIREN si el usuario quiere
   profundizar.

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
2. Al proponer un nuevo ítem, evaluarlo contra los 3 ejes de
   priorización y justificar la fase asignada en el PR.
3. Trimestral: revisar el catálogo actualizado de fuentes para ver si
   algún organismo publicó una capa relevante (especialmente IDE
   Minagri).

## Hitos (a llenar al cerrar tareas)

- *vacío — esperando primer cierre*
