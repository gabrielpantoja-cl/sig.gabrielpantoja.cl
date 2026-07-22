# Fuentes GIS oficiales de Chile para este proyecto

> Documento vivo. Última actualización: 2026-07-22.
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

## Fuentes ya usadas (verificadas en producción)

| Organismo | Qué sirve | Acceso | Usada en |
|---|---|---|---|
| **MMA** — Ministerio del Medio Ambiente | Registro Nacional de Áreas Protegidas (RNAP), 12 categorías legales | Descarga GeoJSON, licencia CC0 | Capa áreas protegidas |
| **MINVU** — geoide.minvu.cl | Instrumentos de Planificación Territorial: límites urbanos, PRC, zonificación | ArcGIS REST (`outSR=4326&f=geojson` OK) | Capa límite urbano |
| **SUBDERE** vía geoportal.cl | División Político-Administrativa (comunas/provincias/regiones, 1:50.000, DPA 2023) | Zip shapefile (~311 MB) del catálogo geoportal.cl | Capa límites comunales |
| **MOP — Dirección de Vialidad** — mapasvialidad.mop.gob.cl | Red Vial Nacional completa (toponimia oficial, ROL, clasificación, carpeta, concesiones) + Puentes | Zip Shp/Gdb/Kmz con vintage en el nombre (`Red_Vial_2026_06_30_shp.zip`) | Capa red caminera |
| **CIREN** — esri.ciren.cl | Estudios Agrológicos: Capacidad de Uso de los Suelos (clases I–VIII), 12 regiones (Atacama–Aysén, vintages 2010–2024) | ArcGIS REST moderno (10.91: `f=geojson`, paginación, export, identify). Dataset >500 MB → se consume en vivo (capa dinámica) | Capa suelos agrológicos |

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
3. **www.mapas.mop.cl / mapas.mop.gov.cl** — visor web (Carta Caminera); es
   frontend del REST anterior, no ofrece descarga masiva.
4. **ide.mop.gob.cl/geomop/** — IDE ministerial GEOMOP: catálogo de todas las
   direcciones MOP (Vialidad, Obras Hidráulicas, DGA, Concesiones,
   Aeropuertos, Obras Portuarias). Punto de partida para datos MOP no viales.

## Otras fuentes oficiales relevantes para un SIG de suelo

| Organismo | Qué sirve | Relevancia para este proyecto |
|---|---|---|
| **IDE Chile / geoportal.cl** | Catálogo Nacional de Información Geoespacial: agrega los datos de todos los ministerios | Primera parada para descubrir si existe un dato oficial. Descargas erráticas (sin reanudación) pero completas |
| **SII** — Servicio de Impuestos Internos | Cartografía digital de predios (roles), avalúos fiscales, áreas homogéneas | El ROL de los puntos CBR viene de aquí. Sin API pública de descarga masiva; la cartografía se consulta en mapas.sii.cl |
| **CIREN** (otros productos) | Catastro frutícola, propiedades rurales, erosión actual/potencial | Complementos de tasación rural en el mismo esri.ciren.cl; shapefiles descargables en ide.minagri.gob.cl/geoweb |
| **CONAF** | Catastro de uso de suelo y vegetación, bosque nativo, plantaciones | Complementa destino/uso de predios rurales. IDE en sit.conaf.cl |
| **DGA** (MOP) — Dirección General de Aguas | Derechos de aprovechamiento de aguas, cauces, acuíferos | Muy relevante para valor de suelo rural; vía GEOMOP / dga.mop.gob.cl |
| **SERNAGEOMIN** | Geología, peligros geológicos (remoción en masa, volcanismo), concesiones mineras | Restricciones de uso y riesgo en tasaciones. Portal geología: portalgeo.sernageomin.cl |
| **INE** | Manzanas censales, entidades pobladas, microdatos Censo 2024 | Densidad/contexto demográfico. geoine-ine-chile.opendata.arcgis.com |
| **SMA** — ideserver.sma.gob.cl | Espejos de capas de otros organismos (incl. Red Vial MOP, layer 10) + fiscalización ambiental | Espejo útil si el productor está caído (documentar el porqué si se usa) |
| **SHOA** | Línea de costa oficial, cartas náuticas, áreas de inundación por tsunami | Borde costero para predios con orilla de mar/lago |
| **plataformadedatos.cl** (MINCIENCIA/CEDEUS) | Agregador académico-estatal de datasets georreferenciados | Alternativa de descarga cuando geoportal.cl falla |

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

## Reglas al incorporar cualquiera de estas fuentes

1. Verificar **licencia/condiciones** y citar al organismo en el popup, el
   panel de capas y el `meta.json` (tres lugares — ver `arquitectura-capas.md`).
2. Registrar el **vintage** del dato (fecha de corte o de descarga) en el
   `meta.json`; si el archivo fuente lo trae en el nombre, conservarlo.
3. La geometría publicada en este SIG es **referencial, solo visualización**;
   para uso normativo se remite a la fuente.
4. Nada de PII (Ley 19.628): los datos de propietarios (RUT, nombres) nunca
   entran, aunque la fuente los exponga.
