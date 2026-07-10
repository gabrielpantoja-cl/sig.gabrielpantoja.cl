# Rediseño SIG: mapa dominante con paneles flotantes + capa de límite urbano

> **Implementado** (commit `4724fa6`). Se conserva como registro de diseño;
> los paneles evolucionaron después a dropdowns anclados y el panel de capas
> a filas con triángulo de despliegue — ver `docs/arquitectura-capas.md`.

## Contexto

Hoy `sig.gabrielpantoja.cl` apila verticalmente: header (2 líneas) → filtros
(siempre visibles en desktop) → franja de estadísticas → mapa → footer. El
mapa termina compitiendo por espacio vertical con controles que el usuario
casi no usa navegando visualmente (paneo/zoom), según su propio uso diario.
El objetivo es reorganizar la vista de inicio para que el **mapa sea el
protagonista** (como un visor profesional tipo ArcGIS Experience Builder —
referencia: "IDE-MINAGRI", con barra superior delgada, ícono de
capas/herramientas y buscador flotando sobre un mapa a pantalla completa) y
mover la búsqueda por predio/ROL y los filtros numéricos a paneles flotantes
independientes de la navegación visual. Además se agrega una nueva capa
oficial de **límite urbano** (MINVU) para distinguir visualmente suelo
urbano normado vs. rural al navegar el mapa.

Decisiones ya confirmadas con el usuario:
- La franja de estadísticas también se convierte en panel flotante colapsable
  (no una franja fija).
- Solo un panel flotante abierto a la vez (como los widgets de ArcGIS
  Experience Builder) — al abrir uno se cierran los demás.

Nota de datos: el modelo público (`src/lib/types.ts` → `MapPoint`) **no
incluye nombre del propietario** — por diseño, ese dato nunca se expone
(Ley 19.628, ver `AGENTS.md`/reglas de privacidad). La "búsqueda por palabra
clave" solo puede operar sobre `predio` (nombre del predio) y `rol` (ID SII,
público), que son los campos ya soportados por `/api/points` hoy.

## Diseño de paneles flotantes

**`src/components/MapPanel.tsx` (nuevo)** — generaliza el patrón visual que
ya existe en `LayersControl.tsx` (botón con ícono + tarjeta colapsable:
`rounded-lg border border-black/15 bg-[var(--background)]/95 shadow-lg
backdrop-blur dark:border-white/20`) en un componente controlado y
reutilizable:

```ts
type PanelId = 'search' | 'filters' | 'layers' | 'stats';
function MapPanel({ id, activeId, onActivate, icon, label, badge?, widthClassName, children })
```

La exclusión mutua vive en `page.tsx`, no en cada panel:

```ts
const [activePanel, setActivePanel] = useState<PanelId | null>(null);
const togglePanel = (id: PanelId) => setActivePanel(p => p === id ? null : id);
```

- **Buscar** y **Filtros** quedan como dos íconos separados (no uno
  combinado): son dos modos mentales distintos (búsqueda puntual por
  predio/ROL vs. filtros exploratorios por rango) y fusionarlos obligaría a
  adivinar en el frontend qué escribió el usuario, tocando la lógica de
  `queryString` que hoy no necesita cambiar. Costo de tenerlos separados es
  bajo porque `activePanel` ya resuelve la exclusión mutua gratis.
- **Capas** (`LayersControl.tsx`, modificado): pierde su `useState(open)`
  propio y pasa a envolver su body actual en `<MapPanel id="layers">`. Se le
  agrega una tercera fila de checkbox "Límite urbano (PRC)" con swatch ámbar
  y su línea de atribución, después de "Áreas protegidas (RNAP)".
- **Estadísticas**: nuevo panel con los 6 `<Stat>` actuales en grid 2x3.
- Ningún estado de filtros/búsqueda se mueve de dueño — sigue todo en
  `page.tsx` (`comuna`, `anioFrom`, `montoMin/Max`, `supMin/Max`, `predio`,
  `rol`, `queryString`, `debouncedQs`, el `useEffect` de fetch, etc., sin
  cambios). Solo se extrae el JSX de los `<label>` actuales a un nuevo
  **`src/components/FieldGroups.tsx`** con tres exports presentacionales
  (`SearchFields`, `FilterFields`, `StatsFields`, más el `<Stat>` tile
  movido ahí) para reutilizarlos tanto en los paneles de desktop como en el
  drawer mobile consolidado.

## Layout / posicionamiento (desktop, `md:`+)

Todos los elementos flotantes son hermanos absolutos dentro de la
`<section>` del mapa, igual que `LayersControl` hoy:

- Control de zoom de Leaflet: sin cambios (top-left nativo).
- Clúster **Buscar / Filtros / Estadísticas**: `absolute left-14 top-3
  z-[600] flex items-start gap-2` — `left-14` deja espacio al control de
  zoom, mismo `top-3` para quedar "al lado" como en la referencia
  IDE-MINAGRI. Anchos: Buscar `w-72`, Filtros `w-80`, Estadísticas `w-72`.
