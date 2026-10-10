# Changelog

Todas las novedades destacables de este proyecto se anotan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/) `MAYOR.MENOR.PARCHE`.

## Sobre el `0.` mayor

El proyecto está en `0.x` a propósito y por una razón concreta: **el contrato
público de `/api/*` todavía no está documentado ni congelado**. `1.0.0` llega
el día que lo esté y se asuma el compromiso de no romperlo sin aviso. Ver
`src/lib/version.ts` para la política completa de qué mueve cada número.

`v0.1.0` es el **primer release etiquetado**. Todo lo construido antes es
prehistoria sin versionar (ver más abajo): el número no resume cuánto hay
hecho — para eso está este archivo — sino dónde empieza la disciplina de
versionado.

---

## No publicado

### Añadido

- **Capa Humedales (MMA)**: Inventario Nacional de Humedales (~118 mil
  polígonos por tipo: continentales, artificiales, marinos y costeros) y los
  137 humedales urbanos declarados bajo la Ley 21.202, con su resolución
  exenta, enlace a la BCN y expediente. Capa dinámica remota (PNG por viewport
  desde zoom 8 + consulta por clic) contra el servicio oficial
  `SIMBIO_HUMEDALES`, licencia CC0. Informa su estado a la leyenda y entra al
  PNG exportado con su atribución.
- **Carga de archivos KMZ** en «Mis capas», además de KML. El ZIP se abre en
  el navegador (fflate): se toma `doc.kml` (o el primer `.kml` menos profundo)
  y se ignoran íconos e imágenes; tope de 150 MB descomprimido contra bombas ZIP.

### Seguridad

- **`sharp` 0.35.4 → 0.35.5** (dependencia de `next`). Cierra
  GHSA-wq5f-xc86-pv6w (alta, vía `librsvg`); `npm audit --omit=dev` vuelve
  a 0. El mismo cambio repone `fflate` en el `package-lock.json`: faltaba
  desde la carga de KMZ y `npm ci` fallaba en CI.
- **`POST /api/ndvi/serie` rechaza cuerpos de más de 1 MB** (413
  `BODY_TOO_LARGE`) antes de parsearlos; antes `req.json()` aceptaba
  cualquier tamaño y recién después contaba vértices.
- **Next.js 16.3.4 → 16.3.8.** Cierra GHSA-vcvr-r3jv-pc5j (crítica, RCE en
  `next/og`; el proyecto no usa `ImageResponse`, pero la versión vulnerable
  iba en producción). `npm audit --omit=dev` queda en 0.
- **Los rate limiters en memoria ya no crecen sin techo.** Guardaban una
  entrada por cada IP vista mientras la instancia siguiera caliente; ahora
  hay una sola implementación (`createRateLimiter` en `src/lib/security.ts`)
  que barre las IP inactivas, compartida por la API general, la analítica y
  las dos rutas NDVI.

### Corregido

- **Apagar una capa mientras descargaba la dejaba pegada en el mapa.** Seis
  de las siete capas GeoJSON estáticas no abortaban el `fetch`: al llegar el
  archivo se montaban igual, sin que ningún control pudiera quitarlas.
- **El cajetín del PNG describía mal el mapa de calor.** Decía «seis clases
  por cuantiles», el método de cuando se dibujaban hexágonos; hoy es una
  superficie interpolada y el texto lo dice. Es el anexo de un informe de
  tasación: tiene que describir el mapa que acompaña.
- **El link «Ver ficha oficial» de áreas protegidas solo acepta http(s).**
  `esc()` no impedía un `javascript:` en `url_fuente`.
- **`%` y `_` en los filtros de predio y ROL se buscan literalmente.** Antes
  actuaban como comodines de `ILIKE`: `?rol=_` devolvía toda la base. El
  término además queda acotado a 100 caracteres.

### Cambiado

- **Contrato de error único en la API.** `/api/ndvi/serie` respondía
  `{error:{codigo,mensaje}}` y `/api/ndvi/export` mezclaba códigos en español;
  ambas usan ahora `{error:{code,message,service,operation}}` con códigos en
  inglés (`INVALID_POINT`, `RATE_LIMITED`, `UPSTREAM_TIMEOUT`, …), igual que
  los proxies ArcGIS. El `message` sigue en español. Cambio incompatible
  para clientes externos que leyeran `codigo`/`mensaje`.
- El preflight CORS de `/api/ndvi/serie` y `/api/analytics` anuncia `POST`.

### Interno

