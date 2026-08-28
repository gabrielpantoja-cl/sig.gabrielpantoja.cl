/**
 * Export del mapa visible a PNG.
 *
 * Hoja de ruta de la rasterización (tres pistas separadas):
 *
 *  1. **Tiles + vectores** — Implementación propia (NO usamos leaflet-image:
 *     v0.4.0 tira `Cannot read properties of undefined (reading 'match')` en
 *     `addCacheString` cuando `layer.getTileUrl()` devuelve un valor no-string
 *     para tiles en el borde del mundo, y eso rompe la cadena de `d3-queue`
 *     dejando el callback pendiente — el botón quedaba en "Generando PNG…" para
 *     siempre).
 *
 *     Para los tiles: recorremos `map.eachLayer` y por cada `L.TileLayer`
 *     bajamos los tiles del viewport a un `<canvas>` propio vía `Image()`. Si
 *     la URL falla, el tile se descarta individualmente (`Promise.allSettled`),
 *     el export sigue.
 *
 *     Para los vectores: con `preferCanvas: true` (configurado en MapView),
 *     Leaflet crea un `L.Canvas` renderer con su propio `<canvas>` dentro de
 *     `.leaflet-overlay-pane`. **Esa** canvas es la que contiene los GeoJSON
 *     (áreas protegidas, PRC, DPA, red caminera, drenaje, catastro frutícola,
 *     polígonos KML del usuario). La buscamos con `querySelector('canvas')` y
 *     la copiamos al canvas maestro vía `getBoundingClientRect` para
 *     respetar el offset que Leaflet aplica por paneo y zoom-animation. La
 *     `_pathRoot` que usaba el viejo Leaflet (0.x) NO existe en 1.9.x.
 *
 *  2. **Pines CBR** — `MarkerClusterGroup` con `divIcon` no se rasteriza en
 *     canvas ni en `imageOverlay`, así que se compositea encima con
 *     `getAllChildMarkers()` + `getVisibleParent()` del cluster: cada marker
 *     hijo se reduce a su burbuja visible, y se pinta con primitivas del canvas
 *     (sprite SVG para pines sueltos, círculo+texto para los clusters). La
 *     ventana visible del mapa con un 10% de buffer evita pintar lo que queda
 *     fuera.
 *
 *  3. **Marco** — encima de todo: brújula estilo cartográfico en la esquina
 *     superior derecha (tick marks de 30°, aguja roja al norte tipo N, sans-
 *     serif limpio para la letra 'N'), barra de escala en la inferior
 *     izquierda (mismo algoritmo de ground resolution que `L.Control.Scale`),
 *     y strip de atribución abajo con las capas activas y OpenStreetMap como
 *     base obligatoria.
 *
 * El producto final se descarga como `sig-suelo-{YYYY-MM-DD-HHMM}.png` con
 * `canvas.toBlob()` + anchor click. Un `Promise.race` con timeout garantiza
 * que si algo se cuelga a mitad de captura, el botón se libere en vez de
 * quedar para siempre como "Generando PNG…".
 */
import L from 'leaflet';
import 'leaflet.markercluster';
import { cbrPinSvg } from '@/lib/cbr-points';
import {
  BASEMAP_FILTER,
  basemapFilterKey,
  getBasemap,
  prefersDark,
  DEFAULT_BASEMAP_ID,
  type BasemapId,
} from '@/lib/basemap';

/** Tiempo máximo total para la captura del mapa antes de abortar y devolver
 *  un canvas parcial. Mantiene al usuario fuera del limbo si una red lenta,
 *  CORS roto o un tile problemático atora la exportación. */
const EXPORT_TIMEOUT_MS = 8000;

/* ---------- Atribuciones (resumen de cada capa activa + base OSM) ---------- */

// La atribución del mapa base sale del catálogo (`lib/basemap.ts`): cambia
// con el fondo elegido en el selector, y cada proveedor tiene su propia
// exigencia de licencia (ODbL para OSM, CC-BY-SA para OpenTopoMap, la
// fórmula de Esri para la ortoimagen). «Sin fondo» no acredita a nadie
// porque no se dibuja ningún tile de terceros.
const ATTRIBUTION_PROTECTED = 'MMA · Registro Nacional de Áreas Protegidas · CC0';
const ATTRIBUTION_URBAN = 'MINVU · IPT · geoide.minvu.cl';
const ATTRIBUTION_COMUNAS = 'SUBDERE · División Político-Administrativa 2023';
const ATTRIBUTION_RED_VIAL = 'MOP · Dirección de Vialidad';
const ATTRIBUTION_RED_DRENAJE = 'DGA · Banco Nacional de Aguas';
const ATTRIBUTION_LINEAS_TRANSMISION = 'Ministerio de Energía · IDE Energía · CEN';
const ATTRIBUTION_SUELOS = 'CIREN · Estudios Agrológicos';
const ATTRIBUTION_CATASTRO = 'CIREN-ODEPA · Catastro Frutícola';
const ATTRIBUTION_VEGETACIONAL = 'CONAF · Catastro de Recursos Vegetacionales';
const ATTRIBUTION_PROPIEDADES_RURALES = 'CIREN · Propiedades rurales';
const ATTRIBUTION_HEXBINS =
  'Mapa de calor: elaboración propia sobre inscripciones de los Conservadores de Bienes Raíces';