- **Capas**: se mantiene en `right-3 top-3 z-[600]` (sin cambios de
  posición).
- Botón "i" de información: dentro del header (no sobre el mapa), dropdown
  propio con su propio `useState` (no participa de `activePanel`).
- Loader / overlay de error: sin cambios (`z-[500]`).
- Opcional: barra de escala de Leaflet (`L.control.scale({position:
  'bottomleft'}).addTo(map)`) en el efecto de inicialización — sin
  componente nuevo, cero presupuesto de z-index adicional.

No se necesita ningún nivel de z-index nuevo: se reutilizan 500 (loader),
600 (los cuatro paneles flotantes del mapa — nunca se superponen entre sí
espacialmente) y 1100/1101 (drawer mobile, sin cambios).

## Header y footer

- **Header**: se reduce a una sola fila (`px-4 py-2.5 md:px-6 md:py-3
  border-b`) con un `<h1>` real (hoy no existe heading, es un bug de
  accesibilidad) a la izquierda y el botón "i" a la derecha. El párrafo de
  descripción (2 líneas, mensaje de privacidad Ley 19.628) se traslada al
  dropdown del nuevo **`InfoPanel.tsx`**.
- **Footer**: se elimina por completo; su única frase de atribución se
  pliega como segundo párrafo dentro de `InfoPanel`. Es el movimiento que
  más espacio recupera para el mapa y evita un segundo elemento "flotante
  de info" compitiendo con el borde inferior del mapa.
- No hace falta ningún `h-[calc(100dvh-Npx)]`: `layout.tsx` ya tiene la
  cadena `h-full` / `min-h-full flex flex-col` y `<main className="flex
  flex-1 flex-col">`; al quitar la fila de toolbar mobile y el footer, la
  `<section>` del mapa con `flex-1` ya ocupa el resto del viewport
  automáticamente. Ajustar el piso de seguridad mobile de `min-h-[55vh]`
  a `min-h-[70vh]` (header ahora mucho más bajo).

## Mobile

- Se quita la fila de toolbar actual (`md:hidden`, en flujo) y se reemplaza
  por un botón flotante (FAB) `fixed bottom-4 left-1/2 z-[600]
  -translate-x-1/2` con texto "Buscar y filtrar" + badge de filtros activos
  + contador de resultados — abre el mismo drawer de siempre (se renombra
  `filtersOpen` → `drawerOpen`, mecánica CSS del bottom-sheet sin cambios).
- El clúster desktop (Buscar/Filtros/Estadísticas) se envuelve en `hidden
  md:flex` — en mobile solo vive dentro del drawer consolidado.
- `LayersControl` **no** se oculta en mobile — sigue visible en
  `right-3 top-3` en todos los tamaños (pedido explícito del usuario).
- El drawer consolidado agrega tres subsecciones con separadores
  (`<h2>Buscar</h2>`, `<h2>Filtros</h2>`, `<h2>Estadísticas</h2>`), todas
  renderizando los mismos componentes de `FieldGroups.tsx` que usa desktop
  — una sola implementación de cada control.

## Nueva capa: Límite Urbano (MINVU)

**Fuente oficial** (verificada en vivo): servicio ArcGIS REST nacional del
MINVU — `https://geoide.minvu.cl/server/rest/services/IPT/Limites_Urbanos/FeatureServer/0`
(capa `Limites_Urbanos_PRC`, límites urbanos de Planes Reguladores
Comunales), **601 features** a nivel país (confirmado con
`returnCountOnly=true`, muy por debajo del límite de 2000 registros por
consulta — no requiere paginación). Campos: `REG`, `COM`, `NOM`, `INSTRUM`,
`ADMIN`, `P_DO`/`N_DO`/`T_DO` (publicación en el Diario Oficial). Se puede
pedir directo como GeoJSON en WGS84 con una sola consulta HTTP (reproyección
server-side vía `outSR=4326`, sin necesidad de zip/unzip ni de librería de
reproyección):

```
.../FeatureServer/0/query?where=1=1&outFields=REG,COM,NOM,INSTRUM,ADMIN,P_DO,N_DO,T_DO&outSR=4326&f=geojson
```

Este es el catálogo nacional oficial de límite urbano (Centro de Estudios de
Ciudad y Territorio, MINVU), listado también en el geoportal nacional
IDE Chile (geoportal.cl).

