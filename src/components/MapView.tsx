'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { GeocodeResult, MapPoint } from '@/lib/types';
import {
  basemapFilterKey,
  getBasemap,
  isDarkCanvas,
  prefersDark,
  DEFAULT_BASEMAP_ID,
  MAP_MAX_ZOOM,
  type BasemapId,
} from '@/lib/basemap';
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';
import { downloadCanvas, exportFilename, exportMapToPng, type LayerMetadataEntry, type NdviExport } from '@/lib/map-export';
import { NdviConsulta, redondearCoordenada } from '@/lib/ndvi';
import {
  NDVI_VISUAL_EXPORT_URL,
  NDVI_VISUAL_MIN_ZOOM,
  type NdviVisualEstado,
} from '@/lib/ndvi-visual';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';
import {
  URBAN_LIMIT_STYLE,
  type UrbanLimitProps,
} from '@/lib/urban-limit';
import type { KmlLayer } from '@/lib/kml';
import {
  COMUNAS_STYLE,
  comunaFillColor,
  type ComunaProps,
} from '@/lib/comunas';
import { cbrPinSvg } from '@/lib/cbr-points';
import { useStaticGeoJsonLayer } from '@/components/map/useStaticGeoJsonLayer';
import {
  buildCatastroFruticolaPopup,
  buildComunaPopup,
  buildHexbinPopup,
  buildKmlPopup,
  buildLineaTransmisionPopup,
  buildPopup,
  buildProtectedPopup,
  buildRedDrenajePopup,
  buildRedVialPopup,
  buildUrbanLimitPopup,
  buildVegetacionalPopup,
  esc,
} from '@/lib/map-popups';
import {
  ROAD_CLASS_GROUPS,
  roadClassGroup,
  type RedVialProps,
} from '@/lib/red-vial';
import {
  DRENAJE_TYPE_GROUPS,
  drenajeType,
  type RedDrenajeProps,
} from '@/lib/red-drenaje';
import {
  TENSION_GROUPS,
  tensionGroup,
  type LineaTransmisionProps,
} from '@/lib/lineas-transmision';
import {
  especieColor,
  type CatastroFruticolaProps,
} from '@/lib/catastro-fruticola';
import {
  VEGETACIONAL_EXPORT_URL,
  VEGETACIONAL_IDENTIFY_URL,
  VEGETACIONAL_MIN_ZOOM,
  type VegetacionalProps,
} from '@/lib/vegetacional';
import {
  DESTINO_DEFAULT,
  HEXBINS_ATTRIBUTION,
  HEXBINS_URL,
  HEXBIN_MIN_N_DEFAULT,
  quantileBreaks,
  type HexbinMeta,
  type HexbinProps,
  type HexbinRampId,
  type HexbinStatus,
} from '@/lib/hexbins';
import {
  quantileScale,
  renderHeatSurface,
  type HeatSample,
} from '@/lib/heat-surface';
import {
  SUELOS_ATTRIBUTION,
  SUELOS_EXPORT_URL,
  SUELOS_IDENTIFY_URL,
  SUELOS_MIN_ZOOM,
  SUELOS_SERVICE_NAME,
  suelosClassColor,
  TRANSPARENT_PIXEL,
  type SuelosOperation,
  type SuelosProxyErrorBody,
  type SuelosStatus,
} from '@/lib/suelos';
import {
  BIOCLIMA_DEFAULT_VARIABLE,
  fetchBioclimaMeta,
  type BioclimaVariable,
} from '@/lib/bioclima';
import { DEFAULT_LAYER_OPACITY, type LayerOpacity } from '@/lib/layer-opacity';
import {
  PROPIEDADES_RURALES_ATTRIBUTION,
  PROPIEDADES_RURALES_COLOR,
  PROPIEDADES_RURALES_DISCLAIMER,
  PROPIEDADES_RURALES_EXPORT_URL,
  PROPIEDADES_RURALES_IDENTIFY_URL,
  PROPIEDADES_RURALES_MIN_ZOOM,
  PROPIEDADES_RURALES_SERVICE_NAME,
  type PropiedadesRuralesOperation,
  type PropiedadesRuralesProxyErrorBody,
  type PropiedadesRuralesStatus,
  type PropiedadRuralFeatureResponse,
} from '@/lib/propiedades-rurales';

/**
 * Imperative Leaflet map with marker clustering.
 *
 * Renders the geolocated dataset (up to ~74k points) as native CircleMarkers
 * grouped with leaflet.markercluster. Building it imperatively (not as thousands
 * of React nodes) keeps mount fast and mobile-safe. Loaded with `ssr: false`
 * from the page, so Leaflet only ever runs in the browser.
 */

const MAP_CENTER: [number, number] = [-39.6, -72.6]; // centro-sur de Chile

// Un solo icono compartido por todos los puntos CBR: pin (gota) carmesí con
// halo blanco, de alto contraste con el mapa base. La punta (parte inferior)
// marca la coordenada, por eso iconAnchor apunta al [12, 32] del SVG 24×32.
const cbrPinIcon = L.divIcon({
  className: 'cbr-pin',
  html: cbrPinSvg(),
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -30],
});

async function suelosFailureDetails(
  response: Response,
  fallbackOperation: SuelosOperation,
): Promise<{ service: string; operation: SuelosOperation }> {
  try {
    const body = (await response.json()) as SuelosProxyErrorBody;
    const operation = body.error?.operation === 'identify' || body.error?.operation === 'export'
      ? body.error.operation
      : fallbackOperation;
    return {
      service: body.error?.service === SUELOS_SERVICE_NAME
        ? body.error.service
        : SUELOS_SERVICE_NAME,
      operation,
    };
  } catch {
    return { service: SUELOS_SERVICE_NAME, operation: fallbackOperation };
  }
}

async function ruralFailureDetails(response: Response, fallbackOperation: PropiedadesRuralesOperation): Promise<{ service: string; operation: PropiedadesRuralesOperation }> {
  try {
    const body = await response.json() as PropiedadesRuralesProxyErrorBody;
    const operation = body.error?.operation === 'identify' || body.error?.operation === 'export' ? body.error.operation : fallbackOperation;
    return { service: body.error?.service === PROPIEDADES_RURALES_SERVICE_NAME ? body.error.service : PROPIEDADES_RURALES_SERVICE_NAME, operation };
  } catch { return { service: PROPIEDADES_RURALES_SERVICE_NAME, operation: fallbackOperation }; }
}

function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Invalid soils image'));
    image.src = url;
  });
}

/** Una muestra de la superficie de calor, con su posición geográfica. */
interface HexbinSample {
  lat: number;
  lng: number;
  props: HexbinProps;
}