/* ---------- Captura base (tiles + vectores), propia ---------- */

/**
 * Itera `map.eachLayer` y por cada `L.TileLayer` descarga los tiles visibles
 * vía `Image()` con `crossOrigin='anonymous'` para no contaminar el canvas
 * con CORS, y los dibuja al canvas maestro en su posición de pixel exacta.
 * Las excepciones (red caída, URL inválida, tile sin CORS) se descartan
 * individualmente: el export sigue con los tiles que sí cargaron.
 */
async function drawTileLayersToCanvas(
  map: L.Map,
  ctx: CanvasRenderingContext2D,
  basemap: BasemapId,
): Promise<void> {
  const size = map.getSize();
  const pxBounds = map.getPixelBounds() as L.Bounds;
  const zoom = map.getZoom();

  const tileTasks: Promise<void>[] = [];

  map.eachLayer((layer) => {
    if (!(layer instanceof L.TileLayer)) return;
    // `tileSize` viene tipado como `number | Point` en @types/leaflet; en la
    // práctica OSM es siempre `number`, pero defendemos por si alguien enchufa
    // un `L.GridLayer` con un Point.
    const rawTileSize = layer.options.tileSize;
    const tileSize: number = typeof rawTileSize === 'number' ? rawTileSize : 256;
    const maxZoom = layer.options.maxZoom ?? 19;
    const minZoom = layer.options.minZoom ?? 0;
    if (zoom > maxZoom || zoom < minZoom) return;

    // Cuadrante de tiles que cubren el viewport en coordenadas de tile.
    const tileBounds = L.bounds(
      // `_floor` y `_pathRoot` / `_adjustTilePoint` son API privada de Leaflet
      // pero estable: la usan leaflet-image y todos los plugins de raster.
      // TS no los expone para no atar a un detalle de implementación, pero
      // los necesitamos para hacer lo mismo sin reimplementar el cálculo.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pxBounds.min as any).divideBy(tileSize)._floor(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pxBounds.max as any).divideBy(tileSize)._floor(),
    );

    for (let y = (tileBounds.min as L.Point).y; y <= (tileBounds.max as L.Point).y; y++) {
      for (let x = (tileBounds.min as L.Point).x; x <= (tileBounds.max as L.Point).x; x++) {
        const original = new L.Point(x, y);
        const adjusted = original.clone();
        // OSM usa wrapX=true (longitude wrap), pero `_adjustTilePoint` puede
        // mutar coords fuera de rango a una URL válida. leaflet-image confiaba
        // ciegamente en el resultado; aquí defendemos con try/catch + cast al
        // método privado de Leaflet (estable en runtime).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (layer as any)._adjustTilePoint === 'function') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (layer as any)._adjustTilePoint(adjusted);
          } catch {
            continue;
          }
        }
        if (adjusted.y < 0) continue;

        let url: string;
        try {
          // `getTileUrl` espera `L.Coords = { x, y, z }`; en runtime solo
          // necesita x e y (z lo lee Leaflet internamente desde `getZoom`),
          // así que casteamos a ese contrato.
          const raw = layer.getTileUrl(adjusted as unknown as L.Coords);
          if (typeof raw !== 'string' || raw.length === 0) continue;
          url = addCacheString(raw);
        } catch {
          continue;
        }

        // Posición en el canvas maestro: (x*tileSize - pxBounds.min.x,
        // y*tileSize - pxBounds.min.y). Reescrito a mano porque `scaleBy` y
        // `subtract` de `L.Point` están sobrecargadas en @types/leaflet y los
        // casts a `any` colapsan la inferencia de los argumentos.
        const pMin = pxBounds.min!;
        const tilePos = new L.Point(
          original.x * tileSize - pMin.x,
          original.y * tileSize - pMin.y,
        );

        tileTasks.push(loadAndDrawTile(url, tilePos, tileSize, ctx, size));
      }
    }
  });

  // El mapa en pantalla puede neutralizar los tiles con un filtro CSS sobre
  // `.leaflet-tile-pane` (ver lib/basemap.ts). El canvas no hereda ese filtro,
  // así que se replica con `ctx.filter` — misma gramática — durante el dibujo
  // de los tiles y se resetea después, para que los vectores que se compositan
  // encima conserven su color real. El filtro depende del mapa base elegido:
  // solo el lienzo neutro se filtra; el callejero, el satélite y el
  // topográfico se exportan con sus colores reales.
  const previousFilter = ctx.filter;
  ctx.filter = BASEMAP_FILTER[basemapFilterKey(basemap, prefersDark())];
  try {
    // `allSettled` para que un fallo individual no cancele el resto.
    await Promise.allSettled(tileTasks);
  } finally {
    ctx.filter = previousFilter;
  }
}

