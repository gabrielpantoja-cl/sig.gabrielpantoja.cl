# Corte público verificable del registro

**Creado:** 2026-11-02.

El registro de transacciones de suelo se publica periódicamente como un paquete
autocontenido y **verificable por terceros**: cualquiera puede comprobar que el
archivo que tiene en sus manos es exactamente el que se publicó, y demostrar que
una inscripción concreta formaba parte del corte, sin necesidad de confiar en
quien lo sirve ni de descargar el resto.

Este documento especifica el formato del paquete y cómo verificarlo. La
operación de los respaldos no se documenta acá ni en ningún archivo público
(ver [`estado.md`](./estado.md): tampoco se publican horarios, ubicaciones ni
roles).

---

## 1. Para qué sirve

Un dataset que solo existe en un sitio web depende de que ese sitio siga en pie
y de que nadie haya editado las cifras. Un corte verificable rompe las dos
dependencias:

- **Direccionamiento por contenido.** El manifiesto publica el SHA-256 de cada
  archivo. Una copia obtenida de cualquier espejo, réplica P2P o repositorio
  archivístico se valida contra el mismo manifiesto. No hace falta que la fuente
  sea de confianza.
- **Prueba de inclusión.** La raíz de Merkle permite demostrar que una
  inscripción estaba en el corte entregando ~17 hashes, sin revelar las demás
  filas. Es la propiedad que un respaldo común no puede ofrecer.

## 2. Contenido del paquete

| Archivo | Qué es |
|---|---|
| `referenciales.csv` | El corte, una fila por inscripción |
| `referenciales.geojson` | Lo mismo como puntos (EPSG:4326) |
| `referenciales.pmtiles` | Tileset vectorial para un visor estático |
| `conservadores.csv` | Catálogo de conservadores |
| `hojas.txt` | Una hoja de Merkle por línea, en el orden del corte |
| `MANIFIESTO.json` | Conteos, SHA-256 por archivo y raíz de Merkle |
| `index.html` | Visor estático, sin dependencias de servidor |
| `LEEME.md` · `LICENSE` · `CITATION.cff` | Procedencia, licencia y cómo citar |

## 3. Columnas

```
id, lat, lng, monto, montoUf, anio, comuna, predio, superficie,
rol, destino, fechaEscritura, fechaInscripcion, fojas, numero, conservador
```

Es el mismo conjunto que expone `/api/points`.

**Campos prohibidos, nunca incluidos:** `comprador`, `vendedor`, `rut`,
`userId`, `observaciones` (Ley 19.628). `rol` **sí** es público: es el
identificador de rol del SII, no un dato personal.

`id` se publica a propósito: sin un identificador estable no se puede emitir una
prueba de inclusión para una fila concreta.

> El riesgo real no es que se agregue una columna prohibida —el conjunto está
> fijo en el script—, sino que un dato personal se filtre **dentro de** una
> columna permitida (un nombre arrastrado a `predio`, por ejemplo). Una vez
> publicado y anclado, no se puede borrar.

## 4. Canonicalización

Cada fila se serializa de forma determinista e inyectiva antes de hashearla:

| Regla | Razón |
|---|---|
| Columnas en el **orden fijo** de §3, separadas por tabulador | El orden es parte del contrato |
| `NULL` → `\N` | Un `NULL` y la cadena vacía no son lo mismo |
| Números: representación decimal más corta que round-trips; `-0` se normaliza a `0` | Estable entre plataformas y versiones |
| Se escapan `\`, tabulador y saltos de línea | Sin escape, dos filas distintas podrían canonicalizarse igual y la raíz dejaría de ser inyectiva |
| Un numérico no finito es un error, no `NaN` | Un `NaN` silencioso envenenaría la raíz |

**Cambiar el orden de columnas cambia la raíz de todas las filas.** Si hay que
añadir una columna, va al final y se sube `version_corte` del manifiesto.

## 5. Árbol de Merkle

1. `hoja_i = SHA-256(fila_canónica_i)` en UTF-8.
2. Árbol binario sobre las hojas **en el orden del corte**.
3. Un nivel con número impar de nodos **duplica el último**.

El paso 3 sigue el patrón de Bitcoin, que admite colisiones de árbol
([CVE-2012-2459](https://nvd.nist.gov/vuln/detail/CVE-2012-2459)) cuando el
número de hojas no está fijado. Acá no es explotable: el manifiesto publica
`n_hojas` junto a la raíz, así que la cantidad de hojas forma parte de lo que se
verifica.

## 6. Cómo verificar

### Que el paquete es íntegro

```bash
sha256sum referenciales.csv     # comparar con MANIFIESTO.json → archivos
```

### Que una inscripción estaba en el corte

Con `id` y los campos de la fila, se reconstruye la fila canónica, se calcula su
hoja y se combina con los hermanos de la prueba hasta llegar a la raíz. Las
funciones puras están en `scripts/corte-publico.mjs` (`canonizarFila`, `hoja`,
`raizMerkle`, `pruebaInclusion`, `verificarInclusion`) y sus garantías están
cubiertas por `scripts/corte-publico.test.mjs`.

La prueba crece con el logaritmo del número de filas: para un corte de cientos de
miles de inscripciones son del orden de 18 hashes, ~1 KB.

## 7. Generar el corte

```bash
node scripts/corte-publico.mjs --salida corte
node scripts/corte-publico.mjs --salida corte --limite 500   # prueba
```

El script detecta además **filas modificadas o desaparecidas** respecto del corte
anterior comparando los conjuntos de hojas, y sale con código `2` si las hay. El
registro es casi solo incremental: una fila que cambia de contenido es una señal
que hay que revisar antes de publicar, no un resultado esperado.

`tippecanoe` y el CLI de `pmtiles` no corren bien en Windows: el `.pmtiles` se
construye en CI sobre Linux o en un contenedor. El resto del paquete se genera
con Node, sin dependencias adicionales.

> Generar el corte lee la tabla completa. Es un trabajo **periódico**, no
> continuo; `--limite` existe para probar el pipeline sin leerla entera.

## 8. Qué NO resuelve

Un hash y una raíz de Merkle hacen la manipulación **detectable y demostrable**.
No restauran ni una fila, y no mantienen ninguna copia viva. La durabilidad
depende de que existan réplicas independientes —espejos estáticos, depósito
archivístico con DOI, réplicas P2P— y esa parte no la resuelve la criptografía:
la resuelve que otras personas tengan el archivo.

Por eso el corte se publica con licencia abierta, procedencia dentro del propio
paquete y un pipeline de construcción reproducible: para que cualquiera pueda
conservarlo y, si hiciera falta, continuarlo.
