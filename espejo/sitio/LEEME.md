# Registro de transacciones de suelo — copia de respaldo

Copia estatica y verificable del registro de transacciones de suelo obtenidas de
los Conservadores de Bienes Raices de Chile.

Abre `index.html`. No necesita servidor, base de datos ni conexion a ninguna API:
todo se calcula en el navegador desde los archivos de esta misma carpeta. Por eso
sigue funcionando aunque el sitio principal no este disponible.

## Contenido

| Archivo | Que es |
|---|---|
| `index.html` | Visor del mapa, sin dependencias externas |
| `datos/referenciales.csv` | El corte completo, una fila por inscripcion |
| `datos/puntos.json` | Los mismos datos en formato columnar, para el mapa |
| `datos/conservadores.csv` | Catalogo de conservadores |
| `datos/MANIFIESTO.json` | Conteos, SHA-256 por archivo y raiz de Merkle |
| `vendor/` | Leaflet, copiado local a proposito |

## Verificar que no fue alterado

```
sha256sum datos/referenciales.csv
```

Compara el resultado con `datos/MANIFIESTO.json` → `archivos`. Si coincide, el
archivo es exactamente el publicado. En Windows:

```
certutil -hashfile datos\referenciales.csv SHA256
```

La raiz de Merkle del manifiesto permite ademas demostrar que una inscripcion
concreta formaba parte del corte sin entregar las demas filas.

## Datos personales

No contiene ninguno. Nunca se publican comprador, vendedor, RUT, identificadores
de usuario ni observaciones (Ley 19.628). El `rol` SI es publico: es el
identificador de rol del Servicio de Impuestos Internos, no un dato personal.

## Licencia

CC BY 4.0. Al reutilizarlo, cita la fuente y la fecha del corte que aparece en
`MANIFIESTO.json`.