function loadAndDrawTile(
  url: string,
  tilePos: L.Point,
  tileSize: number,
  ctx: CanvasRenderingContext2D,
  canvasSize: L.Point,
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        ctx.drawImage(
          img,
          Math.floor(tilePos.x),
          Math.floor(tilePos.y),
          tileSize,
          tileSize,
        );
      } catch {
        // tile OK pero drawImage falló (¿canvas tainted?): descartar.
      }
      resolve();
    };
    img.onerror = () => resolve();
    // Caps en cero = tamaño 0, descartable
    if (canvasSize.x === 0 || canvasSize.y === 0) resolve();
    img.src = url;
  });
}

/**
 * Equivalente casero del `addCacheString` de leaflet-image: agrega un query
 * param de cache-busting para que el `<img>` no se sirva del cache del
 * navegador con una versión stale. Solo se aplica a URLs no-data y no-mapbox.
 * Devuelve la URL sin tocar si no es válida.
 */
function addCacheString(url: string): string {
  if (url.startsWith('data:') || url.includes('mapbox.com/styles/v1')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}ts=${Date.now()}`;
}

/** Localiza el `<canvas>` que Leaflet usa como renderer vectorial dentro del
 *  `overlayPane`. Con `preferCanvas: true` (configurado en MapView) todos los
 *  GeoJSON (áreas protegidas, PRC, DPA, red caminera, drenaje, líneas de
 *  transmisión, catastro y polígonos KML subidos por el usuario) terminan
 *  dibujados ahí. La
 *  `_pathRoot` que existía en Leaflet 0.x ya no existe en 1.9.x.
 *
 *  Estrategia de copia:
 *    1. `querySelector('canvas')` busca el primer canvas hijo de overlayPane.
 *    2. `getBoundingClientRect()` sobre ese canvas Y sobre `map.getContainer()`
 *       para calcular el offset en CSS pixels (rect.left - containerRect.left).
 *    3. `ctx.drawImage(canvas, dx, dy, dw, dh)` copia respetando además el
 *       escalado retina (canvas.width natural = 2× style.width en HiDPI, el
 *       argumento dw/dh hace el downscale automáticamente).
 *
 *  Si el mapa no tiene vectores cargados (todas las casillas apagadas, o un
 *  mapa recién abierto), no hay canvas y la función sale silenciosa. */
function drawPathRootToCanvas(
  map: L.Map,
  ctx: CanvasRenderingContext2D,
): void {
  // `getPanes()` puede devolver undefined en versiones raras o durante el
  // desmontaje; defendemos con optional chaining + cast al tipo interno que la
  // firma expone (`DefaultMapPanes & { [name]: HTMLElement }`).
  const panes = map.getPanes?.() as L.DefaultMapPanes | undefined;
  const overlayPane = panes?.overlayPane;
  if (!overlayPane) return;

  // Si hay varios canvas en el pane (StrictMode, recargas), preferimos el de
  // área positiva: el renderer anterior, con tamaño 0, no aporta nada.
  const canvases = Array.from(
    overlayPane.querySelectorAll('canvas'),
  ) as HTMLCanvasElement[];
  const root = canvases.find((c) => c.width > 0 && c.height > 0) ?? null;
  if (!root) return;

  const mapContainer = map.getContainer();
  if (!mapContainer) return;

  const canvasRect = root.getBoundingClientRect();
  const containerRect = mapContainer.getBoundingClientRect();
  if (canvasRect.width === 0 || canvasRect.height === 0) return;

  const dx = canvasRect.left - containerRect.left;
  const dy = canvasRect.top - containerRect.top;

  try {
    ctx.drawImage(root, dx, dy, canvasRect.width, canvasRect.height);
  } catch (e) {
    // Canvas tainted (caso muy raro: vectorial con CORS roto). No abortamos
    // — los tiles OSM de fondo ya quedaron pintados y el frame se dibuja
    // encima igual, así que el PNG sale con la base mapa + norte/escala/
    // atribuciones, sin los vectores.
    console.warn('[export] vector canvas tainted:', e);
  }
}

/** Copia los ImageOverlay (suelos y recursos vegetacionales) antes de los
 * vectores, respetando exactamente su rectángulo CSS visible. Sus imágenes se
 * sirven como blob/same-origin, por lo que no contaminan el canvas. */
async function drawImageOverlaysToCanvas(
  map: L.Map,
  ctx: CanvasRenderingContext2D,
): Promise<void> {
  const containerRect = map.getContainer().getBoundingClientRect();
  const tasks: Promise<void>[] = [];
  map.eachLayer((layer) => {
    if (!(layer instanceof L.ImageOverlay)) return;
    const image = layer.getElement();
    if (!image || !image.complete || image.naturalWidth === 0) return;
    tasks.push((async () => {
      try {
        if (typeof image.decode === 'function') await image.decode();
        const rect = image.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        ctx.drawImage(image, rect.left - containerRect.left, rect.top - containerRect.top, rect.width, rect.height);
      } catch (error) {
        console.warn('[export] ImageOverlay omitido:', error);
      }
    })());
  });
  await Promise.allSettled(tasks);
}

/** Crea un canvas maestro del tamaño del map y le pinta tiles + vectores. */
async function captureBaseCanvas(
  map: L.Map,
  basemap: BasemapId,
): Promise<HTMLCanvasElement> {
  const size = map.getSize();
  const canvas = document.createElement('canvas');
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo obtener contexto 2D del canvas de export.');

  await drawTileLayersToCanvas(map, ctx, basemap);
  await drawImageOverlaysToCanvas(map, ctx);
  drawPathRootToCanvas(map, ctx);
  return canvas;
}

/* ---------- Sprite del pin CBR (memizado) ---------- */

let _pinSpritePromise: Promise<HTMLImageElement> | null = null;

/**
 * Serializa el SVG del pin carmesí a un `Image` HTML cargable por `drawImage`.
 * Se cachea en singleton porque las ~74k invocaciones comparten la misma
 * textura: rasterizar el sprite una vez cuesta ~10 ms, no millones.
 */
function loadCbrPinSprite(): Promise<HTMLImageElement> {
  if (_pinSpritePromise) return _pinSpritePromise;
  _pinSpritePromise = new Promise((resolve, reject) => {
    const svg = cbrPinSvg().replace(
      '<svg ',
      'xmlns="http://www.w3.org/2000/svg" ',
    );
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo rasterizar el sprite del pin CBR'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  return _pinSpritePromise;
}

/* ---------- Composite de marcadores CBR visibles ---------- */

/**
 * Itera todos los markers del cluster y, para cada uno, se queda con su padre
 * visible (`getVisibleParent`): si el marker se muestra suelto, ese es su
 * padre; si está agrupado, el padre es una burbuja `L.MarkerCluster`. Luego
 * deduplica por identidad y dibuja lo que efectivamente el usuario ve en
 * pantalla. La bounding box se infla un 10 % para no perder nada en el borde
 * durante un paneo brusco justo antes del export.
 */
async function drawCbrMarkers(
  canvas: HTMLCanvasElement,
  map: L.Map,
  cluster: L.MarkerClusterGroup,
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const allMarkers = cluster.getAllChildMarkers();
  const sprite = await loadCbrPinSprite();
  const visibleBounds = map.getBounds().pad(0.1);

  const seen = new Set<unknown>();
  for (const child of allMarkers) {
    const visible = cluster.getVisibleParent(child);
    if (seen.has(visible)) continue;
    seen.add(visible);

    const latlng = visible.getLatLng();
    if (!visibleBounds.contains(latlng)) continue;
    const pos = map.latLngToContainerPoint(latlng);

    // `L.MarkerCluster` expone getChildCount(); los singletons no. Duck-typing
    // evita depender del árbol de herencia exacto de la librería.
    if (typeof (visible as L.MarkerCluster).getChildCount === 'function') {
      drawClusterBubble(ctx, pos, (visible as L.MarkerCluster).getChildCount());
    } else {
      // Singleton: el iconAnchor del divIcon está en [12, 32], así que la
      // punta del pin calza exactamente en (pos.x, pos.y).
      ctx.drawImage(sprite, pos.x - 12, pos.y - 32, 24, 32);
    }
  }
}

/**
 * Burbuja de cluster pintada al estilo de Leaflet.markercluster (default):
 * un círculo con fill #5fb7e0, borde blanco y conteo en negrita. El radio
 * escala por las mismas dos puertas que la librería (`< 10`, `< 100`, `≥ 100`)
 * para que el export se vea igual de "orgánico" que el mapa en vivo.
 */
function drawClusterBubble(
  ctx: CanvasRenderingContext2D,
  pos: L.Point,
  count: number,
): void {
  const radius = count < 10 ? 14 : count < 100 ? 18 : 22;
  const cy = pos.y - radius / 2; // mismo offset vertical que las CSS de markercluster
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#5fb7e0';
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(radius - 2, 10)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), pos.x, cy);
  ctx.restore();
}

/* ---------- Marco: norte + escala + atribuciones ---------- */

/** Anchura típica de una barra de escala: ~1/6 del ancho del mapa (en píxeles),
 *  redondeada al primer valor "lindo" (1, 2, 5, 10, 20, 50…) en metros. */
function niceScaleMeters(meters: number): number {
  const steps = [
    1, 2, 5, 10, 20, 50, 100, 200, 500,
    1000, 2000, 5000, 10000, 20000, 50000,
    100000, 200000, 500000, 1000000,
  ];
  return steps.find((s) => s >= meters) ?? meters;
}

/** Misma fórmula ground resolution que Leaflet, basada en la circunferencia
 *  ecuatorial (40075016.686 m) y la latitud del centro del mapa. */
function metersPerPixel(map: L.Map): number {
  const lat = map.getCenter().lat;
  return (
    (40075016.686 * Math.cos((lat * Math.PI) / 180)) /
    Math.pow(2, map.getZoom() + 8)
  );
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  map: L.Map,
  origin: { x: number; y: number },
): void {
  const mPerPx = metersPerPixel(map);
  const targetMeters = (ctx.canvas.width - origin.x * 2) / 6 * mPerPx;
  const widthM = niceScaleMeters(targetMeters);
  const widthPx = widthM / mPerPx;

  const x = origin.x;
  const y = origin.y;

  // Fondo blanco translúcido para que se lea sobre cualquier tile
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x - 4, y - 14, widthPx + 8, 22);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 4, y - 14, widthPx + 8, 22);

  // Barra con segmentos alternados (estilo Google Earth Pro)
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(x, y - 4, widthPx, 6);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y - 4, widthPx / 2, 6);

  // Etiqueta "N km" o "N m" según magnitud
  ctx.fillStyle = '#1f2937';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    widthM >= 1000 ? `${(widthM / 1000).toLocaleString('es-CL')} km` : `${widthM} m`,
    x + widthPx / 2,
    y - 8,
  );
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r = 30,
): void {
  ctx.save();

  // === Disco blanco translúcido + sombra suave ===
  // La sombra solo afecta el primer `fill` (el del disco). Para los strokes
  // siguientes la desactivamos con shadowColor='transparent' para que las
  // marcas y anillos no proyecten fantasma.
  ctx.shadowColor = 'rgba(15,23,42,0.28)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // === Anillo exterior + anillo interior muy fino ===
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(15,23,42,0.5)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r - 3.5, 0, Math.PI * 2);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(15,23,42,0.22)';
  ctx.stroke();

  // === Marcas de tick (16 marcas, cada 22.5°; las 4 cardinales N/E/S/W son
  //     más largas) — el detalle de instrumentos cartográficos. ===
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = 'rgba(15,23,42,0.6)';
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 - Math.PI / 2; // arranca arriba (12 en punto)
    const isCardinal = i % 4 === 0;
    const inner = isCardinal ? r - 7 : r - 4;
    const outer = r - 1.5;
    const x1 = cx + Math.cos(angle) * inner;
    const y1 = cy + Math.sin(angle) * inner;
    const x2 = cx + Math.cos(angle) * outer;
    const y2 = cy + Math.sin(angle) * outer;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // === Aguja de dos colores (estilo instrumento de precisión) ===
  const tip = r - 9;            // longitud de cada mitad
  const base = 3.2;             // ancho del hombro (a nivel del centro)
  const notch = r - 16;         // vértice interior por encima del centro

  // Mitad norte (rojo carmesí, color de marca CBR para que el norte se
  // identifique a primera vista con las entidades del mapa).
  ctx.beginPath();
  ctx.moveTo(cx, cy - tip);
  ctx.lineTo(cx - base, cy);
  ctx.lineTo(cx, cy - notch);
  ctx.lineTo(cx + base, cy);
  ctx.closePath();
  ctx.fillStyle = '#e11d48';
  ctx.fill();

  // Mitad sur (gris pizarra para contraste sobrio con el rojo del norte).
  ctx.beginPath();
  ctx.moveTo(cx, cy - notch);
  ctx.lineTo(cx - base, cy);
  ctx.lineTo(cx, cy + tip * 0.7);
  ctx.lineTo(cx + base, cy);
  ctx.closePath();
  ctx.fillStyle = '#475569';
  ctx.fill();

  // === Pin central (reloj de pulsera clásico) ===
  ctx.beginPath();
  ctx.arc(cx, cy, 1.4, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();

  // === Letra 'N' en sans-serif semibold, en blanco sobre la mitad roja ===
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 10px "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', cx, cy - (tip - 6));

  ctx.restore();
}

/** Strip de atribución abajo del canvas, en una sola línea con fondo blanco
 *  translúcido. OpenStreetMap va primero (licencia ODbL, obligatoria). El
 *  resto, en el orden en que se pasan (capas activas). El corto espacio
 *  vertical privilegia tamaño de letra legible sobre el mapa completo. */
function drawAttributionStrip(
  ctx: CanvasRenderingContext2D,
  lines: string[],
): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const text = lines.join(' · ');
  ctx.save();
  ctx.font = '10px sans-serif';
  const tw = ctx.measureText(text).width;
  const padX = 6;
  const stripH = 16;
  const x = W - tw - padX * 2 - 4;
  const y = H - stripH;
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.fillRect(x, y, tw + padX * 2, stripH);
  ctx.fillStyle = '#1f2937';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + stripH / 2);
  ctx.restore();
}

/** Cajetín de trazabilidad (estilo «cajetín de plano»): tarjeta blanca
 *  translúcida con título en negrita (11 px) y detalles en cuerpo (10 px).
 *  Cada entrada lleva su muestra geométrica a la izquierda del título —
 *  fillRect 12×12 para polígonos, trazo grueso para líneas, círculo r=4
 *  para puntos — usando el mismo colorectal que la capa real en el mapa,
 *  para que el perito reconozca cada capa sin abrir el archivo de origen.
 *
 *  Se ancla en la esquina inferior izquierda, encima de la barra de
 *  escala; si excede el alto disponible se trunca con «… (más entradas
 *  omitidas)». El ancho del rectángulo se dimensiona al texto más largo
 *  (con padding) y se acota al 42 % del ancho del canvas. */
function drawMetadataCard(
  ctx: CanvasRenderingContext2D,
  entries: LayerMetadataEntry[],
  canvas: HTMLCanvasElement,
): void {
  if (!entries || entries.length === 0) return;

  const margin = 18;
  const padding = 12;
  const lineHeight = 14;
  const swatchSize = 12;          // px del cuadrado / línea
  const swatchGap = 6;            // aire entre muestra y texto
  const textIndent = swatchSize + swatchGap; // = 18, uniform indent
  const titleFont = '600 11px "Inter", "Segoe UI", system-ui, sans-serif';
  const detailFont = '10px "Inter", "Segoe UI", system-ui, sans-serif';

  /** Una línea de la pila rinde el texto más la entry a la que pertenece
   *  (para poder dibujar el swatch del color apropiado en el renglón de
   *  título). */
  type LayoutLine = { text: string; isTitle: boolean; entry?: LayerMetadataEntry };

  // Layout plano: cada title o detail line termina en un renglón. Los '\n'
  // dentro de `details` se respetan. Entre entries NO insertamos línea en
  // blanco: el tipo de letra del título bold crea el corte visual.
  const layout: LayoutLine[] = [];
  for (const entry of entries) {
    if (entry.title) layout.push({ text: entry.title, isTitle: true, entry });
    const detailLines = entry.details.split('\n');
    for (const line of detailLines) {
      if (line.length > 0) layout.push({ text: line, isTitle: false });
    }
  }
  if (layout.length === 0) return;

  // Mide el ancho del renglón más ancho, sumando la indent uniforme para
  // que las líneas de detalle (sin swatch) respeten la misma alineación
  // que el título — sin esto, los detalles arrancarían donde el título
  // termina y se rompería la jerarquía visual.
  let maxWidth = 0;
  for (const line of layout) {
    ctx.save();
    ctx.font = line.isTitle ? titleFont : detailFont;
    const w = ctx.measureText(line.text).width + textIndent;
    ctx.restore();
    if (w > maxWidth) maxWidth = w;
  }

  const availableHeight = canvas.height - margin * 2 - 60; // -60 deja sitio a la escala + brújula
  const desiredHeight = layout.length * lineHeight + padding * 2;
  const truncatedHeight = Math.min(desiredHeight, availableHeight);
  const linesPerCard = Math.max(
    1,
    Math.floor((truncatedHeight - padding * 2) / lineHeight),
  );
  const fullLines = layout.slice(0, linesPerCard);
  if (layout.length > linesPerCard) {
    fullLines.push({ text: '… (más entradas omitidas)', isTitle: false });
  }

  const cardWidth = Math.min(canvas.width * 0.42, maxWidth + padding * 2);
  const cardHeight = fullLines.length * lineHeight + padding * 2;

  // Posición: esquina inferior izquierda, encima de la barra de escala.
  // La escala ocupa ~24 px arriba del borde (caja de bg de 22 px, baseline
  // a `canvas.height - margin - 6`); dejamos 6 px de aire y luego el cajetín.
  const x = margin;
  const y = canvas.height - margin - 30 - cardHeight;

  ctx.save();

  // Tarjeta con sombra sutil para separarla del mapa (aunque no tanta como
  // la brújula: el cajetín es más grande y no debe verse "flotante").
  ctx.shadowColor = 'rgba(15,23,42,0.12)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(x, y, cardWidth, cardHeight);

  // Borde
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(15,23,42,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1);

  // Texto + muestras. Todas las líneas arrancan en `textIndent` (alineación
  // profesional). Solo el renglón de título pinta su swatch a la izquierda.
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const swatchX = x + padding;
  const textX = swatchX + textIndent;
  let cursorY = y + padding;
  for (const line of fullLines) {
    if (line.text) {
      ctx.font = line.isTitle ? titleFont : detailFont;
      ctx.fillStyle = line.isTitle ? '#0f172a' : '#475569';
      if (line.isTitle && line.entry?.color) {
        drawMetadataSwatch(
          ctx,
          line.entry.color,
          line.entry.shape ?? 'square',
          swatchX,
          cursorY - 1, // compensar el ascent tipográfico del título
          swatchSize,
        );
      }
      ctx.fillText(line.text, textX, cursorY);
    }
    cursorY += lineHeight;
  }
  ctx.restore();
}

/** Pinta la muestra geométrica de 12×12 px a la izquierda del título en el
 *  cajetín. Implementación única para centralizar las 3 formas (square /
 *  line / dot) — si añadimos otros tipos (cross, star, etc.) hay un solo
 *  sitio donde tocar. */
function drawMetadataSwatch(
  ctx: CanvasRenderingContext2D,
  color: string,
  shape: LayerMetadataShape,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (shape === 'dot') {
    // Marcador puntual centrado verticalmente en el swatch.
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, Math.max(3, size / 2 - 1), 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'line') {
    // Trazo grueso con extremos redondeados que se siente como una calzada
    // en miniatura (refleja la naturaleza lineal de la capa en el mapa).
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + 1, y + size / 2);
    ctx.lineTo(x + size - 1, y + size / 2);
    ctx.stroke();
  } else {
    // Por defecto, cuadrado relleno — el caso de polígono/área (compatible
    // con lo que ya usábamos antes del swatch).
    ctx.fillRect(x, y, size, size);
  }
  ctx.restore();
}

function drawFrame(
  canvas: HTMLCanvasElement,
  map: L.Map,
  opts: MapExportOptions,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Margen interno: deja un anillo para que la brújula y la escala no se
  // pisen con el borde del canvas al hacer zoom-out extremo.
  const margin = 18;
  const compassR = 30;

  // Brújula en la esquina superior derecha (centro de la rosa a
  // `width-margin-r` píxeles del borde derecho).
  drawCompass(ctx, canvas.width - margin - compassR, margin + compassR, compassR);

  // Cajetín de trazabilidad legal — encima de la barra de escala para no
  // robarnos el bottom-left tradicional. El ancho se adapta al contenido.
  if (opts.metadata && opts.metadata.length > 0) {
    drawMetadataCard(ctx, opts.metadata, canvas);
  }

  drawScaleBar(ctx, map, { x: margin, y: canvas.height - margin - 6 });

  const baseAttribution = getBasemap(opts.basemap ?? DEFAULT_BASEMAP_ID).attributionText;
  const atts: string[] = baseAttribution ? [baseAttribution] : [];
  if (opts.showProtected) atts.push(ATTRIBUTION_PROTECTED);
  if (opts.showUrbanLimit) atts.push(ATTRIBUTION_URBAN);
  if (opts.showComunas) atts.push(ATTRIBUTION_COMUNAS);
  if (opts.showRedVial) atts.push(ATTRIBUTION_RED_VIAL);
  if (opts.showRedDrenaje) atts.push(ATTRIBUTION_RED_DRENAJE);
  if (opts.showLineasTransmision) atts.push(ATTRIBUTION_LINEAS_TRANSMISION);
  if (opts.showSuelos) atts.push(ATTRIBUTION_SUELOS);
  if (opts.showCatastroFruticola) atts.push(ATTRIBUTION_CATASTRO);
  if (opts.showVegetacional) atts.push(ATTRIBUTION_VEGETACIONAL);
  if (opts.showPropiedadesRurales) atts.push(ATTRIBUTION_PROPIEDADES_RURALES);
  if (opts.showHexbins) atts.push(ATTRIBUTION_HEXBINS);
  drawAttributionStrip(ctx, atts);
}

/* ---------- API pública ---------- */

export type LayerExportFlags = {
  showPoints: boolean;
  showProtected: boolean;
  showUrbanLimit: boolean;
  showComunas: boolean;
  showRedVial: boolean;
  showRedDrenaje: boolean;
  showLineasTransmision: boolean;
  showSuelos: boolean;
  showCatastroFruticola: boolean;
  showVegetacional: boolean;
  showPropiedadesRurales: boolean;
  /** Mapa de calor de valor ($/m² por hexágono). Se rasteriza solo con la
   *  captura de vectores (es un L.geoJSON sobre el canvas compartido); esta
   *  bandera existe para la atribución obligatoria del PNG. */
  showHexbins: boolean;
};

/** Forma de la muestra (swatch) que precede al título en el cajetín. Cada
 *  color del swatch se corresponde con la capa real del mapa — el mismo
 *  verde de las áreas protegidas, el ámbar del PRC, el violeta de la red
 *  MOP, etc. — para que el perito reconozca cada capa en el PNG sin
 *  tener que mirar el mapa. */
export type LayerMetadataShape = 'square' | 'line' | 'dot';

/**
 * Una entrada del cajetín de trazabilidad (estilo «cajetín de plano»): un
 * título corto en negrita (11 px) y un bloque de detalles en cuerpo (10 px)
 * que soporta `\n` para líneas múltiples. El renderer del cajetín dibuja una
 * muestra geométrica a la izquierda del título usando `color` + `shape`, y
 * mide el ancho del texto más largo con `ctx.measureText` para dimensionar
 * el rectángulo.
 *
 * Ejemplo:
 *   { title: 'Límite urbano (PRC)',
 *     details: 'Comuna: Coyhaique\nInstrumento: PRC Coyhaique\nFuente: MINVU',
 *     color: '#c2410c',
 *     shape: 'square' }
 */
export type LayerMetadataEntry = {
  title: string;
  details: string;
  /** Colorectal principal de la capa en el mapa. Si se omite, no se dibuja
   *  swatch junto al título (útil para entradas de metadatos administrativos
   *  que no tienen una capa visual asociada). */
  color?: string;
  /** Forma de la muestra. Por defecto: 'square' (cuadrado 12×12 relleno).
   *  - 'square': fillRect — para capas de polígono / áreas protegidas / DPA.
   *  - 'line':   strokeRound 3 px — para capas lineales (red caminera /
   *              drenaje, límites comunales a veces).
   *  - 'dot':    arco lleno r=4 — para capas de marcadores puntuales
   *              (transacciones CBR o KML de puntos). */
  shape?: LayerMetadataShape;
};

export type MapExportOptions = LayerExportFlags & {
  cluster: L.MarkerClusterGroup | null;
  /** Mapa base vigente. Decide el filtro replicado sobre los tiles del canvas
   *  y la atribución obligatoria del PNG (cada proveedor tiene la suya). */
  basemap?: BasemapId;
  /** Trazabilidad legal del export — pintada como cajetín en la esquina
   *  inferior izquierda (sobre la escala). Si `undefined` o vacío, no se
   *  dibuja cajetín. */
  metadata?: LayerMetadataEntry[];
};

/**
 * Orquesta las tres pistas: tiles + vectores → pines CBR → marco. Devuelve
 * el canvas final. La descarga o composición adicional queda en manos de
 * quien llama (`downloadCanvas` aquí abajo, o subida al servidor, etc.).
 */
export async function exportMapToPng(
  map: L.Map,
  opts: MapExportOptions,
): Promise<HTMLCanvasElement> {
  // `Promise.race` con timeout: si la captura se cuelga (tile remoto que
  // nunca responde, red caída, canvas tainted sin imagen fallback), después
  // de EXPORT_TIMEOUT_MS devolvemos lo que se haya podido pintar hasta el
  // momento en lugar de dejar al usuario varado con "Generando PNG…" para
  // siempre. El canvas estará incompleto, pero el frame (norte + escala +
  // atribuciones) y los pines CBR ya renderizados sí aparecerán — útil como
  // captura diagnóstica y mejor que nada.
  const capturePromise = (async () => {
    const canvas = await captureBaseCanvas(map, opts.basemap ?? DEFAULT_BASEMAP_ID);
    if (opts.showPoints && opts.cluster) {
      await drawCbrMarkers(canvas, map, opts.cluster);
    }
    return canvas;
  })();

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<HTMLCanvasElement>((resolve) => {
    timeoutHandle = setTimeout(() => {
      // Devolvemos un canvas en blanco del tamaño del mapa: el drawFrame
      // añadirá el norte/escala/atribución encima, así que el usuario ve
      // explícitamente que la captura base falló.
      const fallback = document.createElement('canvas');
      fallback.width = map.getSize().x;
      fallback.height = map.getSize().y;
      resolve(fallback);
    }, EXPORT_TIMEOUT_MS);
  });

  const canvas = await Promise.race([capturePromise, timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  drawFrame(canvas, map, opts);
  return canvas;
}

/**
 * Genera el nombre de archivo con timestamp local: legible para un anexo de
 * informe y ordenable en una carpeta de varias exportaciones del mismo día.
 */
export function exportFilename(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  return `sig-suelo-${yyyy}-${mm}-${dd}-${hh}${mi}.png`;
}

/**
 * Dispara la descarga del canvas como PNG vía anchor + `toBlob`. La URL
 * temporal se revoca al segundo siguiente — suficiente para que el click se
 * procese antes de la limpieza.
 */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
