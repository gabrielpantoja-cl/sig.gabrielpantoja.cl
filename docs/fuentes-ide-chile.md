# Fuentes IDE de Chile

Catálogo público de portales y servicios geoespaciales oficiales útiles para
contexto territorial, análisis ambiental y tasación rural. Las URLs apuntan a
los organismos proveedores; no se depende de plataformas intermediarias.

> **Alcance:** este documento es un índice técnico, no una autorización de
> redistribución. Antes de descargar o republicar datos, revisar la licencia,
> los metadatos y los términos de uso de cada organismo.

## Fuentes oficiales

| Organismo | Datos de interés | Portal oficial |
|---|---|---|
| DGA · MOP | Derechos de agua, acuíferos, restricciones, red hidrométrica y recursos hídricos | [dga.mop.gob.cl](https://dga.mop.gob.cl/) |
| CIREN · MINAGRI | Propiedades rurales, catastro frutícola y suelos agrológicos | [ciren.cl](https://www.ciren.cl/) · [IDE Minagri](https://ide.minagri.gob.cl/) |
| SMA | Fiscalización y datos ambientales | [SMA](https://portal.sma.gob.cl/) |
| SUBPESCA | Concesiones acuícolas y áreas de manejo | [subpesca.cl](https://www.subpesca.cl/) |
| MINVU | Instrumentos de planificación territorial y límites urbanos | [MINVU](https://www.minvu.gob.cl/) · [IDE MINVU](https://ide.minvu.cl/) |
| SERNAGEOMIN | Concesiones mineras, geología y peligros naturales | [sernageomin.cl](https://www.sernageomin.cl/) |
| MINAGRI | Catastros y cartografía agrícola | [IDE Minagri](https://ide.minagri.gob.cl/) |
| Dirección Meteorológica de Chile | Climatología, observaciones y pronósticos | [meteochile.gob.cl](https://www.meteochile.gob.cl/) |
| Open-Meteo | API meteorológica pública para datos complementarios | [open-meteo.com](https://open-meteo.com/) |
| MMA | Atlas de riesgo climático y capas ambientales | [ARClim](https://arclim.mma.gob.cl/) · [MMA](https://mma.gob.cl/) |
| Ministerio de las Culturas | Patrimonio cultural y territorial | [IDE Patrimonio](https://idepat.patrimoniocultural.gob.cl/) |
| NASA FIRMS | Focos de incendios casi en tiempo real | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/) |
| Ministerio de Energía | Infraestructura energética y potencial eólico | [IDE Energía](https://ide-energia.minenergia.cl/) |
| CONAF | Recursos vegetacionales, bosques y áreas protegidas | [CONAF](https://www.conaf.cl/) · [SIT CONAF](https://sit.conaf.cl/) |
| BCN | Límites administrativos y datos territoriales legislativos | [Biblioteca del Congreso Nacional](https://www.bcn.cl/) |
| SII | Catastro y consulta de bienes raíces | [SII](https://www.sii.cl/) |
| GBIF | Registros abiertos de biodiversidad | [gbif.org](https://www.gbif.org/) · [API GBIF](https://api.gbif.org/v1/) |
| Geoportal de Chile | Catálogo nacional de información geoespacial | [geoportal.cl](https://www.geoportal.cl/) |

## Capa prioritaria: propiedades rurales con ROL

IDE Minagri publica el servicio oficial de CIREN:

```text
https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer
```

La capa contiene polígonos prediales rurales organizados por región. En la
metadata consultada, el campo `rol` tiene el alias **“Rol SII del predio”** y
`desccomu` identifica la comuna de la propiedad. El servicio declara
capacidades `Query`, `Map` y `Data`, además de soporte para GeoJSON y
consultas espaciales.

El WMS oficial para visualización es:

```text
https://esri.ciren.cl/server/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer/WMSServer?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities
```

### Estado de acceso y uso

- El servicio es público y permite consultas ArcGIS REST sin autenticación.
- Las capas regionales usan identificadores propios; primero se debe leer la
  metadata del MapServer y seleccionar la región correspondiente.
- Para una aplicación interactiva conviene usar `export`/WMS para pintar y
  `identify` o consultas REST acotadas para atributos.
- Para un ETL se debe consultar por región o por geometría, solicitar solo
  `rol`, `desccomu` y los códigos territoriales necesarios, y respetar la
  paginación y los límites del servidor.
- El hecho de que el servicio sea consultable no confirma por sí solo permiso
  para redistribuir un GeoJSON completo. Revisar los metadatos y términos de
  CIREN/IDE Minagri antes de incorporarlo a `public/data/`.
- `rol` es un identificador predial público según la política de este proyecto,
  pero no debe combinarse con propietarios, domicilios personales u otros
  datos no autorizados.
- La búsqueda implementada en el SIG es exacta (`manzana-predio`) y puede
  devolver varias coincidencias: el ROL debe interpretarse junto con la comuna.
  Solo el resultado seleccionado descarga su geometría, que sigue siendo
  referencial y no acredita dominio ni deslindes legales.

## Patrones técnicos reutilizables

Muchos organismos publican servicios ArcGIS REST. Cuando los términos de uso
lo permitan, un FeatureServer o MapServer puede consultarse mediante su
operación `query`, solicitando solo los campos necesarios y respetando los
límites del servicio:

```text
GET <servicio>/<capa>/query
  ?where=1=1
  &outFields=<campos-permitidos>
  &returnGeometry=true
  &f=geojson
```

Para descargas grandes, implementar paginación, timeouts, reintentos con
backoff y validación de `exceededTransferLimit`. Registrar fuente, URL exacta,
fecha, CRS, campos, conteo de features y transformación aplicada en un
manifiesto `*.meta.json`.

## Reglas para este proyecto

- Verificar la fuente primaria y sus metadatos antes de incorporar una capa.
- Mantener atribución visible en el mapa, popup y documentación.
- No confundir dato público con licencia de redistribución automática.
- Publicar únicamente datos y atributos permitidos por los términos de la
  fuente.
- Mantener los crudos descargados fuera de Git, en `scripts/.cache/`.
- No incorporar datos de personas, credenciales, material de tasaciones ni
  información operacional privada.
- Las capas referenciales no sustituyen planos oficiales, certificados ni
  informes profesionales.

## Referencias del proyecto

- [Arquitectura de capas](./arquitectura-capas.md)
- [Roadmap](./roadmap.md)
- [README](../README.md)
