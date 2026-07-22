# Arquitectura de capas del SIG: catálogo y receta para agregar una capa nueva

> Documento vivo. Última actualización: 2026-07-22.
>
> **Este proyecto es open source** ([MIT](../LICENSE)) y se desarrolla
> públicamente en https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl.
> Cualquier persona puede abrir un PR siguiendo la receta documentada aquí;
> el ruleset `Protect main` exige pasar el check `ESLint + TypeScript`.

Este SIG tiene dos familias de capas: los **puntos CBR** (dinámicos, desde Neon
vía `/api/points`) y las **capas temáticas estáticas** (GeoJSON pre-construido
en `public/data/`, generado por scripts ETL reproducibles desde fuentes
oficiales del Estado de Chile). Este documento cataloga las capas existentes y
fija la receta para agregar la próxima, de modo que cada capa nueva salga con
el mismo estándar: fuente oficial verificable, manifiesto de procedencia,
atribución visible y cita en el popup.

## Catálogo de capas temáticas

| Capa | Fuente oficial | Vintage | Features | Peso | Script ETL |
|---|---|---|---|---|---|
| Áreas protegidas (RNAP) | MMA · Registro Nacional de Áreas Protegidas (CC0) | — | ~12 categorías legales | 6,0 MB | `scripts/build-protected-areas.mjs` |
| Límite urbano (PRC) | MINVU · IPT · geoide.minvu.cl (ArcGIS REST) | — | 601 polígonos | 0,9 MB | `scripts/build-urban-limit.mjs` |
| Límites comunales (DPA) | SUBDERE · DPA 2023 · geoportal.cl (Grupo DPA: SUBDERE/IGM/DIFROL/INE, 1:50.000) | 2023 | 345 comunas | 2,7 MB | `scripts/build-comunas.mjs` |
| Red caminera (MOP) | Dirección de Vialidad · mapasvialidad.mop.gob.cl (UGIT-DV, shapefile oficial) | 2026-06-30 | 14.085 tramos (5 grupos de clasificación) | 5,9 MB | `scripts/build-red-vial.mjs` |
| Suelos agrológicos (CIREN) | CIREN · Estudios Agrológicos · esri.ciren.cl (MapServer, 12 regiones) | 2010–2024 según región | Clases I–VIII + N.C. | **0 MB (capa dinámica remota)** | — (sin ETL; ver sección siguiente) |
| Catastro frutícola (CIREN) | CIREN · IDE Minagri · esri.ciren.cl (MapServer `IDEMINAGRI/CATASTRO_FRUTICOLA`, 14 sublayers) | 2019–2025 según región | ~95k productores (especie_01 + ROL + códigos SUBDERE) | **~30 MB** ⚠ | `scripts/build-catastro-fruticola.mjs` |

Cada GeoJSON va acompañado de un `*.meta.json` (manifiesto de procedencia:
fuente, URL, licencia, fecha de descarga, campos, cadena de procesamiento,
versión de mapshaper). El manifiesto se versiona en git junto al GeoJSON; los
crudos (zips, shapefiles) quedan en `scripts/.cache/` (gitignoreado).

### Capas dinámicas remotas (tercera familia)

La capa de suelos CIREN inaugura una tercera familia: cuando el dataset
oficial es demasiado pesado para GeoJSON estático (el de CIREN supera los
500 MB; una sola región pesa ~40 MB), se consume el servicio del organismo en
vivo. Patrón implementado en `MapView.tsx` (efecto de suelos) +
`src/lib/suelos.ts`:

- **Un `L.ImageOverlay` refrescado en `moveend`** contra el endpoint `export`
  del MapServer (UN PNG por viewport). **No usar el WMS teselado**: Leaflet
  dispara ~40 GetMap simultáneos por vista y los servidores estatales colapsan
  (CIREN pasó de 1,2 s por imagen a 400/timeout de 60 s bajo esa ráfaga).
- La imagen nueva se **pre-carga** antes de reemplazar la anterior (sin
  parpadeo) y un contador de secuencia descarta respuestas fuera de orden.
- `layers=show:<ids>` es obligatorio si las capas del servicio tienen
  `defaultVisibility: false` (CIREN lo tiene: sin eso el export devuelve un
  PNG transparente).
