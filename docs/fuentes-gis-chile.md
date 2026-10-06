# Fuentes GIS oficiales de Chile para este proyecto

> Documento vivo. Última actualización: 2026-10-05.
>
> **Este proyecto es open source** ([MIT](../LICENSE)) y se desarrolla
> públicamente en https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl.
> El catálogo de fuentes listado aquí es la base que cualquier contributor
> puede usar para proponer una capa nueva siguiendo la receta de
> [arquitectura-capas.md](./arquitectura-capas.md).

Catálogo de las mejores fuentes **públicas y oficiales** de información
geoespacial del Estado de Chile, evaluadas para el SIG de suelo. Prioriza
siempre el **organismo productor** del dato (regla 1 de la receta en
`arquitectura-capas.md`); los espejos solo si la fuente primaria es inviable.

> **Alcance:** es un índice técnico, no una autorización de redistribución.
> Que un servicio sea consultable no implica permiso para republicar sus
> datos: revisar licencia, metadatos y términos de cada organismo.

## Fuentes ya usadas (verificadas en producción)

| Organismo | Qué sirve | Acceso | Usada en |
|---|---|---|---|
| **MMA** — Ministerio del Medio Ambiente | Registro Nacional de Áreas Protegidas (RNAP), 12 categorías legales | Descarga GeoJSON, licencia CC0 | Capa áreas protegidas |
| **MINVU** — geoide.minvu.cl | Instrumentos de Planificación Territorial: límites urbanos, PRC, zonificación | ArcGIS REST (`outSR=4326&f=geojson` OK) | Capa límite urbano |
| **SUBDERE** vía geoportal.cl | División Político-Administrativa (comunas/provincias/regiones, 1:50.000, DPA 2023) | Zip shapefile (~311 MB) del catálogo geoportal.cl | Capa límites comunales |
| **MOP — Dirección de Vialidad** — mapasvialidad.mop.gob.cl | Red Vial Nacional completa (toponimia oficial, ROL, clasificación, carpeta, concesiones) + Puentes | Zip Shp/Gdb/Kmz con vintage en el nombre (`Red_Vial_2026_06_30_shp.zip`) | Capa red caminera |
| **DGA** (MOP) — ArcGIS REST `services3.arcgis.com/aSoEm9TBK2shtWjP` | Red hidrográfica nacional: ríos + esteros con nombre oficial BNA + jerarquía de cuencas | FeatureServer `Ríos` + `Esteros` (paginado `resultRecordCount=1000`). La Mapoteca Digital HTML (`dga.mop.gob.cl/.../mapoteca`) está caída (404) desde 2026-07 — el REST es la única vía estable | Capa red de drenaje |
| **Ministerio de Energía — IDE Energía** (geometría CEN) | Líneas de transmisión: nombre, tramo, circuito, tensión, estado, propietario y fechas | ArcGIS REST `Visor_IDE_Energía/MapServer/10`, `f=geojson`, `outSR=4326`, paginado 1.000/request. 1.128 registros fuente al 2026-03-01; uno sin coordenadas se excluye | Capa líneas de transmisión eléctrica |
| **CIREN** — esri.ciren.cl | Estudios Agrológicos: Capacidad de Uso de los Suelos (clases I–VIII), 12 regiones (Atacama–Aysén, vintages 2010–2024) | ArcGIS REST moderno (10.91: `f=geojson`, paginación, export, identify). Dataset >500 MB → se consume en vivo (capa dinámica) | Capa suelos agrológicos |
| **CIREN-ODEPA** vía IDE Minagri | Catastro frutícola: polígonos de productores por especie, ROL y códigos SUBDERE (sin variedad, superficie ni riego: eso es producto comercial de CIREN) | ArcGIS REST `IDEMINAGRI/CATASTRO_FRUTICOLA`, 14 sublayers regionales | Capa catastro frutícola |
| **CIREN** vía IDE Minagri | Propiedades rurales: polígonos prediales por región, campo `rol` («Rol SII del predio») y `desccomu` | `esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer` — export por viewport + `identify`/`query` acotados. Público sin autenticación, pero eso no autoriza republicar un GeoJSON completo | Capa propiedades rurales (dinámica) |
| **CONAF** vía IDE Minagri / SIT CONAF | Catastro de recursos vegetacionales: uso, subuso, estructura, cobertura, especies dominantes (vintages regionales 2014–2024) | ArcGIS MapServer, export por viewport + `identify` | Capa recursos vegetacionales (dinámica) |
| **WorldClim 2.1** | Climatología 1970–2000 a 2,5′ (BIO1 temperatura media, BIO12 precipitación anual), CC BY 4.0 | Paquete oficial `wc2.1_2.5m_bio.zip` (628 MiB), recortado en el ETL | Capa bioclima (PNG estático) |
| **Copernicus Sentinel-2 L2A** vía Element 84 Earth Search / AWS Open Data | Reflectancia de superficie 10 m como COG, catálogo STAC `sentinel-2-l2a` | Range requests HTTP a `sentinel-cogs`, solo la ventana consultada | NDVI Visual (por viewport) y serie mensual NDVI (`/api/ndvi/serie`) |