- **Tests unitarios con Vitest** (`npm test`, también en CI): filtros,
  proxies ArcGIS, rate limiter, hexbins, superficie de calor, rampas y ROL.
- `@types/geojson` declarado explícitamente (llegaba de forma transitiva).
- **`MapView.tsx` de 2601 a ~1120 líneas.** Los popups pasan a
  `src/lib/map-popups.ts` (funciones puras con tests) y cada capa a su hook en
  `src/components/map/`. Las siete capas GeoJSON estáticas comparten
  `useStaticGeoJsonLayer`.
- **`page.tsx` de 1286 a ~810 líneas**: datos CBR, búsqueda por ROL, capas
  KML y consulta NDVI pasan a hooks en `src/hooks/`; el cajetín del PNG a
  `src/lib/export-metadata.ts` (con tests).

- `geotiff` y `pngjs` pasan a `dependencies`: los usa el renderer NDVI en
  runtime, no solo el ETL.
- Los helpers de los proxies ArcGIS (suelos, vegetacional, propiedades
  rurales) se consolidan en `src/lib/arcgis-proxy.ts` (`fetchArcGis`,
  `readIdentifyParams`, `readExportParams`, `isPngBody`, `pngResponse`); las
  rutas que estaban comprimidas en una línea vuelven a ser legibles. Sin
  cambios de contrato.

### Añadido

- **Registro de acceso a la API de datos.** Cada consulta a `/api/points` y
  `/api/export` queda registrada desde el proxy (antes de la caché de la CDN),
  incluidas las que no vienen del navegador (curl, scripts): origen
  (`site`/`external`), cliente, formato y nombres de filtros. Sección nueva en
  `npm run analytics:report` y vista `analytics.api_access`.
- **Exclusión del administrador.** Entrar con `?analytics=off` deja una cookie
  que excluye a ese navegador de toda la analítica (`?analytics=on` la borra).

- **Analítica interna sin cookies.** Registra visitas, ubicación general
  (país/región/ciudad), dispositivo, tiempo de carga del mapa, tiempo activo y
  qué funciones se usan (capas, filtros, exports, NDVI…), en un esquema propio
  de Neon con un rol de solo escritura. No guarda IP ni valores de filtros,
  respeta Do Not Track / GPC y purga a los 13 meses. Reporte con
  `npm run analytics:report`.

### Corregido

- **El export a PNG vuelve a funcionar.** Estaba roto por **tres** fallos
  encadenados, cada uno oculto tras el anterior — el segundo y el tercero solo
  aparecieron al arreglar el que tenían delante:
  1. `drawCbrMarkers` llamaba `cluster.getAllChildMarkers()` sobre el
     `MarkerClusterGroup`; ese método solo existe en `L.MarkerCluster`. Se usa
     `getLayers()`, que es el equivalente del grupo. Los tipos de
     `@types/leaflet.markercluster` declaran el método en el grupo, así que
     `tsc` nunca lo detectó.
  2. El sprite del pin no rasterizaba: un `.replace('<svg ', 'xmlns="…" ')`
     pensado para *insertar* el namespace en realidad **sustituía** la etiqueta
     de apertura y dejaba XML inválido. El `xmlns` ya venía en `cbrPinSvg()`,
     así que el `replace` sobraba entero.
  3. `getVisibleParent()` devuelve `null` cuando ningún ancestro del marcador
     tiene icono en el DOM — la norma con ~85k puntos, casi todos fuera del
     viewport. Faltaba el guard y el primer marcador fuera de pantalla tiraba
     `Cannot read properties of null (reading 'getLatLng')`.

  Los tres puntos quedan documentados en el código con la razón de ser del
  arreglo, para que nadie los revierta «simplificando».

### Añadido

- **Aviso visible cuando el export falla.** Antes el botón volvía a su estado
  normal y la excepción moría en la consola: el usuario pulsaba y no pasaba
  nada. Ahora aparece un banner descartable con el detalle del error, que es
  además lo que permitió encontrar los fallos 2 y 3.

### Problemas conocidos (nuevos)

- Las burbujas de clúster del PNG se pintan de un azul plano (`#5fb7e0`),
  mientras que en pantalla la librería las colorea por conteo (verde <10,
  amarillo <100, naranja ≥100). La lámina exportada no refleja la codificación
  visual de la pantalla.

---

## [0.1.0] — 2026-08-28

Primer release etiquetado.

### Añadido