**`scripts/build-urban-limit.mjs` (nuevo)** — mismo patrón de
`build-protected-areas.mjs` pero sin descarga de zip: `fetch()` directo de
la URL de consulta → mapshaper con simplificación más suave que la de áreas
protegidas (`visvalingam weighted 5% keep-shapes`, precisión `0.00001`,
igual que hoy) porque un límite urbano se mira a zooms altos donde
sobre-simplificar se nota; `-filter-fields` a los 8 campos listados
(se mantienen en mayúsculas, igual que la fuente, sin renombrar); escribe
`public/data/limite-urbano.geojson` + `.meta.json` (mismo manifiesto de
procedencia: fuente/licencia/fecha/CRS/campos/proceso/versión de mapshaper).
`package.json`: se separa `data:build` en `data:build:protected` +
`data:build:urban`, y `data:build` corre ambos en secuencia.

**`src/lib/urban-limit.ts` (nuevo)** — sin mapa de colores por categoría
(es un solo tipo de límite, a diferencia de las 12 designaciones de áreas
protegidas): interfaz `UrbanLimitProps` + estilo fijo:

```ts
export const URBAN_LIMIT_STYLE = {
  color: '#c2410c', fillColor: '#f59e0b', fillOpacity: 0.08,
  weight: 1.5, opacity: 0.9,
} as const;
```

Color ámbar/naranja para contrastar con el verde de los puntos CBR y de
áreas protegidas — a confirmar visualmente una vez cargada la capa (ajuste
menor de estilo, no bloquea implementación).

**`src/components/MapView.tsx` (modificado)** — nuevo prop
`showUrbanLimit`, nuevo `urbanLimitRef`, nuevo `useEffect` estructuralmente
igual al de áreas protegidas (`fetch('/data/limite-urbano.geojson')` →
`L.geoJSON` con `URBAN_LIMIT_STYLE` → popup vía nueva `buildUrbanLimitPopup`
con el mismo patrón de escape HTML manual que ya usan `buildPopup` /
`buildProtectedPopup`).

**Orden de capas (crítico con 3 overlays en el mismo `overlayPane` por
`preferCanvas: true`)**: hoy solo hay dos overlays y un `bringToBack()`
suelto alcanza; con tres capas asíncronas independientes (puntos CBR, áreas
protegidas, límite urbano) eso es una condición de carrera. Se centraliza en
un helper `reorderOverlays()` dentro de `MapView`, llamado al final de las
tres `useEffect` que tocan capas:

```ts
const reorderOverlays = useCallback(() => {
  protectedRef.current?.bringToBack();    // más al fondo
  urbanLimitRef.current?.bringToFront();  // sobre áreas protegidas, bajo los puntos
  clusterRef.current?.bringToFront();     // siempre al frente (clicables)
}, []);
```

Es idempotente y converge al orden correcto sin importar en qué orden
resuelvan los `fetch()`.

## Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `src/components/MapPanel.tsx` | Nuevo — panel flotante genérico controlado |
| `src/components/FieldGroups.tsx` | Nuevo — `SearchFields`/`FilterFields`/`StatsFields`/`Stat`, extraídos de `page.tsx` |
| `src/components/InfoPanel.tsx` | Nuevo — botón "i" + dropdown con descripción y atribución |
| `src/components/LayersControl.tsx` | Modificar — usa `MapPanel`, agrega checkbox+leyenda de límite urbano |
| `src/components/MapView.tsx` | Modificar — prop `showUrbanLimit`, efecto de capa, `reorderOverlays()`, popup nuevo, barra de escala opcional |
| `src/lib/urban-limit.ts` | Nuevo — tipos + estilo + atribución de la capa |
| `src/app/page.tsx` | Modificar (el más grande) — header a 1 fila + `InfoPanel`, elimina footer, elimina toolbar/franja de stats en flujo, agrega clúster de paneles flotantes desktop + FAB/drawer mobile consolidado, nuevo estado `activePanel`/`showUrbanLimit`/`drawerOpen` |
| `scripts/build-urban-limit.mjs` | Nuevo — ETL desde ArcGIS REST MINVU |
| `package.json` | Modificar — split de `data:build` |
| `public/data/limite-urbano.geojson`, `.meta.json` | Generados por el script nuevo |

## Verificación al implementar

1. `npm run data:build:urban` → confirma 601 features, revisa tamaño del
   GeoJSON resultante y el `.meta.json`.
2. `npm run dev` → probar en `localhost:3000`:
   - Desktop: abrir/cerrar cada panel flotante (Buscar, Filtros, Capas,
     Estadísticas) y confirmar exclusión mutua; verificar que los filtros
     siguen filtrando el mapa igual que antes (comuna, año, monto,
     superficie, ROL, predio) y que CSV/GeoJSON export siguen funcionando.
   - Activar "Límite urbano" junto con "Áreas protegidas" y confirmar que
     los puntos CBR siguen siendo clicables (popups abren) y que el límite
     urbano se ve por encima del relleno de áreas protegidas.
   - Mobile (devtools responsive o teléfono real): FAB abre el drawer
     consolidado con las tres subsecciones; Capas sigue flotando arriba a
     la derecha.
3. `npm run lint` y `npm run build` sin errores.
4. Revisar contraste del ámbar de límite urbano en modo claro y oscuro.