### Energía: transmisión no equivale a servidumbre

La fuente canónica para trazados nacionales es IDE Energía del Ministerio de
Energía: `https://ide-energia.minenergia.cl/server/rest/services/IDE_Energia/Visor_IDE_Energ%C3%ADa/MapServer/10`.
La geometría fue proporcionada principalmente por el Coordinador Eléctrico
Nacional y el servicio publica nombres de línea y tramo, tensión y propietario.

No se encontró una capa vectorial nacional oficial de polígonos o anchos de
servidumbre en IDE Energía, SEC ni el Coordinador. La plataforma de concesiones
SEC tramita listados de predios y planos especiales de servidumbre por expediente;
esos documentos no constituyen una cobertura nacional interoperable. Por ello,
los ejes nunca deben rotularse como servidumbres ni convertirse en fajas mediante
buffers. Los metadatos oficiales permiten uso público, descarga e integración,
pero no declaran una licencia estándar; se conserva atribución explícita.

## El ecosistema MOP (hallazgos 2026-07)

El MOP publica el mismo dato vial por varios canales; en orden de utilidad:

1. **mapasvialidad.mop.gob.cl/descargas/** (UGIT — Dirección de Vialidad):
   descargas directas Shp/Gdb/Kmz de Red Vial Nacional y Puentes, con fecha
   de corte en el nombre del archivo. **La vía robusta y más actualizada.**
2. **rest-sit.mop.gob.cl/arcgis/rest/services/VIALIDAD/** — ArcGIS Server
   10.21 con ~20 servicios (Red_Vial_Chile, Catastro_Vial, Puentes,
   Estado_Red_Vial_Pavimentada, Emergencias_Vialidad, EGC_y_Control_Pesaje,
   Contratos_Globales…). Útil para explorar el esquema y consultas puntuales,
   **pero frágil**: sin `f=geojson`, sin paginación, máx. 1.000 registros por
   consulta, y se cae (500 en todo el servicio) tras descargas masivas
   sostenidas — tarda >30 min en recuperarse.
3. **rest-sit.mop.gob.cl/arcgis/rest/services/MAPA_BASE/IGM50/MapServer** —
   la carta regular del **Instituto Geográfico Militar 1:50.000** publicada
   por IDEMOP como MapServer dinámico. Es la única vía pública encontrada a
   curvas de nivel, cotas y **toponimia rural oficial** de Chile. Verificado
   el 2026-09-07: ArcGIS 10.21, `capabilities: Map,Query,Data`,
   `singleFusedMapCache: false` (sin caché de teselas), `exportTilesAllowed:
   false`, EPSG:3857 nativo, sin CORS. Un `export` de 1024×683 px sobre
   Valdivia devolvió 675 KB en **7,2 s** (CIREN sano: ~1,2 s).
   **Solo consumo por imagen**: además de la fragilidad del 10.21, el dato
   IGM está protegido por la Ley 17.336 y se vende en su tienda oficial
   (SHP y GEOTIFF incluidos), así que descargarlo y republicarlo desde este
   repo no corresponde. Ver `roadmap.md` § 1.4.
4. **www.mapas.mop.cl / mapas.mop.gov.cl** — visor web (Carta Caminera); es
   frontend del REST anterior, no ofrece descarga masiva.
5. **ide.mop.gob.cl/geomop/** — IDE ministerial GEOMOP: catálogo de todas las
   direcciones MOP (Vialidad, Obras Hidráulicas, DGA, Concesiones,
   Aeropuertos, Obras Portuarias). Punto de partida para datos MOP no viales.

## Otras fuentes oficiales relevantes para un SIG de suelo

| Organismo | Qué sirve | Relevancia para este proyecto |
|---|---|---|
| **IDE Chile / geoportal.cl** | Catálogo Nacional de Información Geoespacial: agrega los datos de todos los ministerios | Primera parada para descubrir si existe un dato oficial. Descargas erráticas (sin reanudación) pero completas |
| **SII** — Servicio de Impuestos Internos | Cartografía digital de predios (roles), avalúos fiscales, áreas homogéneas | El ROL de los puntos CBR viene de aquí. Sin API pública de descarga masiva; la cartografía se consulta en mapas.sii.cl |
| **CIREN** (otros productos) | Catastro frutícola, propiedades rurales, erosión actual/potencial | Complementos de tasación rural en el mismo esri.ciren.cl; shapefiles descargables en ide.minagri.gob.cl/geoweb |
| **IGM** — Instituto Geográfico Militar (servido por MOP-IDEMOP) | Carta regular 1:50.000: curvas de nivel, puntos acotados, fisiografía, toponimia oficial, hidrografía | Relieve y **nombres de sector rural**, que es como las escrituras del CBR describen el predio. Obra protegida (Ley 17.336, se vende): solo visualización vía el MapServer oficial, nunca ETL |
| **CONAF** | Catastro de uso de suelo y vegetación, bosque nativo, plantaciones | Complementa destino/uso de predios rurales. IDE en sit.conaf.cl |
| **DGA** (MOP) — Dirección General de Aguas | Cauces integrados (ríos/esteros, ver sección anterior). Quedan pendientes: derechos de aprovechamiento (DAA), cuencas BNA como polígono de contexto, glaciares, acuíferos SHAC, estaciones fluviométricas | Complementarios para valorización rural |
| **SERNAGEOMIN** | Geología, peligros geológicos (remoción en masa, volcanismo), concesiones mineras | Restricciones de uso y riesgo en tasaciones. Portal geología: portalgeo.sernageomin.cl |
| **INE** | Manzanas censales, entidades pobladas, microdatos Censo 2024 | Densidad/contexto demográfico. geoine-ine-chile.opendata.arcgis.com |
| **SMA** — ideserver.sma.gob.cl | Espejos de capas de otros organismos (incl. Red Vial MOP, layer 10) + fiscalización ambiental | Espejo útil si el productor está caído (documentar el porqué si se usa) |
| **SHOA** | Línea de costa oficial, cartas náuticas, áreas de inundación por tsunami | Borde costero para predios con orilla de mar/lago |
| **plataformadedatos.cl** (MINCIENCIA/CEDEUS) | Agregador académico-estatal de datasets georreferenciados | Alternativa de descarga cuando geoportal.cl falla |
| **IDE Minagri** (CIREN-MINAGRI) | Catálogo de capas SHP + API REST (`ideminagriapi.ciren.cl`) | Punto de partida para cualquier capa agrícola/forestal. La API `valida-rol-comuna` es la vía pública de CIREN para validar ROL rurales |
| **CIREN** — Inventario Nacional de Erosión | GeoNode `inventarioerosion.ciren.cl`, erosión actual y potencial | Cobertura O'Higgins → Los Lagos, WFS público. Roadmap § 2.1 |
| **CIREN** — Hub Catastro Frutícola | `catastro-fruticola-inicio-esri-ciren.hub.arcgis.com` | Visor público; el shapefile empaquetado es de pago |
| **SIMEF** (Minagri-INFOR-CONAF) | Monitoreo de ecosistemas forestales nativos, uso y cambio de uso, incendios | `simef.minagri.gob.cl`; datos al 31/12/2025 |
| **DGA / SNIA** | Catastro Público de Aguas (12 registros) y observatorio de glaciares | Glaciares como vector; derechos de agua solo por expediente. Roadmap § 2.2 |
| **ODEPA** | Biblioteca Digital (infraestructura frutícola 1999–2025, agroindustria 2017–2019, XLSX) y reportes interactivos | Tablas de enriquecimiento, no capas |
| **MMA — ARClim** | Atlas de riesgos climáticos | `arclim.mma.gob.cl` |
| **SUBPESCA** | Concesiones acuícolas y áreas de manejo | Predios con borde costero o lacustre |
| **Dirección Meteorológica de Chile** | Climatología y observaciones | `meteochile.gob.cl` |
| **NASA FIRMS** | Focos de incendio casi en tiempo real (VIIRS/MODIS) | Roadmap § 5.3a |
| **Ministerio de las Culturas** | Patrimonio cultural y territorial | IDE Patrimonio, `idepat.patrimoniocultural.gob.cl` |
| **BCN** | Límites administrativos y datos territoriales | Alternativa a DPA para series históricas |
| **GBIF** | Registros abiertos de biodiversidad (`api.gbif.org/v1`) | Roadmap Fase 6 |

## Hallazgo transversal: los servidores GIS estatales son frágiles bajo ráfagas

Dos casos documentados (2026-07):

- **MOP rest-sit** (ArcGIS 10.21): tras ~15 consultas grandes seguidas, 500 en
  TODO el servicio por >30 min. Solución: usar la descarga directa oficial.
- **CIREN esri** (ArcGIS 10.91): sano responde una imagen de viewport en
  ~1,2 s, pero la ráfaga de ~40 teselas WMS que dispara Leaflet lo tumba
  (timeouts de 60 s → HTTP 400). Solución: 1 export por viewport
  (`L.ImageOverlay` + `moveend`), nunca WMS teselado.

Regla práctica: contra servidores del Estado, **minimizar el número de
requests simultáneos** (descarga única cacheada para ETL; imagen única por
viewport para capas dinámicas) y reintentar con backoff largo (minutos, no
segundos).

## Patrón técnico: consultar un servicio ArcGIS REST

Cuando los términos lo permitan, un FeatureServer o MapServer se consulta con
`query`, pidiendo solo los campos necesarios:

```text
GET <servicio>/<capa>/query?where=1=1&outFields=<campos>&returnGeometry=true&f=geojson
```

En descargas grandes: paginación, timeout, reintentos con backoff y control de
`exceededTransferLimit`. Registrar fuente, URL exacta, fecha, CRS, campos,
conteo y transformaciones en el `*.meta.json`. Los crudos quedan fuera de Git,
en `scripts/.cache/`.

## Reglas al incorporar cualquiera de estas fuentes

1. Verificar **licencia/condiciones** y citar al organismo en el popup, el
   panel de capas y el `meta.json` (tres lugares — ver `arquitectura-capas.md`).
2. Registrar el **vintage** del dato (fecha de corte o de descarga) en el
   `meta.json`; si el archivo fuente lo trae en el nombre, conservarlo.
3. La geometría publicada en este SIG es **referencial, solo visualización**;
   para uso normativo se remite a la fuente.
4. Nada de PII (Ley 19.628): los datos de propietarios (RUT, nombres) nunca
   entran, aunque la fuente los exponga.
5. Dato público no es licencia de redistribución: publicar solo los datos y
   atributos que los términos de la fuente permiten.
6. Las capas referenciales no sustituyen planos oficiales, certificados ni
   informes profesionales.