- **Zoom mínimo obligatorio** (`SUELOS_MIN_ZOOM = 9`): un export de extensión
  nacional obliga al servidor a rasterizar las 12 regiones completas — tarda
  minutos, monopoliza el servicio (las consultas siguientes pasan de ~1 s a
  60 s / HTTP 400) y el navegador lo bloquea con `ERR_BLOCKED_BY_ORB` cuando
  la respuesta degenera en HTML de error. Bajo el zoom mínimo la capa no
  emite peticiones (pixel transparente) y la leyenda indica «acerca el mapa».
- La consulta puntual va por el endpoint `identify` al hacer clic. Ojo: el
  identify devuelve los atributos bajo el **alias** del campo (texto largo,
  encoding inestable), no bajo su nombre — extraer el valor por validación
  (`/^(I|II|...|N\.C\.)$/`), no por clave.
- Trade-off aceptado: requiere el servidor del organismo en línea, no funciona
  offline y la simbología es la del servicio (se replica en la leyenda local
  con los colores extraídos de `/MapServer/legend?f=json`).

Además existen las **capas KML del usuario** (subidas en el panel Capas,
parseadas 100 % en el navegador — `src/lib/kml.ts` — nunca suben a un
servidor) y el **geocoder** (`/api/geocode`, proxy cacheado de Nominatim/OSM
restringido a Chile), que no es una capa sino navegación espacial.

## Receta: agregar una capa temática nueva

Checklist en orden. La capa de límites comunales (commit correspondiente) es
el ejemplo más reciente y completo de cada paso.

1. **Elegir la fuente canónica, no un espejo.** Buscar primero el organismo
   productor del dato (MMA, MINVU, SUBDERE, SII…) en geoportal.cl / IDE Chile.
   Los espejos institucionales (SUBPESCA, CIREN, hubs de ArcGIS de
   municipalidades o universidades) solo se aceptan si la fuente primaria es
   inviable, y documentando el porqué. Verificar en vivo: número de features,
   campos, CRS, límite de registros por consulta (ArcGIS REST suele limitar a
   1000–2000) y licencia/condiciones de circulación.

2. **Escribir el ETL en `scripts/build-<capa>.mjs`** siguiendo el patrón de
   los existentes: descarga a `scripts/.cache/` (idempotente: si el crudo
   ya está, no re-descarga) → `mapshaper` con `-filter-fields` (solo atributos
   públicos útiles, nombres originales de la fuente sin renombrar),
   `-simplify visvalingam weighted N% keep-shapes` y `precision=0.00001` →
   escribe `public/data/<capa>.geojson` + `<capa>.meta.json`.
   - Elegir `N%` según el zoom de consumo: 1,5 % para capas de contexto
     nacional (áreas protegidas, comunas), 5 % para líneas que se miran a zoom
     alto (límite urbano). Presupuesto de peso: **< 3 MB ideal, < 6 MB máximo**.
   - Si la fuente es ArcGIS REST, pedir GeoJSON reproyectado server-side
     (`outSR=4326&f=geojson`) y abortar si `exceededTransferLimit`.
   - Si la fuente es zip/shapefile, reproyectar con `-proj wgs84` y localizar
     el .shp dinámicamente (no hardcodear rutas internas del zip).
   - No pre-generalizar en el servidor (`maxAllowableOffset`): rompe la
     coincidencia de vértices entre polígonos vecinos y mapshaper ya no puede
     preservar topología (aparecen huecos/astillas entre comunas).

3. **Registrar el script en `package.json`**: `data:build:<capa>` y añadirlo a
   la cadena `data:build`.

4. **Crear `src/lib/<capa>.ts`**: interfaz de propiedades (nombres de la
   fuente), constantes de estilo (`<CAPA>_STYLE`, `<CAPA>_COLOR`) y
   `<CAPA>_ATTRIBUTION`. Elegir color que no colisione con los existentes:
   carmesí = puntos CBR, verdes/azules = RNAP, ámbar = límite urbano, gris
   pizarra discontinuo = comunas.

5. **Agregar el efecto de capa en `MapView.tsx`**: prop `show<Capa>`, ref
   propia, `useEffect` estructuralmente idéntico a los existentes
   (`fetch('/data/<capa>.geojson')` → `L.geoJSON` → popup con
   `build<Capa>Popup` usando el escape HTML manual `esc()`), y registrar la
   ref en `reorderOverlays()` en la posición correcta del apilado (contexto al
   fondo, puntos CBR siempre al frente). El popup **siempre cierra citando la
   fuente** y, si el límite es referencial, diciéndolo.