export default function MapView({
  layerOpacity = DEFAULT_LAYER_OPACITY,
  points,
  showPoints = true,
  showProtected = false,
  showUrbanLimit = false,
  showComunas = false,
  showRedVial = false,
  showRedDrenaje = false,
  showLineasTransmision = false,
  showSuelos = false,
  showBioclima = false,
  bioclimaVariable = BIOCLIMA_DEFAULT_VARIABLE,
  showCatastroFruticola = false,
  showVegetacional = false,
  showPropiedadesRurales = false,
  showNdviVisual = false,
  showHexbins = false,
  hexbinDestino,
  hexbinMinN,
  hexbinFiltersQs = '',
  kmlLayers = [],
  basemap = DEFAULT_BASEMAP_ID,
  focus = null,
  onRenderProgress,
  onRenderComplete,
  onSuelosStatus,
  onPropiedadesRuralesStatus,
  onNdviVisualStatus,
  selectedRuralFeature = null,
  onHexbinStatus,
  mapExportRef,
  ndviMode = false,
  ndviConsulta = null,
  onNdviPoint,
  ndvi = null,
}: {
  layerOpacity?: LayerOpacity;
  points: MapPoint[];
  /** Capa principal (~74k transacciones CBR). Apagarla deja el mapa limpio para
   * componer una vista sin transacciones (p.ej. antes de exportar a PNG). */
  showPoints?: boolean;
  showProtected?: boolean;
  showUrbanLimit?: boolean;
  showComunas?: boolean;
  showRedVial?: boolean;
  showRedDrenaje?: boolean;
  showLineasTransmision?: boolean;
  showSuelos?: boolean;
  /** Bioclima WorldClim: imagen estática recortada a Chile, no un servicio por
   *  viewport — el raster completo pesa 25-50 KB. */
  showBioclima?: boolean;
  bioclimaVariable?: BioclimaVariable;
  showCatastroFruticola?: boolean;
  showVegetacional?: boolean;
  showPropiedadesRurales?: boolean;
  /** NDVI Visual: raster continuo por viewport (Sentinel-2 vía /api/ndvi/export). */
  showNdviVisual?: boolean;
  /** Mapa de calor de valor: hexbins de $/m² agregados en Neon por viewport. */
  showHexbins?: boolean;
  /** Código de destino SII sobre el que se agrega. Obligatorio: la mediana de
   *  $/m² es 261× mayor en habitacional que en agrícola, así que una escala
   *  mezclada no dice nada (ver `docs/plan-mapa-de-calor.md` §1.2). */
  hexbinDestino?: string;
  /** Mínimo de transacciones por celda para dibujarla. */
  hexbinMinN?: number;
  /** Query string de los filtros activos, para que la capa agregue exactamente
   *  el mismo subconjunto que dibujan los puntos CBR. */
  hexbinFiltersQs?: string;
  kmlLayers?: KmlLayer[];
  /** Mapa base elegido en el selector (`BasemapSwitcher`). El estado vive en
   *  page.tsx para que el selector y el mapa no puedan desincronizarse. */
  basemap?: BasemapId;
  /** Resultado del geocoder: el mapa vuela ahí y deja un marcador pulsante. */
  focus?: GeocodeResult | null;
  /** Avance del render de marcadores (procesados, total) — alimenta el loader. */
  onRenderProgress?: (processed: number, total: number) => void;
  /** Los marcadores ya están pintados en pantalla — el loader puede cerrar. */
  onRenderComplete?: () => void;
  /** Disponibilidad operacional de la capa remota de suelos para el panel UI. */
  onSuelosStatus?: (status: SuelosStatus) => void;
  onPropiedadesRuralesStatus?: (status: PropiedadesRuralesStatus) => void;
  /** Disponibilidad operacional del raster NDVI Visual para la leyenda. */
  onNdviVisualStatus?: (status: NdviVisualEstado) => void;
  /** Geometría exacta elegida desde el buscador de ROL CIREN. Se mantiene
   * separada del raster remoto para resaltarla sin reconstruir la cobertura. */
  selectedRuralFeature?: PropiedadRuralFeatureResponse | null;
  /** Resolución, umbral y cortes de cuantiles vigentes — alimenta la leyenda,
   *  que debe declarar sobre qué se calculó el color que se está viendo. */
  onHexbinStatus?: (status: HexbinStatus) => void;
  /** Handle al que MapView publica el método imperativo de export. La página
   *  padre (page.tsx) lo conecta al botón "Exportar PNG" de LayersControl:
   *  cuando el usuario lo pulsa, `mapExportRef.current()` rasteriza y descarga
   *  la vista actual. Se re-bindea en cada cambio de flags para que la closure
   *  capture los toggles vigentes al momento del click. */
  mapExportRef?: MutableRefObject<
    ((args?: { metadata?: LayerMetadataEntry[] }) => Promise<void>) | null
  >;
  /** Herramienta NDVI armada: el siguiente clic en el mapa consulta ese punto
   *  (cursor de cruceta, los identify de otras capas se suspenden). */
  ndviMode?: boolean;
  /** Consulta NDVI vigente; MapView dibuja el punto consultado en el mapa. */
  ndviConsulta?: NdviConsulta | null;
  /** Punto elegido por el usuario con la herramienta armada. */
  onNdviPoint?: (lat: number, lng: number) => void;
  /** Serie NDVI actual: entra al cajetín del PNG exportado. */
  ndvi?: NdviExport | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const protectedRef = useRef<L.GeoJSON | null>(null);
  const urbanLimitRef = useRef<L.GeoJSON | null>(null);
  const comunasRef = useRef<L.GeoJSON | null>(null);
  const redVialRef = useRef<L.GeoJSON | null>(null);
  const redDrenajeRef = useRef<L.GeoJSON | null>(null);
  const lineasTransmisionRef = useRef<L.GeoJSON | null>(null);
  const suelosRef = useRef<L.ImageOverlay | null>(null);
  const bioclimaRef = useRef<L.ImageOverlay | null>(null);
  const catastroFruticolaRef = useRef<L.GeoJSON | null>(null);
  const vegetacionalRef = useRef<L.ImageOverlay | null>(null);
  const ndviVisualRef = useRef<L.ImageOverlay | null>(null);
  const propiedadesRuralesRef = useRef<L.ImageOverlay | null>(null);
  const propiedadRuralHighlightRef = useRef<L.GeoJSON | null>(null);
  const hexbinsRef = useRef<L.ImageOverlay | null>(null);
  // Punto consultado por la herramienta NDVI: marcador de cruceta en el
  // markerPane, separado del cluster CBR para no reconstruir 85k pines.
  const ndviMarkerRef = useRef<L.Marker | null>(null);
  const opacityRef = useRef(layerOpacity);
  // Estilo separado de la carga: ningún slider reinicia fetch/identify ni capas.
  // La ref también cubre las capas cuyo fetch termina después del ajuste.
  useEffect(() => {
    const previous = opacityRef.current;
    opacityRef.current = layerOpacity;
    // No recorrer miles de polígonos del catastro por cambiar otro raster.
    if (previous.comunas !== layerOpacity.comunas) {
      comunasRef.current?.setStyle({ fillOpacity: layerOpacity.comunas });
    }
    if (previous.catastroFruticola !== layerOpacity.catastroFruticola) {
      catastroFruticolaRef.current?.setStyle({ fillOpacity: layerOpacity.catastroFruticola });
    }
    if (previous.suelos !== layerOpacity.suelos) suelosRef.current?.setOpacity(layerOpacity.suelos);
    if (previous.bioclima !== layerOpacity.bioclima) bioclimaRef.current?.setOpacity(layerOpacity.bioclima);
    if (previous.vegetacional !== layerOpacity.vegetacional) vegetacionalRef.current?.setOpacity(layerOpacity.vegetacional);
    if (previous.ndviVisual !== layerOpacity.ndviVisual) ndviVisualRef.current?.setOpacity(layerOpacity.ndviVisual);
    if (previous.propiedadesRurales !== layerOpacity.propiedadesRurales) propiedadesRuralesRef.current?.setOpacity(layerOpacity.propiedadesRurales);
  }, [layerOpacity]);
  // Muestras de la superficie vigente. El raster no es clicable, así que el
  // popup se resuelve buscando la celda más cercana al clic sobre esta lista.
  const hexbinSamplesRef = useRef<{ samples: HexbinSample[]; meta: HexbinMeta } | null>(null);
  const basemapRef = useRef<L.TileLayer | null>(null);
  // Capa de referencia (etiquetas/límites) que va sobre la ortoimagen. Vive
  // aparte del fondo porque no todos los mapas base la tienen.
  const basemapLabelsRef = useRef<L.TileLayer | null>(null);

  // Tema vigente. MapView se monta con `ssr: false`, así que leer matchMedia en
  // el inicializador es seguro (no hay render de servidor con el que
  // desincronizarse). Decide el filtro del lienzo y la rampa de la capa de
  // calor: el extremo bajo de plasma (#0d0887) desaparece contra un fondo
  // blanco, y la rampa clara de tasación se pierde sobre una ortoimagen — por
  // eso `isDarkCanvas` cuenta el satélite como lienzo oscuro aunque el sistema
  // esté en tema claro.
  const [isDark, setIsDark] = useState<boolean>(prefersDark);
  const darkCanvas = isDarkCanvas(basemap, isDark);
  const hexbinRamp: HexbinRampId = darkCanvas ? 'plasma' : 'tasacion';
  const kmlRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const seenKmlIds = useRef<Set<string>>(new Set());

  // Callbacks de progreso en refs: el efecto del clúster no debe re-ejecutarse
  // (y reconstruir 85k marcadores) porque el padre re-creó una función.
  const onRenderProgressRef = useRef(onRenderProgress);
  const onRenderCompleteRef = useRef(onRenderComplete);
  const onSuelosStatusRef = useRef(onSuelosStatus);
  const onPropiedadesRuralesStatusRef = useRef(onPropiedadesRuralesStatus);
  const onNdviVisualStatusRef = useRef(onNdviVisualStatus);
  const onHexbinStatusRef = useRef(onHexbinStatus);
  // Modo NDVI en ref: los handlers de clic de otras capas (declarados en
  // effects con deps estables) deben poder consultar el estado vigente del
  // modo sin re-registrarse en cada toggle.
  const ndviModeRef = useRef(ndviMode);
  const onNdviPointRef = useRef(onNdviPoint);
  useEffect(() => {
    onRenderProgressRef.current = onRenderProgress;
    onRenderCompleteRef.current = onRenderComplete;
    onSuelosStatusRef.current = onSuelosStatus;
    onPropiedadesRuralesStatusRef.current = onPropiedadesRuralesStatus;
    onNdviVisualStatusRef.current = onNdviVisualStatus;
    onHexbinStatusRef.current = onHexbinStatus;
    ndviModeRef.current = ndviMode;
    onNdviPointRef.current = onNdviPoint;
  }, [onRenderProgress, onRenderComplete, onSuelosStatus, onPropiedadesRuralesStatus, onNdviVisualStatus, onHexbinStatus, ndviMode, onNdviPoint]);

  // Publica el método de export en el ref entregado por la página. La closure
  // se re-bindea en cada cambio de flags para que la captura refleje siempre
  // el estado vigente de las capas (incluyendo el toggle recién hecho de CBR
  // para componer una vista limpia). El guard `if (exporting)` en page.tsx
  // evita re-entradas mientras una descarga está en curso.
  //
  // El caller puede pasar `{ metadata: LayerMetadataEntry[] }` para inyectar
  // un cajetín de trazabilidad legal en el PNG (filtros aplicados, fuentes de
  // las capas activas). Lo construye page.tsx al momento del click (con los
  // filtros vigentes) y lo entrega por args — esto evita reconstruir el useEffect
  // con cada keystroke en los campos de filtro.
  useEffect(() => {
    if (!mapExportRef) return;
    mapExportRef.current = async (args) => {
      const map = mapRef.current;
      if (!map) return;
      const canvas = await exportMapToPng(map, {
        showPoints,
        showProtected,
        showUrbanLimit,
        showComunas,
        showRedVial,
        showRedDrenaje,
        showLineasTransmision,
        showSuelos,
        showBioclima,
        showCatastroFruticola,
         showVegetacional,
         showPropiedadesRurales,
        showNdviVisual,
        showHexbins,
        basemap,
        cluster: clusterRef.current,
        metadata: args?.metadata,
        ndvi,
      });
      downloadCanvas(canvas, exportFilename());
    };
    return () => {
      mapExportRef.current = null;
    };
  }, [
    mapExportRef,
    showPoints,
    showProtected,
    showUrbanLimit,
    showComunas,
    showRedVial,
    showRedDrenaje,
    showLineasTransmision,
    showSuelos,
    showBioclima,
    showCatastroFruticola,
    showVegetacional,
    showPropiedadesRurales,
    showNdviVisual,
    showHexbins,
    basemap,
    ndvi,
  ]);

  // Herramienta NDVI: con el modo armado el clic en el mapa captura la
  // coordenada en lugar de disparar identify/popups, el cursor es cruceta y
  // cualquier popup de capa que se abra en el mismo evento se cierra en el
  // microtask siguiente — la herramienta "pasa por encima" de la selección
  // normal y al desarmarse el mapa queda exactamente como estaba.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ndviMode) return;
    const container = map.getContainer();
    const cursorPrevio = container.style.cursor;
    container.style.cursor = 'crosshair';
    const onClick = (event: L.LeafletMouseEvent) => {
      onNdviPointRef.current?.(event.latlng.lat, event.latlng.lng);
    };
    const onPopupOpen = () => {
      queueMicrotask(() => {
        if (ndviModeRef.current) map.closePopup();
      });
    };
    map.on('click', onClick);
    map.on('popupopen', onPopupOpen);
    return () => {
      map.off('click', onClick);
      map.off('popupopen', onPopupOpen);
      container.style.cursor = cursorPrevio;
    };
  }, [ndviMode]);

  // Punto consultado vigente: cruceta en el markerPane mientras el panel
  // muestre esa consulta. La limpieza simétrica cubre el doble montaje de
  // StrictMode y el cambio a otra consulta.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (ndviMarkerRef.current) {
      map.removeLayer(ndviMarkerRef.current);
      ndviMarkerRef.current = null;
    }
    if (!ndviConsulta || ndviConsulta.tipo !== 'punto') return;
    const marker = L.marker([ndviConsulta.lat, ndviConsulta.lng], {
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'ndvi-punto-icono',
        html: '<span style="display:block;width:14px;height:14px;border:2px solid #16a34a;border-radius:50%;background:rgba(255,255,255,.7);box-shadow:0 0 0 1px rgba(0,0,0,.4)"></span>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map);
    ndviMarkerRef.current = marker;
    return () => {
      if (map.hasLayer(marker)) map.removeLayer(marker);
      if (ndviMarkerRef.current === marker) ndviMarkerRef.current = null;
    };
  }, [ndviConsulta]);

  // Con varias capas asíncronas compartiendo el overlayPane (preferCanvas), el
  // orden de apilado debe re-imponerse tras cada mutación de capa, sin
  // importar cuál fetch resuelva último: áreas protegidas al fondo, límite
  // urbano encima, luego las capas KML del usuario, y los puntos CBR siempre
  // al frente (clicables).
  const reorderOverlays = useCallback(() => {
    // Comunas al fondo de todo (contexto), luego áreas protegidas.
    protectedRef.current?.bringToBack();
    comunasRef.current?.bringToBack();
    // NDVI Visual se hunde AQUÍ y bioclima se hunde después: como `bringToBack`
    // es absoluto (al fondo del pane), la secuencia ndvi → bioclima deja el
    // orden final bioclima | ndvi | comunas | resto. La capa va encima de la
    // superficie climática y debajo de todo vector, que es donde un ráster de
    // contexto debe estar.
    ndviVisualRef.current?.bringToBack();
    // Bioclima queda por debajo incluso de comunas: es una superficie continua
    // que cubre todo el territorio, así que sobre cualquier otra capa las
    // taparía por completo. Va justo encima del mapa base (y del NDVI Visual).
    bioclimaRef.current?.bringToBack();
    urbanLimitRef.current?.bringToFront();
    // Catastro frutícola sobre los polígonos administrativos (los huertos
    // son el dato sustantivo de la capa: deben quedar visibles).
    vegetacionalRef.current?.bringToFront();
    catastroFruticolaRef.current?.bringToFront();
    propiedadesRuralesRef.current?.bringToFront();
    propiedadRuralHighlightRef.current?.bringToFront();
    // Red caminera sobre los polígonos (líneas finas, deben quedar visibles).
    redVialRef.current?.bringToFront();
    // Red de drenaje (ríos + esteros) sobre los polígonos; debajo de la red
    // caminera porque la vial suele tener jerarquía de trazo más visible.
    redDrenajeRef.current?.bringToFront();
    // Infraestructura eléctrica sobre las redes de contexto; KML y CBR siguen
    // al frente como capas operativas del perito.
    lineasTransmisionRef.current?.bringToFront();
    // El mapa de calor va sobre todas las capas de contexto (es la lectura
    // principal cuando está encendido) pero debajo del KML del perito y de los
    // puntos CBR, que deben seguir siendo clicables.
    hexbinsRef.current?.bringToFront();
    for (const layer of kmlRef.current.values()) layer.bringToFront();
    clusterRef.current?.bringToFront();
  }, []);

  // Initialize the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const map = L.map(container, {
      center: MAP_CENTER,
      zoom: 7,
      maxZoom: MAP_MAX_ZOOM,
      preferCanvas: true,
      scrollWheelZoom: true,
    });
    // El mapa base lo monta el efecto de abajo, que también reacciona al
    // selector: así hay una sola ruta de código que crea capas de tiles.
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    mapRef.current = map;

    // The layer sidebar is an in-flow 320 px dock: opening or closing it
    // changes this container's size WITHOUT a window resize, and Leaflet would
    // keep projecting with the old width (tiles offset, clicks landing on the
    // wrong spot, controls overlapping). A ResizeObserver on the container is
    // the generic fix — it also covers the mobile drawer, viewport changes and
    // devtools docking. `pan: true` keeps the geographic center stable while
    // the viewport widens/narrows; `animate: false` avoids a visible slide.
    let disposed = false;
    const resizeObserver = new ResizeObserver(() => {
      if (disposed || !mapRef.current) return;
      mapRef.current.invalidateSize({ pan: true, animate: false });
    });
    resizeObserver.observe(container);

    const kmlById = kmlRef.current;
    const seenIds = seenKmlIds.current;
    return () => {
      // Stop the observer FIRST: a callback queued after `map.remove()` would
      // call invalidateSize() on a destroyed map.
      disposed = true;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      protectedRef.current = null;
      urbanLimitRef.current = null;
      comunasRef.current = null;
      redVialRef.current = null;
      redDrenajeRef.current = null;
      lineasTransmisionRef.current = null;
      suelosRef.current = null;
      catastroFruticolaRef.current = null;
      vegetacionalRef.current = null;
      ndviVisualRef.current = null;
      propiedadesRuralesRef.current = null;
      propiedadRuralHighlightRef.current = null;
      hexbinsRef.current = null;
      basemapRef.current = null;
      basemapLabelsRef.current = null;
      kmlById.clear();
      seenIds.clear();
    };
  }, []);

  // Mapa base seleccionado. Se reemplaza la capa de tiles completa (no basta
  // con `setUrl`: cambian atribución, subdominios y zoom nativo). El fondo
  // siempre vuelve al fondo del apilado — `reorderOverlays` no lo toca porque
  // vive en el tilePane, bajo todos los overlays.
  //
  // `maxNativeZoom` por capa con un `maxZoom` común (MAP_MAX_ZOOM) es lo que
  // evita el viewport en blanco al pasar de una base con z19 a OpenTopoMap,
  // que se acaba en z17: Leaflet reescala el último nivel disponible.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const def = getBasemap(basemap);

    if (basemapRef.current) {
      map.removeLayer(basemapRef.current);
      basemapRef.current = null;
    }
    if (basemapLabelsRef.current) {
      map.removeLayer(basemapLabelsRef.current);
      basemapLabelsRef.current = null;
    }

    if (def.url) {
      basemapRef.current = L.tileLayer(def.url, {
        attribution: def.attribution,
        subdomains: def.subdomains ?? 'abc',
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: def.maxNativeZoom,
        crossOrigin: 'anonymous',
      }).addTo(map);
    }
    if (def.overlayUrl) {
      basemapLabelsRef.current = L.tileLayer(def.overlayUrl, {
        maxZoom: MAP_MAX_ZOOM,
        maxNativeZoom: def.maxNativeZoom,
        crossOrigin: 'anonymous',
      }).addTo(map);
    }
  }, [basemap]);

  // El tema del mapa base sigue al del sistema en vivo. No se recrea la capa
  // de tiles: el look lo da un filtro CSS sobre `.leaflet-tile-pane` (ver
  // `lib/basemap.ts` y globals.css), así que basta con reflejar el tema en el
  // atributo `data-basemap` del contenedor y en la rampa de la capa de calor.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setIsDark(media.matches);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  // Mount/unmount the already-built cluster layer based on visibility. El efecto
  // de build de abajo siempre construye y puebla el cluster (para que el
  // pipeline de progreso del render siga alimentando al RetroLoader aunque la
  // capa esté oculta al boot), y asigna clusterRef; éste sólo añade o quita el
  // cluster del mapa cuando showPoints cambia. Los ~74k marcadores se conservan
  // entre toggles: nada se reconstruye.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    if (showPoints && !map.hasLayer(cluster)) {
      map.addLayer(cluster);
      reorderOverlays();
    } else if (!showPoints && map.hasLayer(cluster)) {
      map.removeLayer(cluster);
    }
  }, [showPoints, reorderOverlays]);

  // Rebuild the cluster layer whenever the filtered points change. La visibilidad
  // (showPoints) la maneja el efecto de arriba — éste sólo reconstruye los
  // marcadores y decide si el grupo recién construido se adjunta al mapa según
  // el valor de showPoints vigente al momento del build.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // markercluster no expone cómo cancelar el procesamiento por chunks de
    // addLayers (su setTimeout interno se re-agenda solo). Si el efecto se
    // limpia a mitad de carga (StrictMode, cambio de filtros), ese timer sigue
    // corriendo con this._map ya null y revienta en _addLayer (getMinZoom).
    // `cancelled` silencia el progreso y el no-op de _addLayer (en el cleanup)
    // vuelve inofensivas las iteraciones restantes.
    let cancelled = false;

    const group = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 120,
      chunkDelay: 20,
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      // animate:false evita el requestAnimFrame de transición de clusters, cuyo
      // callback diferido corría tras el desmontaje (StrictMode) sobre un mapa
      // ya destruido → «Cannot read properties of null (getMinZoom)». Además es
      // más liviano con ~74k puntos.
      animate: false,
      chunkProgress(processed: number, total: number) {
        if (cancelled) return;
        onRenderProgressRef.current?.(processed, total);
        // markercluster llama a chunkProgress(0, 0, …) cuando addLayers[]
        // recibe un array vacío (p.ej. el primer mount de StrictMode mientras
        // /api/points aún no resolvió). `processed >= total` se cumple para
        // (0, 0) y disparaba el cierre del loader sin markers en pantalla.
        // Gateamos con total > 0 (equivalente a processed > 0) para exigir
        // que realmente hubo algo que procesar.
        if (processed >= total && total > 0) {
          // markercluster ejecuta el callback de chunkProgress *antes* de las
          // llamadas síncronas que anexan los clusters al map pane
          // (_refreshClustersIcons + _recursivelyAddChildrenToMap). Un doble
          // rAF aquí (~32 ms) compensa en CPUs rápidas pero puede quedarse
          // corto cuando el hilo principal está recién saliendo del decode
          // JSON y todavía hay layout pendiente para ~65+ íconos recién
          // creados: el loader cierra y el mapa sigue en blanco.
          //
          // Diferimos a una microtask (corre al final del tick actual, justo
          // después del sync DOM work que el markercluster aún tiene por
          // hacer) y luego encadenamos dos rAFs para garantizar paint. Si la
          // cleanup del efecto marcó `cancelled`, los callbacks descartan.
          queueMicrotask(() => {
            if (cancelled) return;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (cancelled) return;
                onRenderCompleteRef.current?.();
              }),
            );
          });
        }
      },
    });

    const markers = points.map((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: cbrPinIcon });
      marker.bindPopup(buildPopup(p));
      return marker;
    });

    // El grupo debe estar en el mapa ANTES de addLayers: solo así markercluster
    // procesa por chunks (sin congelar el hilo principal ~3,5 s con 85k puntos)
    // y emite chunkProgress. Si la capa está oculta al construir, igual
    // construimos el grupo y dejamos clusterRef apuntando a él — el efecto de
    // visibilidad arriba lo añadirá al mapa en el primer toggle a true.
    if (showPoints) map.addLayer(group);
    if (markers.length > 0) {
      group.addLayers(markers);
    }
    // Importante: cuando `points` aún es [] (primer mount antes de que el
    // fetch de /api/points resuelva, o el doble mount de StrictMode) NO
    // disparamos onRenderComplete: el loader debe esperar a los markers
    // reales. El catch del fetch en page.tsx cierra el loader si la red
    // falla; si los datos son legítimamente vacíos, el boot ya terminó y
    // handleRenderComplete es un no-op por booting.current=false.
    clusterRef.current = group;
    reorderOverlays();

    // Cleanup: si esta corrida todavía es la "viva" y el grupo está en el mapa
    // (visible), lo quitamos. La ref se libera para que el próximo ciclo
    // (filtros nuevos o toggle) asigne una nueva. Sin esto, el doble montaje
    // de StrictMode deja clusterRef apuntando a un grupo cuyo mapa ya fue
    // destruido, y el removeLayer del siguiente ciclo llama a getMinZoom()
    // sobre un _map null (los marcadores divIcon recalculan la grilla de zoom
    // al removerse, a diferencia de los circleMarker de canvas).
    return () => {
      cancelled = true;
      // Neutraliza los chunks pendientes del grupo saliente: sin mapa,
      // _addLayer dereferencia this._map.getMinZoom() y lanza TypeError.
      (group as unknown as { _addLayer: () => void })._addLayer = () => {};
      if (clusterRef.current === group) {
        if (mapRef.current?.hasLayer(group)) {
          mapRef.current.removeLayer(group);
        }
        clusterRef.current = null;
      }
    };
    // showPoints se lee solo para decidir si se añade el grupo al mapa;
    // la visibilidad la gobierna el efecto de toggle de arriba, y NO queremos
    // reconstruir 74k markers cada vez que se apaga la capa para componer una
    // vista limpia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, reorderOverlays]);

  // Protected areas layer — official MMA / Registro Nacional de Áreas
  // Protegidas (RNAP), CC0. Styled per legal category, generated by
  // scripts/build-protected-areas.mjs.
  useStaticGeoJsonLayer<ProtectedAreaProps>({
    mapRef,
    layerRef: protectedRef,
    show: showProtected,
    url: '/data/areas-protegidas.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style(feature?: Feature<Geometry, ProtectedAreaProps>) {
        const color = categoryColor(feature?.properties?.designacion_ap);
        return {
          color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: 1.2,
          opacity: 0.85,
          smoothFactor: 0.5,
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildProtectedPopup(feature.properties), { maxWidth: 280 });
      },
    }),
  });

  // Límite urbano — polígonos de Planes Reguladores Comunales del MINVU,
  // generado por scripts/build-urban-limit.mjs. Un solo estilo (ámbar) para
  // distinguir suelo urbano normado del resto (rural).
  useStaticGeoJsonLayer<UrbanLimitProps>({
    mapRef,
    layerRef: urbanLimitRef,
    show: showUrbanLimit,
    url: '/data/limite-urbano.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style: URBAN_LIMIT_STYLE,
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildUrbanLimitPopup(feature.properties), { maxWidth: 280 });
      },
    }),
  });

  // Límites comunales — División Político-Administrativa 2023 (SUBDERE,
  // geoportal.cl), generado por scripts/build-comunas.mjs. Capa de contexto:
  // línea discontinua gris pizarra al fondo del apilado, clicable para
  // consultar comuna/provincia/región/CUT.
  useStaticGeoJsonLayer<ComunaProps>({
    mapRef,
    layerRef: comunasRef,
    show: showComunas,
    url: '/data/limites-comunales.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      // Relleno pastel translúcido distinto por comuna (mapa político),
      // manteniendo el borde pizarra discontinuo de límite administrativo.
      style(feature?: Feature<Geometry, ComunaProps>) {
        return {
          ...COMUNAS_STYLE,
          fillOpacity: opacityRef.current.comunas,
          fillColor: comunaFillColor(feature?.properties?.CUT_COM),
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildComunaPopup(feature.properties), { maxWidth: 280 });
      },
    }),
  });

  // Red caminera — Red Vial Nacional de la Dirección de Vialidad (MOP,
  // mapas.mop.cl), generado por scripts/build-red-vial.mjs. Líneas violeta con
  // jerarquía por clasificación funcional; tooltip al pasar el mouse con la
  // toponimia oficial y el ROL (que suelen diferir de Google/OSM), popup con
  // el detalle completo del tramo.
  useStaticGeoJsonLayer<RedVialProps>({
    mapRef,
    layerRef: redVialRef,
    show: showRedVial,
    url: '/data/red-vial.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style(feature?: Feature<Geometry, RedVialProps>) {
        const group = ROAD_CLASS_GROUPS[roadClassGroup(feature?.properties?.CLASIFICACION)];
        return {
          color: group.color,
          weight: group.weight,
          opacity: 0.85,
          smoothFactor: 1,
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildRedVialPopup(feature.properties), { maxWidth: 300 });
        const name = feature.properties.NOMBRE_CAMINO;
        const rol = feature.properties.ROL;
        if (name || rol) {
          featureLayer.bindTooltip(
            `${esc(name ?? '')}${name && rol ? ' · ' : ''}${rol ? `ROL ${esc(rol)}` : ''}`,
            { sticky: true, direction: 'top', opacity: 0.92 },
          );
        }
      },
    }),
  });

  // Red de drenaje — ríos y esteros de la DGA (Banco Nacional de Aguas, MOP),
  // generado por scripts/build-red-drenaje.mjs. ~35k polylines nacionales con
  // el nombre oficial DGA (suele diferir del de Google/OSM), código de cuenca
  // BNA y jerarquía visual por tipo (ríos = línea más oscura y gruesa;
  // esteros = línea más clara y fina). El campo `tipo` del GeoJSON fue
  // inyectado por el ETL para distinguir origen sin parsear el TIPO textual.
  useStaticGeoJsonLayer<RedDrenajeProps>({
    mapRef,
    layerRef: redDrenajeRef,
    show: showRedDrenaje,
    url: '/data/red-drenaje.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style(feature?: Feature<Geometry, RedDrenajeProps>) {
        const group = DRENAJE_TYPE_GROUPS[drenajeType(feature?.properties)];
        return {
          color: group.color,
          weight: group.weight,
          opacity: 0.85,
          smoothFactor: 1,
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildRedDrenajePopup(feature.properties), { maxWidth: 280 });
        const name = feature.properties.NOMBRE;
        if (name) {
          featureLayer.bindTooltip(esc(name), {
            sticky: true,
            direction: 'top',
            opacity: 0.92,
          });
        }
      },
    }),
  });

  // Líneas de transmisión — ejes cartográficos oficiales de IDE Energía
  // (Ministerio de Energía, geometría CEN). Color y grosor por tensión nominal.
  // No se derivan buffers ni se presentan estas líneas como servidumbres.
  useStaticGeoJsonLayer<LineaTransmisionProps>({
    mapRef,
    layerRef: lineasTransmisionRef,
    show: showLineasTransmision,
    url: '/data/lineas-transmision.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style(feature?: Feature<Geometry, LineaTransmisionProps>) {
        const group = TENSION_GROUPS[tensionGroup(feature?.properties?.TENSION_KV)];
        const estado = feature?.properties?.ESTADO?.toUpperCase() ?? '';
        return {
          color: group.color,
          weight: group.weight,
          opacity: 0.88,
          smoothFactor: 1,
          dashArray: estado.includes('OPERACION') ? undefined : '6 4',
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildLineaTransmisionPopup(feature.properties), { maxWidth: 340 });
        const name = feature.properties.TRAMO || feature.properties.NOMBRE || 'Línea de transmisión';
        const tension = Number(feature.properties.TENSION_KV);
        const tensionLabel = Number.isFinite(tension) && tension > 0 ? ` · ${tension.toLocaleString('es-CL')} kV` : '';
        featureLayer.bindTooltip(`${esc(name)}${tensionLabel}`, {
          sticky: true,
          direction: 'top',
          opacity: 0.92,
        });
      },
    }),
  });

  // Catastro Frutícola (CIREN-ODEPA, IDE Minagri) — polígonos de productores
  // frutícolas por región. ETL estático (scripts/build-catastro-fruticola.mjs):
  // los 14 sublayers del grupo PRODUCTORES FRUTÍCOLAS se concatenan y
  // simplifican en una sola pasada de mapshaper. Color por especie
  // predominante (especie_01), con relleno translúcido y borde del mismo
  // tono. Es la única capa que puede tener >100k features: igual que las
  // áreas protegidas, se monta sobre L.geoJSON (canvas renderer del mapa) y
  // se estiliza por feature — la simplificación al 1,5 % ya rebajó la
  // geometría al nivel manejable del navegador.
  useStaticGeoJsonLayer<CatastroFruticolaProps>({
    mapRef,
    layerRef: catastroFruticolaRef,
    show: showCatastroFruticola,
    url: '/data/catastro-fruticola.geojson',
    onAdd: reorderOverlays,
    options: () => ({
      style(feature?: Feature<Geometry, CatastroFruticolaProps>) {
        const color = especieColor(feature?.properties?.especie_01);
        return {
          color,
          fillColor: color,
          fillOpacity: opacityRef.current.catastroFruticola,
          weight: 0.8,
          opacity: 0.85,
          smoothFactor: 0.6,
        };
      },
      onEachFeature(feature, featureLayer) {
        featureLayer.bindPopup(buildCatastroFruticolaPopup(feature.properties), { maxWidth: 280 });
      },
    }),
  });

  // Mapa de calor de valor — superficie continua interpolada por viewport.
  //
  // El servidor devuelve los centroides de una malla hexagonal con la MEDIANA
  // de $/m² por celda (`/api/hexbins`); aquí esas muestras se interpolan con un
  // kernel gaussiano (`lib/heat-surface.ts`) hacia un raster continuo que se
  // monta como `L.ImageOverlay`, igual que las capas remotas de suelos y CONAF.
  //
  // Por qué un raster y no polígonos: dibujar un hexágono por celda producía un
  // mosaico con huecos donde ninguna celda alcanzaba el umbral, y la retícula
  // se leía como un artefacto del método en vez de como el dato. La superficie
  // interpolada rellena el gradiente entre muestras y se desvanece donde no hay
  // respaldo, que es lo que se espera de un heatmap en un SIG.
  //
  // El raster se calcula sobre un bbox con 25 % de margen sobre el viewport
  // para que el borde de la pantalla no corte la interpolación; el overlay se
  // ancla a ese bbox ampliado.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hexbinsRef.current) {
      map.removeLayer(hexbinsRef.current);
      hexbinsRef.current = null;
    }
    hexbinSamplesRef.current = null;

    if (!showHexbins) {
      onHexbinStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: 1,
      interactive: false,
      attribution: HEXBINS_ATTRIBUTION,
    }).addTo(map);
    hexbinsRef.current = overlay;

    let sequence = 0;
    let controller: AbortController | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      hexbinSamplesRef.current = null;
    };

    const refresh = async () => {
      const id = ++sequence;
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      onHexbinStatusRef.current?.({ kind: 'loading' });

      // Margen del 25 %: sin él la gaussiana se trunca justo en el borde de la
      // pantalla y la superficie aparece recortada en seco al panear.
      const padded = map.getBounds().pad(0.25);
      const round = (n: number): string => n.toFixed(3);
      const params = new URLSearchParams(hexbinFiltersQs);
      params.set(
        'bbox',
        [padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth()]
          .map(round)
          .join(','),
      );
      params.set('z', String(map.getZoom()));
      params.set('destino', hexbinDestino ?? DESTINO_DEFAULT);
      params.set('min_n', String(hexbinMinN ?? HEXBIN_MIN_N_DEFAULT));

      try {
        const response = await fetch(`${HEXBINS_URL}?${params}`, { signal: ctrl.signal });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as FeatureCollection<Point, HexbinProps> &
          HexbinMeta;
        if (id !== sequence || !mapRef.current) return;

        const meta: HexbinMeta = {
          edge_m: data.edge_m,
          destino: data.destino,
          min_n: data.min_n,
          cells: data.cells,
          points: data.points,
        };

        if (!data.features.length) {
          clear();
          onHexbinStatusRef.current?.({ kind: 'empty', meta });
          return;
        }

        const zoom = map.getZoom();
        const nw = map.project(padded.getNorthWest(), zoom);
        const se = map.project(padded.getSouthEast(), zoom);
        const width = Math.round(se.x - nw.x);
        const height = Math.round(se.y - nw.y);

        const samples: HeatSample[] = [];
        const located: HexbinSample[] = [];
        for (const feature of data.features) {
          const [lng, lat] = feature.geometry.coordinates;
          const projected = map.project(L.latLng(lat, lng), zoom);
          samples.push({
            x: projected.x - nw.x,
            y: projected.y - nw.y,
            value: feature.properties.mediana_ppm2,
            n: feature.properties.n,
          });
          located.push({ lat, lng, props: feature.properties });
        }

        // El radio del kernel se ata al espaciado real de la malla, no a un
        // número fijo de píxeles: así el grado de suavizado es el mismo a
        // cualquier zoom. En una malla hexagonal de arista `a` el paso
        // centro-a-centro es 1,5·a en x y 1,73·a en y (~1,6·a de media).
        //
        // El factor 1,45 se calibró contra Valdivia y Chillán: con 1,9 cada
        // píxel promediaba una docena de celdas y la ciudad se convertía en
        // tres manchas gigantes sin estructura de barrio; con 1,15 volvía el
        // moteado, porque la mediana de 2–3 ventas en una celda es ruidosa y
        // sin solape suficiente ese ruido se ve tal cual. 1,45 promedia ~6–8
        // celdas vecinas: filtra el ruido y conserva el gradiente de barrio.
        const metersPerPixel =
          (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) /
          (256 * Math.pow(2, zoom));
        const spacingPx = (meta.edge_m * 1.6) / metersPerPixel;
        const radiusPx = Math.min(120, Math.max(14, spacingPx * 1.45));

        const values = data.features.map((f) => f.properties.mediana_ppm2);
        const scale = quantileScale(values);
        const canvas = renderHeatSurface({
          width,
          height,
          samples,
          radiusPx,
          ramp: hexbinRamp,
          scale,
        });
        if (id !== sequence || !mapRef.current || !canvas) {
          if (!canvas) clear();
          return;
        }

        overlay.setBounds(padded);
        overlay.setUrl(canvas.toDataURL('image/png'));
        hexbinSamplesRef.current = { samples: located, meta };
        reorderOverlays();
        onHexbinStatusRef.current?.({
          kind: 'ready',
          meta,
          breaks: quantileBreaks(values),
          scale,
          ramp: hexbinRamp,
        });
      } catch (err) {
        if (ctrl.signal.aborted || (err as Error)?.name === 'AbortError') return;
        clear();
        onHexbinStatusRef.current?.({ kind: 'error' });
      }
    };

    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 250);
    };

    // La superficie es un raster sin geometría clicable, así que la consulta
    // puntual se resuelve contra las muestras: se abre el popup de la celda más
    // cercana al clic, dentro de un radio de una celda y media. Fuera de eso el
    // clic pertenece a otra capa (o al mapa) y no se intercepta.
    const onClick = (event: L.LeafletMouseEvent) => {
      // Con la herramienta NDVI armada el clic pertenece a la consulta, no al
      // mapa de calor.
      if (ndviModeRef.current) return;
      const state = hexbinSamplesRef.current;
      if (!state || !state.samples.length) return;
      let best: HexbinSample | null = null;
      let bestDistance = Infinity;
      for (const sample of state.samples) {
        const distance = map.distance(event.latlng, L.latLng(sample.lat, sample.lng));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = sample;
        }
      }
      if (!best || bestDistance > state.meta.edge_m * 1.5) return;
      L.popup({ maxWidth: 300 })
        .setLatLng(event.latlng)
        .setContent(buildHexbinPopup(best.props, state.meta))
        .openOn(map);
    };

    void refresh();
    map.on('moveend', scheduleRefresh);
    map.on('click', onClick);
    return () => {
      if (debounce) clearTimeout(debounce);
      controller?.abort();
      // Invalida cualquier respuesta en vuelo que ya no tenga dónde pintarse.
      sequence++;
      map.off('moveend', scheduleRefresh);
      map.off('click', onClick);
      hexbinSamplesRef.current = null;
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (hexbinsRef.current === overlay) hexbinsRef.current = null;
    };
  }, [showHexbins, hexbinDestino, hexbinMinN, hexbinFiltersQs, hexbinRamp, reorderOverlays]);

  // Catastro CONAF — raster dinámico por viewport contra el MapServer oficial.
  // El dataset vectorial regional alcanza cientos de MB, por lo que se sirve
  // un PNG same-origin y los atributos se consultan puntualmente con identify.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (vegetacionalRef.current) map.removeLayer(vegetacionalRef.current);
    vegetacionalRef.current = null;
    if (!showVegetacional) return;

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.vegetacional,
      interactive: false,
      attribution: 'CONAF · Recursos vegetacionales',
    }).addTo(map);
    vegetacionalRef.current = overlay;
    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let identifyController: AbortController | null = null;
    let activeBlobUrl: string | null = null;

    const clearRaster = () => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    };

    const refresh = async () => {
      const sequence = ++exportSequence;
      exportController?.abort();
      if (map.getZoom() < VEGETACIONAL_MIN_ZOOM) {
        clearRaster();
        return;
      }
      const bounds = map.getBounds();
      const size = map.getSize();
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        size: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y))].join(','),
      });
      try {
        const response = await fetch(`${VEGETACIONAL_EXPORT_URL}?${params}`, { signal: controller.signal });
        if (!response.ok || sequence !== exportSequence) return;
        const blobUrl = URL.createObjectURL(await response.blob());
        await waitForImage(blobUrl);
        if (sequence !== exportSequence || !mapRef.current) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = blobUrl;
        overlay.setBounds(bounds);
        overlay.setUrl(blobUrl);
        reorderOverlays();
      } catch {
        if (!controller.signal.aborted) clearRaster();
      }
    };

    const identify = async (event: L.LeafletMouseEvent) => {
      if (ndviModeRef.current) return;
      if (map.getZoom() < VEGETACIONAL_MIN_ZOOM) return;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: [event.latlng.lng, event.latlng.lat].join(','),
        mapExtent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        imageDisplay: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y)), 96].join(','),
        tolerance: '3',
      });
      try {
        const response = await fetch(`${VEGETACIONAL_IDENTIFY_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { results?: Array<{ layerName: string; attributes: VegetacionalProps }> };
        const result = data.results?.[0];
        if (result) {
          L.popup({ maxWidth: 340 })
            .setLatLng(event.latlng)
            .setContent(buildVegetacionalPopup(result.attributes, result.layerName))
            .openOn(map);
        }
      } catch {}
    };

    void refresh();
    map.on('moveend', refresh);
    map.on('click', identify);
    return () => {
      exportController?.abort();
      identifyController?.abort();
      map.off('moveend', refresh);
      map.off('click', identify);
      clearRaster();
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (vegetacionalRef.current === overlay) vegetacionalRef.current = null;
    };
  }, [showVegetacional, reorderOverlays]);

  // NDVI Visual (Sentinel-2) — capa dinámica remota por viewport, misma familia
  // que suelos/vegetacional: UN PNG compuesto en el servidor (`/api/ndvi/export`
  // pinta las escenas COG de cada cuadrícula MGRS con la rampa de `ndvi-ramp.json`)
  // colgado en un L.ImageOverlay y refrescado en moveend. Dos diferencias con
  // sus vecinas, ambas por el costo de componer (~5 s por viewport):
  //   1. debounce de 250 ms — un paneo genera muchos moveend y cada uno obliga
  //      a releer pirámides de Sentinel-2;
  //   2. cuantización de parámetros (bbox a 4 decimales, tamaño múltiplo de 64)
  //      para que el CDN de Vercel reutilice claves entre micro-paneos y entre
  //      recargas de la misma vista; las bounds del overlay usan la MISMA caja
  //      cuantizada, así la imagen queda georreferenciada exactamente donde se
  //      pidió (desfase máximo ~11 m, invisible a esta escala).
  // La máquina de estados (loading/ready+fecha/error/zoom-required) viaja por
  // `onNdviVisualStatus` para que la leyenda no presente una falla del servicio
  // como "sin datos" — la doctrina de la leyenda de suelos.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (ndviVisualRef.current) {
      map.removeLayer(ndviVisualRef.current);
      ndviVisualRef.current = null;
    }
    if (!showNdviVisual) {
      onNdviVisualStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.ndviVisual,
      interactive: false,
      attribution: 'Copernicus Sentinel-2 vía Element 84 / AWS Open Data',
    }).addTo(map);
    ndviVisualRef.current = overlay;

    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let activeBlobUrl: string | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      const id = ++exportSequence;
      exportController?.abort();
      exportController = null;
      const bounds = map.getBounds();
      // Zoom bajo el mínimo: el servidor rechazaría la caja por span — aquí no
      // se emite peticiones y la leyenda lo dice explícitamente.
      if (map.getZoom() < NDVI_VISUAL_MIN_ZOOM) {
        clearRaster(bounds);
        onNdviVisualStatusRef.current?.({ kind: 'zoom-required', minZoom: NDVI_VISUAL_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onNdviVisualStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const oeste = redondearCoordenada(bounds.getWest());
      const sur = redondearCoordenada(bounds.getSouth());
      const este = redondearCoordenada(bounds.getEast());
      const norte = redondearCoordenada(bounds.getNorth());
      const ancho = Math.min(1600, Math.max(64, Math.ceil(map.getSize().x / 64) * 64));
      const alto = Math.min(1600, Math.max(64, Math.ceil(map.getSize().y / 64) * 64));
      const cajaCuantizada = L.latLngBounds([sur, oeste], [norte, este]);
      const params = new URLSearchParams({
        bbox: `${oeste},${sur},${este},${norte}`,
        size: `${ancho},${alto}`,
      });
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(`${NDVI_VISUAL_EXPORT_URL}?${params}`, {
          signal: controller.signal,
        });
        if (id !== exportSequence || controller.signal.aborted) return;
        if (response.status === 204) {
          // Ninguna escena útil en la caja (borde costero, sin cobertura): la
          // capa queda transparente y el mapa base se ve solo. No es falla.
          clearRaster(cajaCuantizada);
          onNdviVisualStatusRef.current?.({ kind: 'ready', fecha: null });
          return;
        }
        if (!response.ok) {
          clearRaster(cajaCuantizada);
          onNdviVisualStatusRef.current?.({ kind: 'error' });
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Respuesta NDVI Visual no es PNG');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || !ndviVisualRef.current) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        overlay.setBounds(cajaCuantizada);
        overlay.setUrl(activeBlobUrl);
        reorderOverlays();
        onNdviVisualStatusRef.current?.({
          kind: 'ready',
          fecha: response.headers.get('X-Ndvi-Fecha'),
        });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('NDVI Visual: no se pudo componer el raster del viewport.', error);
        clearRaster(cajaCuantizada);
        onNdviVisualStatusRef.current?.({ kind: 'error' });
      }
    };

    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 250);
    };

    void refresh();
    map.on('moveend', scheduleRefresh);
    return () => {
      if (debounce) clearTimeout(debounce);
      exportController?.abort();
      // Invalida respuestas en vuelo que ya no tienen dónde pintarse.
      exportSequence++;
      map.off('moveend', scheduleRefresh);
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (ndviVisualRef.current === overlay) ndviVisualRef.current = null;
      onNdviVisualStatusRef.current?.({ kind: 'idle' });
    };
  }, [showNdviVisual, reorderOverlays]);

  // Bioclima (WorldClim). Es la capa remota más simple del mapa y a propósito:
  // el raster recortado a Chile son 224×924 px (25-50 KB), así que el ETL lo
  // deja pintado como PNG y aquí solo se cuelga con sus bounds. Sin fetch por
  // viewport, sin refresco en `moveend` y sin servicio de terceros en runtime,
  // al revés que suelos CIREN —cuyo dataset de 500 MB sí obliga a ese patrón—.
  // Los bounds salen del manifiesto y no de una constante repetida: si cambia
  // el recorte del ETL, la imagen se sigue georreferenciando sola.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showBioclima) {
      if (bioclimaRef.current) {
        map.removeLayer(bioclimaRef.current);
        bioclimaRef.current = null;
      }
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const meta = await fetchBioclimaMeta();
        if (cancelled || !mapRef.current) return;

        const b = meta.boundsWgs84;
        const bounds = L.latLngBounds([b.sur, b.oeste], [b.norte, b.este]);
        const url = meta.variables[bioclimaVariable].archivo;

        if (bioclimaRef.current) {
          bioclimaRef.current.setUrl(url);
          bioclimaRef.current.setBounds(bounds);
        } else {
          bioclimaRef.current = L.imageOverlay(url, bounds, {
            opacity: opacityRef.current.bioclima,
            // No es clicable: el valor bajo el cursor se resuelve por popup del
            // mapa, no por eventos de la imagen, que taparía a las capas de
            // abajo si capturara el puntero.
            interactive: false,
          }).addTo(mapRef.current);
        }
        reorderOverlays();
      } catch (error) {
        console.error('Bioclima: no se pudo montar la capa.', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showBioclima, bioclimaVariable, reorderOverlays]);

  // Suelos agrológicos (CIREN) — capa dinámica remota: el dataset completo
  // supera los 500 MB, así que el servidor de CIREN renderiza la imagen con
  // su simbología oficial y aquí solo se descarga UN PNG por viewport
  // (export del MapServer sobre un L.ImageOverlay refrescado en moveend; el
  // WMS teselado tumbaba el servidor con ~40 GetMap simultáneos). La imagen
  // se pre-carga y recién entonces reemplaza a la anterior (sin parpadeo), y
  // un contador de secuencia descarta respuestas fuera de orden. Al hacer
  // clic se consulta la clase vía identify; ambas operaciones pasan por el
  // proxy same-origin del SIG, que valida CIREN y devuelve errores seguros con
  // el identificador exacto del servicio. Si el clic abrió el popup de otra
  // capa (comuna, camino, pin), se aborta para no pisarlo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (suelosRef.current) {
      map.removeLayer(suelosRef.current);
      suelosRef.current = null;
    }

    if (!showSuelos) {
      onSuelosStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.suelos,
      attribution: 'CIREN · Estudios Agrológicos',
      interactive: false,
    }).addTo(map);
    suelosRef.current = overlay;

    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let identifySequence = 0;
    let identifyController: AbortController | null = null;
    let activeBlobUrl: string | null = null;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++exportSequence;
      exportController?.abort();
      exportController = null;
      // A escala nacional el export obliga al servidor a rasterizar las 12
      // regiones completas: tarda minutos y degrada el servicio para todas
      // las consultas siguientes. Bajo el zoom mínimo no se pide nada.
      if (map.getZoom() < SUELOS_MIN_ZOOM) {
        clearRaster(bounds);
        onSuelosStatusRef.current?.({ kind: 'zoom-required', minZoom: SUELOS_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onSuelosStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        size: `${size.x},${size.y}`,
      });
      const url = `${SUELOS_EXPORT_URL}?${params}`;
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'export');
          if (id === exportSequence && !controller.signal.aborted) {
            onSuelosStatusRef.current?.({ kind: 'error', ...failure });
          }
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid soils response');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || !suelosRef.current) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        suelosRef.current.setUrl(candidateBlobUrl);
        suelosRef.current.setBounds(bounds);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        onSuelosStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la cobertura de suelos CIREN.', error);
        onSuelosStatusRef.current?.({
          kind: 'error',
          service: SUELOS_SERVICE_NAME,
          operation: 'export',
        });
      }
    };

    const onMoveEnd = () => void refresh();
    map.on('moveend', onMoveEnd);
    void refresh();

    let popupGeneration = 0;
    let popupOpenedThisTurn = false;
    const onPopupOpen = () => {
      popupGeneration++;
      popupOpenedThisTurn = true;
      queueMicrotask(() => {
        popupOpenedThisTurn = false;
      });
    };

    const onClick = async (e: L.LeafletMouseEvent) => {
      // Un feature vectorial puede abrir su popup durante el mismo evento. No
      // disparamos identify en ese caso ni reemplazamos popups abiertos después.
      if (popupOpenedThisTurn) return;
      // Herramienta NDVI armada: el clic no es una consulta de suelo.
      if (ndviModeRef.current) return;
      const expectedPopupGeneration = popupGeneration;
      // Bajo el zoom mínimo la capa no está visible: no consultar identify.
      if (map.getZoom() < SUELOS_MIN_ZOOM) return;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const { lat, lng } = e.latlng;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        tolerance: '2',
        mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        imageDisplay: `${size.x},${size.y},96`,
      });
      try {
        const response = await fetch(`${SUELOS_IDENTIFY_URL}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'identify');
          if (
            id !== identifySequence || controller.signal.aborted ||
            popupGeneration !== expectedPopupGeneration ||
            !mapRef.current || !suelosRef.current
          ) return;
          L.popup({ maxWidth: 300 })
            .setLatLng(e.latlng)
            .setContent(
              `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(failure.service)} ` +
              `(operación ${esc(failure.operation)}). Intenta nuevamente en unos segundos.</div>` +
              `</div>`,
            )
            .openOn(mapRef.current);
          return;
        }
        const data = (await response.json()) as {
          results?: { layerName?: string; soilClass?: string | null }[];
        };
        if (
          id !== identifySequence || controller.signal.aborted ||
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        const result = data.results?.find((item) => item.soilClass) ?? data.results?.[0];
        const clase = result?.soilClass ?? null;
        const region = result?.layerName ?? '';
        const body = clase
          ? `<div style="font-weight:600;font-size:0.92rem">Capacidad de uso: Clase ${esc(clase)}</div>` +
            `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
            `font-size:0.68rem;font-weight:600;color:#1e293b;background:${suelosClassColor(clase)};` +
            `border:1px solid rgba(0,0,0,.15)">Suelos agrológicos CIREN</div>` +
            (region ? `<div style="opacity:.7">${esc(region)}</div>` : '')
          : `<div style="font-weight:600;font-size:0.92rem">Sin clase CIREN registrada en este punto</div>` +
            `<div style="opacity:.7;margin-top:.2rem">El servicio respondió correctamente, pero el punto puede estar fuera del área estudiada o no tener clasificación disponible.</div>`;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">${body}` +
              `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${SUELOS_ATTRIBUTION}</div></div>`,
          )
          .openOn(mapRef.current);
      } catch (error) {
        if (controller.signal.aborted || id !== identifySequence) return;
        console.error('No se pudo consultar la clase de suelo CIREN.', error);
        if (
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(SUELOS_SERVICE_NAME)} ` +
              `(operación identify). Intenta nuevamente en unos segundos.</div></div>`,
          )
          .openOn(mapRef.current);
      }
    };

    map.on('popupopen', onPopupOpen);
    map.on('click', onClick);

    return () => {
      exportSequence++;
      identifySequence++;
      exportController?.abort();
      identifyController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
      map.off('popupopen', onPopupOpen);
      map.off('click', onClick);
      if (suelosRef.current && mapRef.current) {
        mapRef.current.removeLayer(suelosRef.current);
        suelosRef.current = null;
      }
    };
  }, [showSuelos]);

  // Propiedades rurales CIREN: raster por viewport e identify acotado. El
  // servicio contiene polígonos prediales grandes, por lo que no se descarga
  // como GeoJSON ni se usa WMS teselado en el navegador.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (propiedadesRuralesRef.current) map.removeLayer(propiedadesRuralesRef.current);
    propiedadesRuralesRef.current = null;
    if (!showPropiedadesRurales) {
      onPropiedadesRuralesStatusRef.current?.({ kind: 'idle' });
      return;
    }
    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: opacityRef.current.propiedadesRurales,
      attribution: PROPIEDADES_RURALES_ATTRIBUTION,
      interactive: false,
    }).addTo(map);
    propiedadesRuralesRef.current = overlay;
    reorderOverlays();
    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let identifySequence = 0;
    let identifyController: AbortController | null = null;
    let activeBlobUrl: string | null = null;
    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
    };
    const refresh = async () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++exportSequence;
      exportController?.abort();
      if (map.getZoom() < PROPIEDADES_RURALES_MIN_ZOOM) {
        clearRaster(bounds);
        onPropiedadesRuralesStatusRef.current?.({ kind: 'zoom-required', minZoom: PROPIEDADES_RURALES_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onPropiedadesRuralesStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      let candidate: string | null = null;
      try {
        const params = new URLSearchParams({ bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`, size: `${size.x},${size.y}` });
        const response = await fetch(`${PROPIEDADES_RURALES_EXPORT_URL}?${params}`, { signal: controller.signal });
        if (response.status === 204) { onPropiedadesRuralesStatusRef.current?.({ kind: 'ready' }); return; }
        if (!response.ok) { const failure = await ruralFailureDetails(response, 'export'); if (id === exportSequence && !controller.signal.aborted) onPropiedadesRuralesStatusRef.current?.({ kind: 'error', ...failure }); return; }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid rural property image');
        candidate = URL.createObjectURL(blob);
        await waitForImage(candidate);
        if (id !== exportSequence || controller.signal.aborted || !propiedadesRuralesRef.current) { URL.revokeObjectURL(candidate); candidate = null; return; }
        overlay.setUrl(candidate); overlay.setBounds(bounds); activeBlobUrl = candidate; candidate = null;
        onPropiedadesRuralesStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidate) URL.revokeObjectURL(candidate);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la capa de propiedades rurales CIREN.', error);
        onPropiedadesRuralesStatusRef.current?.({ kind: 'error', service: PROPIEDADES_RURALES_SERVICE_NAME, operation: 'export' });
      }
    };
    const onMoveEnd = () => void refresh();
    map.on('moveend', onMoveEnd);
    void refresh();
    let popupGeneration = 0;
    const onPopupOpen = () => { popupGeneration++; };
    const onClick = async (e: L.LeafletMouseEvent) => {
      if (ndviModeRef.current) return;
      if (map.getZoom() < PROPIEDADES_RURALES_MIN_ZOOM) return;
      const expectedPopupGeneration = popupGeneration;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController(); identifyController = controller;
      const bounds = map.getBounds(); const size = map.getSize();
      const params = new URLSearchParams({ geometry: `${e.latlng.lng},${e.latlng.lat}`, mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`, imageDisplay: `${size.x},${size.y},96`, tolerance: '2' });
      try {
        const response = await fetch(`${PROPIEDADES_RURALES_IDENTIFY_URL}?${params}`, { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { results?: Array<{ layerName?: string | null; attributes?: { rol?: string | null; comuna?: string | null; codRegion?: string | null; quality?: string } }> };
        if (id !== identifySequence || controller.signal.aborted || popupGeneration !== expectedPopupGeneration || !mapRef.current || !data.results?.length) return;
        const item = data.results[0]; const p = item.attributes ?? {};
        const rows = [['ROL SII del predio', p.rol], ['Comuna', p.comuna], ['Código de región', p.codRegion]].filter((row): row is [string, string] => Boolean(row[1]));
        const table = rows.map(([k, v]) => `<tr><td style="opacity:.55;padding:1px 8px 1px 0">${k}</td><td>${esc(v)}</td></tr>`).join('');
        L.popup({ maxWidth: 320 }).setLatLng(e.latlng).setContent(`<div style="font-size:.8rem;line-height:1.45;min-width:230px"><div style="font-weight:600;font-size:.92rem;color:${PROPIEDADES_RURALES_COLOR}">Propiedad rural CIREN</div><table style="border-collapse:collapse;margin-top:.3rem">${table}</table>${p.quality === 'rol-invalid' ? '<div style="margin-top:.3rem;color:#b91c1c">ROL no válido en la fuente.</div>' : ''}<div style="margin-top:.4rem;font-size:.62rem;opacity:.55">${PROPIEDADES_RURALES_DISCLAIMER}<br/>${PROPIEDADES_RURALES_ATTRIBUTION}</div></div>`).openOn(mapRef.current);
      } catch (error) { if (!controller.signal.aborted) console.error('No se pudo consultar la propiedad rural CIREN.', error); }
    };
    map.on('popupopen', onPopupOpen); map.on('click', onClick);
    return () => {
      exportSequence++; identifySequence++; exportController?.abort(); identifyController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd); map.off('popupopen', onPopupOpen); map.off('click', onClick);
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (propiedadesRuralesRef.current === overlay) propiedadesRuralesRef.current = null;
    };
  }, [showPropiedadesRurales, reorderOverlays]);

  // Resultado seleccionado por ROL: una única geometría vectorial sobre el
  // raster CIREN. No escucha moveend ni vive en estado Leaflet de React; al
  // cambiar la selección se elimina por completo y se crea una sola capa.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (propiedadRuralHighlightRef.current) {
      map.removeLayer(propiedadRuralHighlightRef.current);
      propiedadRuralHighlightRef.current = null;
    }
    if (!showPropiedadesRurales || !selectedRuralFeature) return;

    const { feature, extent } = selectedRuralFeature;
    const layer = L.geoJSON(feature, {
      style: {
        color: PROPIEDADES_RURALES_COLOR,
        weight: 3,
        opacity: 1,
        fillColor: PROPIEDADES_RURALES_COLOR,
        fillOpacity: 0.12,
      },
      onEachFeature(item, featureLayer) {
        const props = item.properties;
        featureLayer.bindPopup(
          `<div style="font-size:.8rem;line-height:1.45;min-width:230px">` +
          `<div style="font-weight:600;font-size:.92rem;color:${PROPIEDADES_RURALES_COLOR}">ROL ${esc(props.rol)}</div>` +
          `<div style="opacity:.7">${esc(props.comuna ?? 'Comuna no informada')} · ${esc(props.sourceRegion)}</div>` +
          `<div style="margin-top:.35rem;font-size:.65rem;opacity:.55">CIREN ${esc(props.vintage)} · ${esc(props.disclaimer)}</div>` +
          `</div>`,
          { maxWidth: 320 },
        );
      },
    }).addTo(map);
    propiedadRuralHighlightRef.current = layer;
    reorderOverlays();
    const [west, south, east, north] = extent;
    map.flyToBounds(L.latLngBounds([south, west], [north, east]), {
      padding: [45, 45],
      maxZoom: 17,
      duration: 1.2,
    });
    layer.openPopup();

    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      if (propiedadRuralHighlightRef.current === layer) propiedadRuralHighlightRef.current = null;
    };
  }, [showPropiedadesRurales, selectedRuralFeature, reorderOverlays]);

  // Capas KML del usuario — ya parseadas a GeoJSON en el navegador (lib/kml).
  // Se sincronizan por id: se quitan las eliminadas u ocultas, se agregan las
  // visibles que falten, y al aparecer una capa nueva el mapa vuela a su
  // extensión para confirmar visualmente la carga.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wanted = new Map(kmlLayers.filter((k) => k.visible).map((k) => [k.id, k]));

    for (const [id, layer] of kmlRef.current) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        kmlRef.current.delete(id);
      }
    }

    let added: L.GeoJSON | null = null;
    for (const [id, kml] of wanted) {
      if (kmlRef.current.has(id)) continue;
      const layer = L.geoJSON(kml.geojson, {
        style: {
          color: kml.color,
          fillColor: kml.color,
          fillOpacity: 0.15,
          weight: 2,
          opacity: 0.9,
        },
        pointToLayer(_feature, latlng) {
          return L.circleMarker(latlng, {
            radius: 6,
            color: kml.color,
            fillColor: kml.color,
            fillOpacity: 0.75,
            weight: 1.5,
          });
        },
        onEachFeature(feature, featureLayer) {
          featureLayer.bindPopup(buildKmlPopup(feature.properties, kml), { maxWidth: 280 });
        },
      }).addTo(map);
      kmlRef.current.set(id, layer);
      if (!seenKmlIds.current.has(id)) {
        seenKmlIds.current.add(id);
        added = layer;
      }
    }

    if (added) {
      const bounds = added.getBounds();
      if (bounds.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    reorderOverlays();
  }, [kmlLayers, reorderOverlays]);

  // Resultado del geocoder: vuela a la zona (bbox si existe, si no zoom 15) y
  // deja un marcador pulsante con el nombre del lugar. El marcador anterior se
  // quita al elegir otro resultado (cleanup del efecto).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;

    const icon = L.divIcon({
      className: 'geo-focus',
      html: '<span class="geo-focus-ring"></span><span class="geo-focus-dot"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker([focus.lat, focus.lng], { icon, zIndexOffset: 1000 });
    marker.bindPopup(
      `<div style="font-size:0.8rem;line-height:1.4;max-width:240px">${esc(focus.label)}</div>`,
    );
    marker.addTo(map);

    if (focus.bbox) {
      const [south, north, west, east] = focus.bbox;
      map.flyToBounds(L.latLngBounds([south, west], [north, east]), {
        maxZoom: 16,
        padding: [40, 40],
        duration: 1.4,
      });
    } else {
      map.flyTo([focus.lat, focus.lng], 15, { duration: 1.4 });
    }

    return () => {
      map.removeLayer(marker);
    };
  }, [focus]);

  // `data-basemap` selecciona el filtro CSS del lienzo (globals.css): `none`
  // para los fondos que se muestran tal cual, `light`/`dark` para el lienzo
  // neutro. Va en el contenedor, no en :root, para que el filtro se limite al
  // panel de tiles del mapa y nunca toque los overlays vectoriales.
  // `data-basemap-blank` reemplaza el gris de fábrica de Leaflet cuando no hay
  // capa de tiles («Sin fondo»).
  return (
    <div
      ref={containerRef}
      data-basemap={basemapFilterKey(basemap, isDark)}
      data-basemap-blank={getBasemap(basemap).url === null ? 'true' : undefined}
      className="h-full w-full"
    />
  );
}