- **Selector de mapa base** (`BasemapSwitcher`), al estilo de Google Maps: un
  control de miniaturas en la esquina inferior izquierda con cinco lienzos —
  **OpenStreetMap** (por defecto, a color), **Neutro** (los mismos tiles
  desaturados, el fondo correcto para el mapa de calor de valor), **Satélite**
  (ortoimagen Esri World Imagery con etiquetas), **Topográfico** (OpenTopoMap,
  curvas de nivel y sombreado SRTM) y **Sin fondo** (solo capas temáticas,
  para láminas limpias). Las miniaturas son tiles reales de cada proveedor
  sobre el mismo encuadre, así que la elección se hace mirando el resultado.
  La preferencia se recuerda entre sesiones.
- El PNG exportado sigue el mapa base elegido: el mismo filtro en pantalla y
  en el canvas, y la atribución obligatoria de cada proveedor (ODbL de OSM,
  CC-BY-SA de OpenTopoMap, la fórmula de Esri para la ortoimagen).
- **Monitor de actualizaciones** (`UpdateNotice`): avisa en el DOM cuando se
  despliega una versión nueva mientras el SIG está abierto, con botón
  **Actualizar**. Es descartable, nunca recarga solo y advierte que al
  recargar se pierden filtros, encuadre y capas KML cargadas.
- `GET /api/version` — identidad del despliegue (versión + build) que consume
  el monitor.
- Política de versionado documentada (`src/lib/version.ts`, `AGENTS.md`) y
  este `CHANGELOG.md`.

### Cambiado

- El mapa base ya no se decide por el tema del sistema. `prefers-color-scheme`
  sigue eligiendo la variante clara u oscura del lienzo **Neutro**, pero el
  lienzo lo elige el usuario.
- La rampa del mapa de calor pasa a `plasma` sobre la ortoimagen aunque el
  sistema esté en tema claro: la rampa clara de tasación se perdía sobre el
  satélite.
- `MAP_MAX_ZOOM` (19) con `maxNativeZoom` por proveedor: cambiar de un fondo
  con z19 a OpenTopoMap (z17) reescala el último nivel en vez de dejar el
  viewport en blanco.
- Se adopta versionado explícito. `package.json` conserva el `0.1.0` que dejó
  `create-next-app`, pero ahora el número significa algo: es el primer punto
  etiquetado y a partir de aquí se mueve según la política de
  `src/lib/version.ts`.

### Problemas conocidos

Se etiqueta declarándolos, no ocultándolos. Detalle, evidencia y causa raíz en
[`docs/auditoria-ux-2026-08.md`](./docs/auditoria-ux-2026-08.md).

- **El export a PNG está roto.** `drawCbrMarkers` llama
  `cluster.getAllChildMarkers()` sobre el `MarkerClusterGroup`, método que solo
  existe en `L.MarkerCluster`. Pulsar «Exportar PNG» no descarga nada y no
  muestra error. Los tipos de `@types/leaflet.markercluster` lo declaran en el
  grupo, así que `tsc` no lo detecta.
- Faltan herramientas básicas de visor SIG: lectura de coordenadas (lat/lon y
  UTM 19S), escala numérica, medición y opacidad por capa.
- Las leyendas viven dentro del panel de capas y quedan cortadas con varias
  capas activas; el mapa de calor se dibuja sin su escala de color visible.

### Notas de proveedores

Verificado el 2026-08-28 (HTTP 200 + CORS `*`): `tile.openstreetmap.org`,
`tile.opentopomap.org`, `server.arcgisonline.com` (World_Imagery y
Reference/World_Boundaries_and_Places). Siguen descartados CARTO
(estampa «API KEY REQUIRED» en cada tile), Stadia/Stamen (401 sin API key) y
`tiles.wmflabs.org/hillshading` (servicio retirado).

---

## Prehistoria sin versionar — 2026-06-26 … 2026-08-27

Sin changelog ni tags: el proyecto se desarrolló entero contra el `0.1.0` por
defecto de `create-next-app`, y el historial de ese tramo vive en los commits
(68 al momento de etiquetar `v0.1.0`). A grandes rasgos, ahí se construyó el
mapa de transacciones CBR sobre Neon, el panel de filtros y estadísticas, el
buscador de direcciones, las capas de áreas protegidas (RNAP), límite urbano
(PRC), límites comunales (DPA), red caminera (MOP), red de drenaje (DGA),
líneas de transmisión, catastro frutícola (CIREN-ODEPA), suelos agrológicos
(CIREN), recursos vegetacionales (CONAF) y propiedades rurales (CIREN), el
mapa de calor de valor ($/m²) con `ST_HexagonGrid`, la carga de KML del
usuario y el export a PNG con cajetín de trazabilidad legal.
