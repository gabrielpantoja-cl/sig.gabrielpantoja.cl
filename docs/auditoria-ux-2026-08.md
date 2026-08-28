# Auditoría de uso — 2026-08-28

> Sesión de inspección del SIG en `localhost:3000` conducida con Playwright,
> adoptando el criterio de un **usuario avanzado de SIG** (perito/tasador
> acostumbrado a QGIS o ArcGIS Pro) trabajando un caso real: buscar una
> comuna, apilar capas de contexto, bajar a escala predial y sacar el anexo
> gráfico del informe.
>
> Commit auditado: `3a79851` · versión `0.5.0` · Next.js 16.2.9 (dev).
> Recorrido: carga inicial → panel de capas → geocodificación de Paillaco →
> apilado de 5 capas → zoom z7→z18 → mapa de calor → export PNG → mobile 390 px.

Los hallazgos se ordenan por severidad, no por esfuerzo. Cada uno lleva
**evidencia** (lo que se observó) y **por qué importa** desde el oficio, no
desde el gusto. Los ítems accionables están además listados como casillas en
[`roadmap.md` § Mejoras no-capa](./roadmap.md#mejoras-no-capa-ux-y-producto--independiente-de-las-fases).

## Nota metodológica

Un hallazgo intermedio de esta sesión resultó **falso** y se descarta
explícitamente para que nadie lo persiga: se creyó que la capa de suelos
agrológicos no refrescaba su `ImageOverlay` al hacer zoom o paneo. El error
venía del instrumento, no del SIG — `performance.getEntriesByType('resource')`
tiene un buffer de 250 entradas que ya estaba lleno de tiles, así que las
peticiones nuevas no aparecían. Con el log de red real, `/api/suelos/export`
se pidió **9 veces**, con el bbox siguiendo el viewport en cada movimiento. La
capa funciona como está documentado. *Lección para futuras auditorías: medir
red con el log del navegador, no con la Performance API.*

---

## P0 — El export a PNG está roto

**Evidencia.** Con la capa CBR encendida, pulsar «Exportar PNG» no descarga
nada. No hay evento `download` en 30 s, el botón vuelve a «Exportar PNG»
habilitado y **no se muestra ningún mensaje de error**. En consola:

```
TypeError: cluster.getAllChildMarkers is not a function
    at drawCbrMarkers (src/lib/map-export.ts)
    at exportMapToPng
    at handleExportClick
```

**Causa raíz.** `src/lib/map-export.ts:377` llama
`cluster.getAllChildMarkers()` sobre el **`MarkerClusterGroup`**. Ese método
existe en `L.MarkerCluster` (un nodo del árbol de clústeres), no en el grupo:
en `leaflet.markercluster@1.5.3` el grupo implementa `getLayers()`
(`leaflet.markercluster-src.js:513`) y expone `getAllChildMarkers` solo en la
clase de clúster (`:1440`). El equivalente público en el grupo es
`getLayers()`.

Lo que hace este bug especialmente peligroso es **por qué pasó la CI**:
`@types/leaflet.markercluster` **declara** `getAllChildMarkers(): Marker[]`
en la interfaz de `MarkerClusterGroup` (`index.d.ts:250`) aunque la librería
no lo implemente ahí. Los tipos mienten, `tsc --noEmit` pasa en verde y el
fallo solo aparece al pulsar el botón. Ningún test lo cubre porque el
proyecto no tiene framework de test.

**Por qué importa.** El PNG con brújula, escala, cajetín de trazabilidad y
atribuciones es el entregable del SIG hacia afuera: es el anexo del informe
de tasación. Está caído y falla en silencio.

**Corrección.** Sustituir por `cluster.getLayers()`. Y, dado que el
`Promise.race` con timeout se diseñó justo para no dejar al usuario colgado,
añadir un `catch` que informe el fallo en pantalla en vez de dejar la
excepción subir sin traza visible.

- [ ] **P0** Arreglar `drawCbrMarkers` (`getLayers()`) y mostrar un error
      visible si el export falla.
- [ ] **P0** Cubrir el export con una prueba de humo (es la tercera vez que
      una API de terceros con tipos optimistas rompe esta ruta — ver el
      comentario sobre `leaflet-image` en la cabecera de `map-export.ts`).

---

## P1 — El visor no da las herramientas mínimas de un SIG

Inventario de controles hallados en el DOM: zoom, barra de escala gráfica y
atribución. **Eso es todo.** Lo que un usuario avanzado busca y no encuentra:

### 1.1 Sin lectura de coordenadas

No hay indicador de la posición del cursor ni del centro. En un SIG de suelo
chileno esto no es un adorno: el perito trabaja con **UTM huso 19S**
(EPSG:32719) porque así vienen los deslindes del plano y las coordenadas del
Conservador, y necesita poder leer y copiar un par de coordenadas de
cualquier punto. Hoy no hay forma de saber dónde se está parado.

- [ ] Barra de estado con lat/lon y UTM 19S del cursor, con copiar al
      portapapeles. (Se cruza con «Búsqueda por coordenadas», ya en el
      roadmap: son las dos mitades de la misma función.)

### 1.2 Sin escala numérica

La barra gráfica dice «50 km» o «30 m», pero no hay razón de escala
(`1:25.000`). Un informe de tasación **cita la escala numérica**; sin ella el
PNG exportado no cumple la convención cartográfica que espera el destinatario.

- [ ] Mostrar escala numérica junto a la gráfica, en pantalla y en el PNG.

### 1.3 Sin medición de distancias ni superficies

No existe herramienta de medida. Medir un deslinde o estimar la superficie de
un retazo es, literalmente, el trabajo. Hoy hay que exportar e irse a QGIS.

- [ ] Herramienta de medir (polilínea y polígono), con resultado en m/km y
      m²/ha, y opción de fijar la medición para que salga en el PNG.

### 1.4 Sin control de opacidad por capa

Verificado: el único `input[type=range]` del documento es el filtro de año.
Con «Suelos agrológicos» + «Límites comunales» encendidos (raster al 0,6 fijo
+ rellenos pastel por comuna), el mapa base queda ilegible: desaparecen los
nombres de localidad y los caminos justo cuando se los necesita para ubicarse.
Cualquier visor serio resuelve esto con un deslizador por capa.

- [ ] Deslizador de opacidad por capa en `LayersControl` (mínimo para las
      capas de relleno: suelos, vegetacional, comunas, frutícola).

### 1.5 Sin reordenar capas

El orden de apilado está fijo en `reorderOverlays()`. Es un orden razonable,
pero es *el* orden: el usuario no puede poner drenaje sobre red vial para
seguir un curso de agua bajo un puente.

- [ ] Permitir arrastrar para reordenar, o al menos «traer al frente» por capa.

---

## P2 — Las leyendas están donde no se pueden usar

### 2.1 La leyenda vive dentro del panel de capas, que hace scroll

Cada capa esconde su leyenda tras un chevron dentro de `LayersControl`. Con
cinco capas encendidas la tarjeta topa su `max-h` y las leyendas quedan
cortadas a media línea (observado: «Clase III · Arable, limitacion…» cortado
en el borde inferior del panel). Para leer el mapa hay que hacer scroll dentro
de un panel que además tapa el mapa que se quiere leer.

### 2.2 La leyenda de una capa apagada sigue mostrándose

Reproducido: apagar «Suelos agrológicos» deja el checkbox vacío pero la lista
de clases I…VIII desplegada, ocupando el panel y describiendo algo que ya no
está en pantalla.

### 2.3 El mapa de calor se dibuja sin leyenda visible

Es el caso más grave de los tres, porque un mapa de calor **es** su escala de
color: sin ella el raster no significa nada. La leyenda, cuando se despliega,
es de una calidad notable — cortes de cuantiles ($131k / $217k / $303k),
explicación de que la opacidad codifica cobertura, recuento de celdas y de
transacciones agregadas, y el descargo «señal de mercado, no tasación». Todo
ese trabajo está escondido detrás de un chevron.

- [ ] Leyenda flotante en el mapa (colapsable) que muestre **solo las capas
      encendidas**, y que se apague junto con su capa.
- [ ] La leyenda del mapa de calor debe ser visible por defecto mientras la
      capa esté activa.

### 2.4 La superficie de calor no comunica cuán poco dato la sostiene

En la vista auditada el raster se dibujó a partir de **2 celdas y 4
transacciones**, con el mismo aspecto suave y continuo que tendría con
cuatro mil. El texto lo declara con honestidad; el dibujo no. Un usuario que
no despliega la leyenda lee una superficie de valor donde hay cuatro escrituras.

- [ ] Bajo un umbral de celdas/transacciones en el viewport, degradar el
      render (rayado, o puntos en vez de superficie) o mostrar un aviso
      sobre el mapa, no solo dentro del panel.

---

## P3 — Accesibilidad

### 3.1 El combobox del geocoder está mal cableado en ARIA

El input declara `role="combobox"`, `aria-expanded` y `aria-controls`
apuntando a un `<ul role="listbox">`, pero **ninguno de sus `<li>` tiene
`role="option"`** y no hay `aria-activedescendant`. Verificado en vivo:
`document.querySelectorAll('[role="option"]').length === 0` con dos
sugerencias visibles en pantalla. Para un lector de pantalla hay un listbox
vacío. Además, el `<li>` de atribución («© OpenStreetMap · Nominatim») es
hijo directo del listbox, donde ARIA solo admite `option` o `group`.

- [ ] Completar el patrón combobox: `role="option"` + `id` por sugerencia,
      `aria-activedescendant` en el input, y sacar la atribución fuera del
      `<ul>`.

### 3.2 Hay dos geocoders simultáneos en el DOM

Las variantes mobile y desktop se renderizan ambas (una oculta por CSS), de
modo que existen dos comboboxes con la misma etiqueta accesible «Buscar
dirección o lugar». Un lector de pantalla anuncia dos buscadores idénticos.
(También hace ambiguo cualquier selector de prueba automatizada.)

- [ ] Renderizar una sola instancia, o marcar la oculta con `aria-hidden` +
      `inert`.

---

## P4 — Mobile (390 × 844)

- El panel «Capas» abierto ocupa ~80 % de la pantalla y **tapa el mapa
  completo**. La app ya resuelve bien este problema para los filtros con un
  drawer inferior; el panel de capas debería usar el mismo patrón.
- La atribución de Leaflet se envuelve en tres líneas y **choca con el FAB
  «Buscar y filtrar»**: queda texto ilegible y superpuesto en el borde
  inferior.
- El chip del mapa base queda apretado entre la barra de escala y el FAB.

- [ ] Panel de capas como drawer inferior en mobile, igual que los filtros.
- [ ] Reservar el borde inferior: atribución, escala, chip de mapa base y FAB
      necesitan un reparto explícito, no superponerse.

---

## P5 — Peso y carga

`/api/points` devuelve **21,4 MB** de JSON en una sola respuesta (medido sin
compresión en dev; en producción Vercel lo comprime en tránsito, pero el
navegador igual materializa ~85k objetos en memoria). El arranque medido fue
bueno — ~1,0 s hasta cerrar el loader, con `/api/points` respondiendo en
177 ms contra Neon — así que **no es un problema de latencia hoy**, sino de
techo: cada transacción nueva engorda una descarga que ya se hace entera antes
de pintar el primer punto, y en un móvil con red móvil eso se nota.

Las capas estáticas suman **5,6 MB** de GeoJSON cuando se encienden cinco
(drenaje 2,1 MB, protegidas 1,6 MB, vial 1,1 MB, comunas 0,8 MB), cada una
descargada completa aunque el usuario esté mirando una comuna.

- [ ] Evaluar carga por viewport o teselado vectorial para los puntos CBR y
      para las capas estáticas grandes. (Se cruza con la «Migración de
      almacenamiento de GeoJSON» ya planeada para Q4-2026 en el roadmap.)
- [ ] Reducir el payload de `/api/points` en el cable: nombres de campo
      cortos o formato columnar. Es la vía barata antes de rediseñar la carga.

---

## Lo que está bien y conviene no romper

Una auditoría que solo enumera defectos miente por omisión. Estas cosas están
resueltas mejor que en la mayoría de los visores públicos chilenos:

- **La honestidad estadística del mapa de calor.** Declara el n, el mínimo por
  celda, que los cortes son cuantiles recalculados sobre lo visible, que la
  opacidad codifica cobertura y que es señal de mercado y no tasación. Es el
  estándar correcto y hay que sostenerlo al mover la leyenda.
- **La trazabilidad de fuentes.** Cada capa nombra su organismo, su año de
  levantamiento y su licencia, y el PNG lleva cajetín. Un perito puede
  defender de dónde salió cada línea.
- **La capa de suelos remota.** Un PNG por viewport en vez de WMS teselado, con
  aviso en pantalla cuando el servicio CIREN responde o falla («✓ Servicio
  CIREN operativo en esta vista»). Decisión correcta y bien explicada.
- **El selector de mapa base** recién incorporado: cambia proveedor, filtro y
  atribución de forma coherente, incluida la del PNG.

---

## Resumen priorizado

| # | Hallazgo | Severidad | Costo |
|---|---|---|---|
| 1 | Export PNG roto (`getAllChildMarkers`), sin aviso al usuario | **P0** | S |
| 2 | Sin lectura de coordenadas (lat/lon + UTM 19S) | P1 | S |
| 3 | Sin escala numérica (`1:25.000`) | P1 | S |
| 4 | Sin herramienta de medición | P1 | M |
| 5 | Sin opacidad por capa | P1 | S |
| 6 | Sin reordenar capas | P1 | M |
| 7 | Leyendas atrapadas en el panel; leyenda de capa apagada persiste | P2 | M |
| 8 | Mapa de calor sin leyenda visible | P2 | S |
| 9 | Superficie de calor con n mínimo se ve igual que con n alto | P2 | S |
| 10 | Combobox del geocoder sin `role="option"` | P3 | S |
| 11 | Dos geocoders en el DOM | P3 | S |
| 12 | Panel de capas tapa el mapa en mobile | P4 | M |
| 13 | Atribución choca con el FAB en mobile | P4 | S |
| 14 | `/api/points` de 21 MB sin carga por viewport | P5 | L |

Orden sugerido de ataque: **1** (está roto), luego **2 + 3 + 5 + 8** (cuatro
cambios chicos que juntos cambian la categoría del visor), después **7 y 12**
(rediseño de leyendas y del panel en mobile, que conviene hacer de una sola
vez), y **14** cuando toque la migración de almacenamiento ya planeada.