6. **Agregar la fila en `LayersControl.tsx`** con `LayerRow`: checkbox +
   swatch + nombre, y los detalles (leyenda si hay categorías, atribución,
   enlace «Ver fuente oficial →») detrás del triángulo de despliegue,
   colapsados por defecto. Cablear el estado en `page.tsx`.

7. **Verificar y documentar**: `npm run data:build:<capa>` (revisar conteo y
   peso), probar en `localhost:3000` (activar la capa junto a las demás,
   popups clicables, orden de apilado, modo claro y oscuro), `npm run lint`,
   y actualizar la tabla de este documento + AGENTS.md (comandos, key files,
   bullet de arquitectura).

## Reglas de datos que ninguna capa puede romper

- Solo datos **públicos y oficiales**; nada de PII (Ley 19.628 — ver HARD
  RULES en AGENTS.md).
- La geometría publicada es **solo para visualización**: el `meta.json` y el
  popup deben remitir a la fuente original para análisis o uso normativo.
  Para límites administrativos, los límites oficiales son los de
  DIFROL/SUBDERE; para límites urbanos, el instrumento publicado en el Diario
  Oficial.
- Atribución visible en tres lugares: panel de capas (detalle desplegable),
  popup de cada feature y `meta.json`.

## Lecciones operativas (para no re-aprenderlas)

- **Preferir la descarga directa (zip/shapefile) sobre el API ArcGIS REST
  cuando la fuente ofrece ambas.** El servidor REST del MOP
  (rest-sit.mop.gob.cl, ArcGIS 10.21) no soporta `f=geojson` ni paginación,
  limita a 1.000 registros por consulta y **se degrada bajo descarga sostenida**:
  tras ~15 consultas de ~10 MB empezó a responder 500 («Error performing query
  operation») a TODA consulta —incluso `returnCountOnly`— durante más de 30
  minutos. La misma Vialidad publica el shapefile completo con vintage
  explícito en mapasvialidad.mop.gob.cl/descargas/ (Gdb/Kmz/Shp): una sola
  descarga HTTP robusta. Ver `docs/fuentes-gis-chile.md`.
- **El DBF de un shapefile trunca los nombres de campo a 10 caracteres**
  (NOMBRE_CAMINO → NOMBRE_CAM). Cuando la misma fuente expone un esquema REST
  con nombres completos, renombrar en el ETL (`-rename-fields`) al esquema
  canónico de la fuente y documentarlo en el meta.json — así la app consume
  los nombres oficiales y no el artefacto del formato.
- **En capas de líneas con muchos features, las propiedades pesan tanto como
  la geometría.** En la red vial (14k tramos), los atributos eran ~2,7 MB
  contra ~3,3 MB de coordenadas: recortar campos redundantes (REGION se ve en
  el mapa; KM_I/KM_F secundarios) compra presupuesto para calidad de trazado.
  La simplificación por porcentaje (`visvalingam weighted N% keep-shapes`)
  rindió mejor peso/calidad que `interval=N` en esta capa.

- **geoportal.cl** sirve las descargas del catálogo con velocidad errática:
  puede cortar conexiones largas y **no soporta reanudación** (`curl -C -` →
  exit 33). Reintentar la descarga completa suele bastar; el ETL cachea el
  zip así que solo duele una vez por actualización de la fuente.
- **leaflet.markercluster** no expone cancelación del `addLayers` chunked: si
  el efecto se limpia a mitad de carga (StrictMode, cambio de filtros), su
  `setTimeout` interno sigue corriendo con `_map` null y revienta en
  `_addLayer` (`getMinZoom`). El cleanup del efecto de clúster en
  `MapView.tsx` lo neutraliza (flag `cancelled` + no-op de `_addLayer`).
- Con `preferCanvas: true` todos los overlays comparten pane: el orden de
  apilado **debe** re-imponerse tras cada mutación de capa vía
  `reorderOverlays()` — es idempotente y converge sin importar qué `fetch`
  resuelva último.
- El loader de arranque se alimenta de progreso real en dos fases: bytes
  descargados de `/api/points` (header `X-Total-Bytes`, porque el gzip de la
  CDN invalida `Content-Length`) y `chunkProgress` de markercluster. Si se
  agrega peso significativo al arranque, mantener ese contrato: el 100 % debe
  coincidir con el mapa pintado.
