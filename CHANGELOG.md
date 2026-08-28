# Changelog

Todas las novedades destacables de este proyecto se anotan aquí.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el versionado es [SemVer](https://semver.org/lang/es/) `MAYOR.MENOR.PARCHE`.

## Sobre el `0.` mayor

El proyecto está en `0.x` a propósito y por una razón concreta: **el contrato
público de `/api/*` todavía no está documentado ni congelado**. `1.0.0` llega
el día que lo esté y se asuma el compromiso de no romperlo sin aviso. Ver
`src/lib/version.ts` para la política completa de qué mueve cada número.

---

## [0.5.0] — 2026-08-28

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
- La versión de `package.json` sube de `0.1.0` (el valor que dejó
  `create-next-app` y que nunca se tocó) a `0.5.0`, que es lo que describe el
  producto real: ~12 capas temáticas, mapa de calor con PostGIS, export PNG
  con cajetín legal y geocoder.

### Notas de proveedores

Verificado el 2026-08-28 (HTTP 200 + CORS `*`): `tile.openstreetmap.org`,
`tile.opentopomap.org`, `server.arcgisonline.com` (World_Imagery y
Reference/World_Boundaries_and_Places). Siguen descartados CARTO
(estampa «API KEY REQUIRED» en cada tile), Stadia/Stamen (401 sin API key) y
`tiles.wmflabs.org/hillshading` (servicio retirado).

---

## [0.1.0] … [0.4.x] — 2026-06-26 … 2026-08-27

Sin changelog: el proyecto se desarrolló contra `package.json` en `0.1.0` y el
historial vive en los commits. A grandes rasgos, en ese tramo se construyó el
mapa de transacciones CBR sobre Neon, el panel de filtros y estadísticas, el
buscador de direcciones, las capas de áreas protegidas (RNAP), límite urbano
(PRC), límites comunales (DPA), red caminera (MOP), red de drenaje (DGA),
líneas de transmisión, catastro frutícola (CIREN-ODEPA), suelos agrológicos
(CIREN), recursos vegetacionales (CONAF) y propiedades rurales (CIREN), el
mapa de calor de valor ($/m²) con `ST_HexagonGrid`, la carga de KML del
usuario y el export a PNG con cajetín de trazabilidad legal.
