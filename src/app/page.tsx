'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import type { GeocodeResult } from '@/lib/types';
import type { LayerMetadataEntry } from '@/lib/map-export';
import { SUELOS_SERVICE_NAME, type SuelosStatus } from '@/lib/suelos';
import { HUMEDALES_SERVICE_NAME, type HumedalesStatus } from '@/lib/humedales';
import { NDVI_VISUAL_SERVICE_NAME, type NdviVisualEstado } from '@/lib/ndvi-visual';
import {
  PROPIEDADES_RURALES_SERVICE_NAME,
  type PropiedadesRuralesStatus,
} from '@/lib/propiedades-rurales';
import { type HexbinStatus } from '@/lib/hexbins';
import { RetroLoader } from '@/components/RetroLoader';
import { LayersControl } from '@/components/LayersControl';
import { DEFAULT_LAYER_OPACITY } from '@/lib/layer-opacity';
import { MapPanel, type PanelId } from '@/components/MapPanel';
import { BasemapSwitcher } from '@/components/BasemapSwitcher';
import {
  getBasemapServerSnapshot,
  getBasemapSnapshot,
  setBasemapPreference,
  subscribeBasemap,
} from '@/lib/basemap-store';
import { SearchFields, FilterFields, StatsFields } from '@/components/FieldGroups';
import { GeocoderSearch } from '@/components/GeocoderSearch';
import { InfoPanel } from '@/components/InfoPanel';
import { NdviPanel } from '@/components/NdviPanel';
import { track } from '@/lib/analytics';
import { buildExportMetadata } from '@/lib/export-metadata';
import { useCbrData } from '@/hooks/useCbrData';
import { useKmlLayers } from '@/hooks/useKmlLayers';
import { useNdviQuery } from '@/hooks/useNdviQuery';
import { useRuralRolSearch } from '@/hooks/useRuralRolSearch';
import { PERMALINK_DEFAULTS, usePermalinkSync } from '@/hooks/usePermalink';
import { parsePermalink, type PermalinkLayer, type PermalinkState } from '@/lib/permalink';

// El RetroLoader de page.tsx cubre también la carga del módulo, así que el
// dynamic no necesita fallback propio (evita dos loaders superpuestos).
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => null,
});

const fmtCLP = (v: number | null | undefined): string =>
  v == null
    ? '—'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(v);

const fmtInt = (v: number): string => v.toLocaleString('es-CL');

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const SearchIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.5" y2="16.5" />
  </svg>
);

const FilterIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="7" y1="12" x2="17" y2="12" />
    <line x1="10" y1="18" x2="14" y2="18" />
  </svg>
);

const StatsIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="5" y1="20" x2="5" y2="12" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="19" y1="20" x2="19" y2="9" />
  </svg>
);

const ShareIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
    <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
  </svg>
);

const CrosshairIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="7" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
  </svg>
);

/** Handle imperativo hacia MapView para disparar el export a PNG. La función
 *  es provista por el componente (tiene acceso al mapa y a los refs de las
 *  capas) y la página sólo la invoca y la bloquea mientras está corriendo.
 *  Acepta `{ metadata }` opcional: page.tsx construye el cajetín de
 *  trazabilidad legal en el momento del click (con los filtros vigentes) y
 *  se lo pasa para que MapView lo reenvíe a `exportMapToPng`. */
type MapExportArgs = { metadata?: LayerMetadataEntry[] };
type MapExportFn = (args?: MapExportArgs) => Promise<void>;

// La query con que se abrió la pestaña, leída una sola vez: las escrituras
// posteriores del permalink (replaceState) no deben volver a montar la app.
let openingSearch: string | null = null;
const subscribeNever = () => () => {};
const getOpeningSearch = () => (openingSearch ??= window.location.search);
const getServerSearch = () => '';

/**
 * El servidor no conoce la query (la página es estática), así que pinta la
 * vista por defecto. Si la pestaña se abrió con un permalink, al hidratar la
 * query cambia, cambia la `key` y `SigApp` se monta de nuevo con ese estado
 * en sus `useState` iniciales — sin desajuste de hidratación y sin cascadas de
 * `setState` en efectos. Sin query (el caso común) la key no cambia y no hay
 * segundo montaje.
 */
export default function Home() {
  const search = useSyncExternalStore(subscribeNever, getOpeningSearch, getServerSearch);
  const initial = useMemo(() => parsePermalink(search, PERMALINK_DEFAULTS), [search]);
  return <SigApp key={search} initial={initial} />;
}

function SigApp({ initial }: { initial: PermalinkState }) {
  const on = (layer: PermalinkLayer) => initial.layers.includes(layer);
  const [comuna, setComuna] = useState(initial.filters.comuna);
  const [anioFrom, setAnioFrom] = useState<number | null>(initial.filters.anioMin);
  const [fechaDesde, setFechaDesde] = useState(initial.filters.fechaDesde);
  const [fechaHasta, setFechaHasta] = useState(initial.filters.fechaHasta);
  const [montoMin, setMontoMin] = useState(initial.filters.montoMin);
  const [montoMax, setMontoMax] = useState(initial.filters.montoMax);
  const [supMin, setSupMin] = useState(initial.filters.supMin);
  const [supMax, setSupMax] = useState(initial.filters.supMax);
  const [predio, setPredio] = useState(initial.filters.predio);
  const [rol, setRol] = useState(initial.filters.rol);

  // Resultado del geocoder: MapView vuela ahí y deja un marcador pulsante.
  const [focus, setFocus] = useState<GeocodeResult | null>(null);
  const handleGeocode = useCallback((result: GeocodeResult) => {
    track('geocode');
    setFocus(result);
  }, []);

  // Arranque con progreso real, en dos fases: descarga del dataset (5–60%) y
  // render de los marcadores en el mapa (64–99%). `bootDone` recién se activa
  // cuando MapView confirma que los clusters están pintados, de modo que el
  // 100% de la barra coincide con el mapa visible (sin pantallazo en blanco).
  const [bootProgress, setBootProgress] = useState(3);
  const [bootDone, setBootDone] = useState(false);
  const booting = useRef(true);
  // «Saltar y explorar mientras carga»: el loader se va, la carga sigue y una
  // píldora avisa el avance y el final. Mientras el loader está a la vista la
  // página queda `inert`: nada parece usable antes de tiempo.
  const [loaderSkipped, setLoaderSkipped] = useState(false);
  const [loaderGone, setLoaderGone] = useState(false);
  const [loadedNotice, setLoadedNotice] = useState(false);
  const loaderSkippedRef = useRef(false);
  const loadedNoticeTimer = useRef(0);
  // Si las transacciones están apagadas (permalink sin `puntos`) o el filtro
  // devuelve 0, el clúster nunca informa que terminó de pintar: el arranque
  // se da por cumplido al decodificar. Antes el loader quedaba trabado.
  const showPointsRef = useRef(initial.layers.includes('puntos'));

  const handleRenderProgress = useCallback((processed: number, total: number) => {
    if (!booting.current || total === 0) return;
    setBootProgress(64 + Math.round((processed / total) * 35));
  }, []);

  const handleRenderComplete = useCallback(() => {
    if (!booting.current) return;
    booting.current = false;
    setBootProgress(100);
    setBootDone(true);
    // Tiempo real hasta el mapa usable: la métrica a optimizar (21 MB de puntos).
    track('boot', { ms: Math.round(performance.now()) });
    if (loaderSkippedRef.current) {
      setLoadedNotice(true);
      window.clearTimeout(loadedNoticeTimer.current);
      loadedNoticeTimer.current = window.setTimeout(() => setLoadedNotice(false), 5000);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(loadedNoticeTimer.current), []);

  const bootProgressRef = useRef(3);
  useEffect(() => {
    bootProgressRef.current = bootProgress;
  }, [bootProgress]);
  const handleSkipLoader = useCallback(() => {
    loaderSkippedRef.current = true;
    setLoaderSkipped(true);
    track('boot_skip', { pct: bootProgressRef.current });
  }, []);
  const handleLoaderGone = useCallback(() => setLoaderGone(true), []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (comuna !== 'todas') p.set('comuna', comuna);
    if (anioFrom != null) p.set('anio_min', String(anioFrom));
    if (fechaDesde) p.set('fecha_desde', fechaDesde);
    if (fechaHasta) p.set('fecha_hasta', fechaHasta);
    if (montoMin) p.set('monto_min', montoMin);
    if (montoMax) p.set('monto_max', montoMax);
    if (supMin) p.set('sup_min', supMin);
    if (supMax) p.set('sup_max', supMax);
    if (predio.trim()) p.set('predio', predio.trim());
    if (rol.trim()) p.set('rol', rol.trim());
    return p.toString();
  }, [comuna, anioFrom, fechaDesde, fechaHasta, montoMin, montoMax, supMin, supMax, predio, rol]);

  const activeFilters = [
    comuna !== 'todas',
    anioFrom != null,
    fechaDesde,
    fechaHasta,
    montoMin,
    montoMax,
    supMin,
    supMax,
  ].filter(Boolean).length;

  const activeSearch = [predio.trim(), rol.trim()].filter(Boolean).length;

  const debouncedQs = useDebounced(queryString, 400);

  const { facets, points, stats, loading, error } = useCbrData(debouncedQs, {
    onDownloadProgress: (frac) => {
      if (booting.current) setBootProgress(5 + Math.round(frac * 55));
    },
    onDecoded: (count) => {
      if (!booting.current) return;
      setBootProgress(64); // dataset decodificado; falta el render
      // Sin marcadores que pintar no habrá aviso del clúster: se cierra aquí,
      // después de que el estado nuevo alcance a renderizar.
      if (count === 0 || !showPointsRef.current) window.setTimeout(handleRenderComplete, 0);
    },
    onError: () => {
      // Cierra el loader para que el mensaje de error quede visible.
      if (booting.current) track('boot_error');
      booting.current = false;
      setBootDone(true);
    },
  });
  const effectiveAnioFrom = anioFrom ?? facets?.minAnio ?? 2015;

  // Mobile: consolidated drawer (search + filters + stats), closed by default
  // so the map owns the screen.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Desktop: floating panels over the map, only one open at a time.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  // Toggling any panel closes the mobile drawer first: both live at
  // z-[1100]/z-[1101] and would otherwise stack two open layers on screen.
  const togglePanel = (id: PanelId) => {
    setDrawerOpen(false);
    setActivePanel((p) => (p === id ? null : id));
  };

  // Capa CIREN de propiedades rurales: la enciende también la búsqueda por ROL.
  const [showPropiedadesRurales, setShowPropiedadesRurales] = useState(on('propiedades_rurales'));
  const [propiedadesRuralesStatus, setPropiedadesRuralesStatus] = useState<PropiedadesRuralesStatus>({ kind: 'idle' });

  // El ROL encontrado enciende la capa CIREN y libera la pantalla en móvil.
  const handleRuralFeatureSelected = useCallback(() => {
    setShowPropiedadesRurales(true);
    setDrawerOpen(false);
  }, []);
  const { ruralRolSearch, selectedRuralFeature, clearRuralSearch, selectRuralMatch, locateRuralRol } =
    useRuralRolSearch({ rol, comuna, onFeatureSelected: handleRuralFeatureSelected });

  const handleRolChange = useCallback((value: string) => {
    setRol(value);
    clearRuralSearch();
  }, [clearRuralSearch]);

  const handleNdviOpened = useCallback(() => {
    setActivePanel(null);
    setDrawerOpen(false);
  }, []);
  const {
    ndviMode,
    setNdviMode,
    ndviConsulta,
    ndviExport,
    handleNdviPoint,
    handleNdviSerie,
    handleNdviResaltado,
    cerrarNdvi,
  } = useNdviQuery({ onPoint: handleNdviOpened });

  // Las transacciones CBR son la capa principal y vienen activadas por defecto,
  // pero el perito las puede ocultar para componer una vista limpia (por ej.
  // al exportar el mapa como anexo PNG de un informe de tasación).
  const [showPoints, setShowPoints] = useState(on('puntos'));
  useEffect(() => {
    showPointsRef.current = showPoints;
  }, [showPoints]);
  const [showProtected, setShowProtected] = useState(on('areas_protegidas'));
  const [showUrbanLimit, setShowUrbanLimit] = useState(on('limite_urbano'));
  const [showComunas, setShowComunas] = useState(on('comunas'));
  const [showRedVial, setShowRedVial] = useState(on('red_vial'));
  const [showRedDrenaje, setShowRedDrenaje] = useState(on('red_drenaje'));
  const [showLineasTransmision, setShowLineasTransmision] = useState(on('lineas_transmision'));
  const [showSuelos, setShowSuelos] = useState(on('suelos'));
  const [suelosStatus, setSuelosStatus] = useState<SuelosStatus>({ kind: 'idle' });
  const [showBioclima, setShowBioclima] = useState(on('bioclima'));
  const [bioclimaVariable, setBioclimaVariable] = useState<'temperature' | 'precipitation'>(initial.bioclima);
  const [layerOpacity, setLayerOpacity] = useState(DEFAULT_LAYER_OPACITY);
  const [showCatastroFruticola, setShowCatastroFruticola] = useState(on('catastro_fruticola'));
  const [showVegetacional, setShowVegetacional] = useState(on('vegetacional'));
  const [showHumedales, setShowHumedales] = useState(on('humedales'));
  const [humedalesStatus, setHumedalesStatus] = useState<HumedalesStatus>({ kind: 'idle' });
  const [showNdviVisual, setShowNdviVisual] = useState(on('ndvi_visual'));
  const [ndviVisualStatus, setNdviVisualStatus] = useState<NdviVisualEstado>({ kind: 'idle' });
  // Mapa de calor de valor. El destino arranca en habitacional: es el 57 % de
  // la base y el caso urbano que el usuario quiere ver primero.
  const [showHexbins, setShowHexbins] = useState(on('mapa_calor'));
  const [hexbinDestino, setHexbinDestino] = useState(initial.destino);
  const [hexbinMinN, setHexbinMinN] = useState(initial.minN);
  const [hexbinStatus, setHexbinStatus] = useState<HexbinStatus>({ kind: 'idle' });

  // Mapa base. La preferencia vive en localStorage y se lee por
  // `useSyncExternalStore` (ver lib/basemap-store.ts): el servidor pinta el
  // fondo por defecto, el cliente el guardado, sin hidratación rota ni
  // parpadeo del mapa al montar.
  const storedBasemap = useSyncExternalStore(
    subscribeBasemap,
    getBasemapSnapshot,
    getBasemapServerSnapshot,
  );
  // Un permalink con `fondo=` manda sobre la preferencia guardada, pero sin
  // pisarla: abrir un enlace ajeno no cambia el fondo por defecto del usuario.
  // En cuanto elige otro fondo, vuelve a mandar su preferencia.
  const [linkBasemap, setLinkBasemap] = useState(initial.basemap);
  const basemap = linkBasemap ?? storedBasemap;
  const handleBasemap = useCallback((id: Parameters<typeof setBasemapPreference>[0]) => {
    track('basemap', { basemap: id });
    setLinkBasemap(null);
    setBasemapPreference(id);
  }, []);

  // Analítica: qué capas se encienden. Se compara contra el render anterior
  // en vez de envolver cada uno de los quince `onToggle*`, así una capa nueva
  // queda medida con solo sumarla a este objeto. El estado inicial no cuenta
  // (los puntos CBR vienen encendidos por defecto).
  const layerFlags = useMemo(() => ({
    puntos: showPoints,
    mapa_calor: showHexbins,
    areas_protegidas: showProtected,
    limite_urbano: showUrbanLimit,
    comunas: showComunas,
    red_vial: showRedVial,
    red_drenaje: showRedDrenaje,
    lineas_transmision: showLineasTransmision,
    suelos: showSuelos,
    bioclima: showBioclima,
    catastro_fruticola: showCatastroFruticola,
    vegetacional: showVegetacional,
    humedales: showHumedales,
    propiedades_rurales: showPropiedadesRurales,
    ndvi_visual: showNdviVisual,
  }) satisfies Record<PermalinkLayer, boolean>, [
    showPoints, showHexbins, showProtected, showUrbanLimit, showComunas,
    showRedVial, showRedDrenaje, showLineasTransmision, showSuelos, showBioclima,
    showCatastroFruticola, showVegetacional, showHumedales, showPropiedadesRurales, showNdviVisual,
  ]);
  // Permalink: todo lo que define la vista, menos el encuadre (que llega de
  // MapView en cada `moveend`). `satisfies` arriba obliga a que cada capa
  // nueva también entre al enlace.
  const permalinkState = useMemo(() => ({
    layers: (Object.keys(layerFlags) as PermalinkLayer[]).filter((layer) => layerFlags[layer]),
    basemap,
    bioclima: bioclimaVariable,
    destino: hexbinDestino,
    minN: hexbinMinN,
    filters: { comuna, anioMin: anioFrom, fechaDesde, fechaHasta, montoMin, montoMax, supMin, supMax, predio, rol },
  }), [
    layerFlags, basemap, bioclimaVariable, hexbinDestino, hexbinMinN,
    comuna, anioFrom, fechaDesde, fechaHasta, montoMin, montoMax, supMin, supMax, predio, rol,
  ]);
  const { onViewChange, flush: flushPermalink } = usePermalinkSync(permalinkState, initial.view);

  // «Compartir vista»: en celulares abre la hoja de compartir del sistema; en
  // escritorio copia el enlace. Antes se fuerza la escritura pendiente de la
  // URL para no compartir una vista atrasada.
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const shareTimer = useRef(0);
  const handleShare = useCallback(async () => {
    flushPermalink();
    const url = window.location.href;
    const say = (text: string) => {
      setShareMessage(text);
      window.clearTimeout(shareTimer.current);
      shareTimer.current = window.setTimeout(() => setShareMessage(null), 3500);
    };
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'SIG de suelo', url });
        track('share', { method: 'native' });
        return;
      }
      await navigator.clipboard.writeText(url);
      say('Enlace copiado. Incluye encuadre, capas, fondo y filtros.');
      track('share', { method: 'clipboard' });
    } catch (err) {
      // Cancelar la hoja de compartir no es un error que haya que mostrar.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      say('No se pudo copiar: copia el enlace desde la barra de direcciones.');
    }
  }, [flushPermalink]);
  useEffect(() => () => window.clearTimeout(shareTimer.current), []);

  const prevLayerFlags = useRef(layerFlags);
  useEffect(() => {
    const prev = prevLayerFlags.current;
    prevLayerFlags.current = layerFlags;
    for (const [layer, on] of Object.entries(layerFlags)) {
      if (on && !prev[layer as keyof typeof prev]) track('layer_on', { layer });
    }
  }, [layerFlags]);

  // Imperative handle para el export PNG: MapView publica la función que
  // rasteriza la vista actual; aquí se la invoca y se bloquea el botón mientras
  // dura la generación del archivo (canvas.toBlob puede tardar >1s con 74k
  // pines re-proyectados). El cajetín de trazabilidad legal (filtros vigentes
  // + fuentes de capas activas) se construye acá, en el momento del click, y
  // se entrega por args para no inflar el deps array del useEffect en MapView.
  const { kmlLayers, kmlError, addKmlFiles, toggleKml, removeKml, renameKml } = useKmlLayers();

  const mapExportRef = useRef<MapExportFn | null>(null);
  const [exporting, setExporting] = useState(false);
  // Fallo del export. El PNG es el anexo del informe de tasación: si la
  // captura revienta, el usuario tiene que enterarse. Hasta la auditoría del
  // 2026-08-28 el botón volvía a su estado normal sin decir nada y la
  // excepción moría en la consola (ver docs/auditoria-ux-2026-08.md).
  const [exportError, setExportError] = useState<string | null>(null);
  const handleExportClick = useCallback(async () => {
    if (exporting || !mapExportRef.current) return;
    setExporting(true);
    setExportError(null);
    try {
      const metadata = buildExportMetadata({
        showBioclima,
        bioclimaVariable,
        showPoints,
        showProtected,
        showUrbanLimit,
        showComunas,
        showRedVial,
        showRedDrenaje,
        showLineasTransmision,
        showSuelos,
        showCatastroFruticola,
        showVegetacional,
        showHumedales,
        showPropiedadesRurales,
        showNdviVisual,
        showHexbins,
        hexbinStatus,
        comuna,
        anioFrom,
        fechaDesde,
        fechaHasta,
        montoMin,
        montoMax,
        supMin,
        supMax,
        predio,
        rol,
        stats,
        kmlLayers,
      });
      await mapExportRef.current({ metadata });
      track('export_png', { ok: true });
    } catch (err) {
      track('export_png', { ok: false });
      // El mensaje del error va al detalle porque identifica la pista que
      // falló (tiles, vectores, pines CBR) y ahorra abrir la consola.
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    showBioclima, bioclimaVariable,
    showPoints, showProtected, showUrbanLimit, showComunas, showRedVial,
    showRedDrenaje, showLineasTransmision, showSuelos, showCatastroFruticola, showVegetacional, showHumedales, showPropiedadesRurales,
    showNdviVisual,
    showHexbins, hexbinStatus,
    comuna, anioFrom, fechaDesde, fechaHasta, montoMin, montoMax, supMin, supMax, predio, rol,
    stats, kmlLayers,
  ]);


  // Analítica: qué filtros se usan. Solo los NOMBRES de los campos, nunca sus
  // valores (un ROL o un monto no deben salir del navegador hacia la tabla).
  const lastFilterKeys = useRef('');
  useEffect(() => {
    const keys = Array.from(new URLSearchParams(debouncedQs).keys()).sort().join(',');
    if (keys === lastFilterKeys.current) return;
    lastFilterKeys.current = keys;
    if (keys) track('filter', { fields: keys });
  }, [debouncedQs]);
  const exportHref = (format: 'csv' | 'geojson') =>
    `/api/export?${debouncedQs ? `${debouncedQs}&` : ''}format=${format}`;

  const searchFields = (
    <SearchFields
      predio={predio}
      setPredio={setPredio}
      rol={rol}
      setRol={handleRolChange}
      ruralRolSearch={ruralRolSearch}
      onLocateRuralRol={locateRuralRol}
      onSelectRuralMatch={selectRuralMatch}
      onClearRuralSearch={clearRuralSearch}
    />
  );

  const filterFields = (
    <FilterFields
      comuna={comuna}
      setComuna={setComuna}
      facets={facets}
      setAnioFrom={setAnioFrom}
      effectiveAnioFrom={effectiveAnioFrom}
      fechaDesde={fechaDesde}
      setFechaDesde={setFechaDesde}
      fechaHasta={fechaHasta}
      setFechaHasta={setFechaHasta}
      montoMin={montoMin}
      setMontoMin={setMontoMin}
      montoMax={montoMax}
      setMontoMax={setMontoMax}
      supMin={supMin}
      setSupMin={setSupMin}
      supMax={supMax}
      setSupMax={setSupMax}
      exportHref={exportHref}
    />
  );

  const statsFields = (
    <StatsFields loading={loading} stats={stats} fmtCLP={fmtCLP} fmtInt={fmtInt} />
  );

  const pageInert = !loaderGone && !loaderSkipped;
  return (
    <>
    {/* Fuera de <main> para cubrir también la cabecera; se desmonta solo. */}
    <RetroLoader
      progress={bootProgress}
      done={bootDone}
      skipped={loaderSkipped}
      onSkip={handleSkipLoader}
      onGone={handleLoaderGone}
    />
    <main
      className="flex flex-1 flex-col md:max-h-screen md:overflow-hidden"
      inert={pageInert}
      aria-busy={pageInert}
    >
      {/* Desktop app shell: the column is capped at the viewport so the layer
          dock (a flex sibling of the map) can never make the whole page grow
          and push the map below the fold — its own body scrolls instead.
          Mobile keeps `min-h` behaviour: the drawer is `fixed` and the page
          may scroll. */}
      {/* Header — una sola fila delgada para que el mapa domine la pantalla */}
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 md:px-6 md:py-3 dark:border-white/10">
        <h1 className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
          SIG de suelo · Datos abiertos
        </h1>
        <div className="relative flex items-center gap-3">
          <button
            type="button"
            onClick={handleShare}
            title="Copia un enlace a esta vista: encuadre, capas, mapa base y filtros. Las capas KML propias no se incluyen."
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/15 px-2.5 text-xs transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)] dark:border-white/20 dark:hover:bg-white/10"
          >
            {ShareIcon}
            <span className="hidden sm:inline">Compartir vista</span>
            <span className="sr-only sm:hidden">Compartir vista</span>
          </button>
          {shareMessage && (
            <div
              role="status"
              className="absolute right-0 top-10 z-[1300] w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-md border border-black/10 bg-[var(--background)] px-3 py-2 text-xs shadow-lg dark:border-white/15"
            >
              {shareMessage}
            </div>
          )}
          <a
            href="https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ver el código fuente en GitHub"
            className="group inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full border border-black/15 px-2 text-xs transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)] dark:border-white/20 dark:hover:bg-white/10"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 motion-safe:transition-all motion-safe:duration-300 motion-safe:group-hover:scale-110 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:rotate-6 motion-safe:group-focus-visible:scale-110 motion-safe:group-focus-visible:-translate-y-0.5 motion-safe:group-focus-visible:rotate-6"
              fill="currentColor"
            >
              <path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.08c-3.1.68-3.76-1.32-3.76-1.32-.5-1.3-1.23-1.65-1.23-1.65-1.01-.7.08-.69.08-.69 1.12.08 1.71 1.15 1.71 1.15 1 .1.78 2.4 3.77 1.7.1-.72.4-1.21.72-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.24-5.1 5.51.4.35.76 1.03.76 2.08V22c0 .29.2.63.76.53A11.1 11.1 0 0 0 12 .9Z" />
            </svg>
            <span className="hidden max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity] duration-300 ease-out group-hover:max-w-xs group-hover:opacity-100 group-focus-visible:max-w-xs group-focus-visible:opacity-100 md:inline">
              Código abierto
            </span>
          </a>
          <InfoPanel />
        </div>
      </header>

      {/* Backdrop behind the mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[1100] bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer mobile consolidado: búsqueda + filtros + estadísticas */}
      <section
        className={`fixed inset-x-0 bottom-0 z-[1101] max-h-[82vh] overflow-y-auto rounded-t-2xl border border-black/10 bg-[var(--background)] px-4 py-4 pb-6 shadow-2xl transition-transform duration-300 md:hidden dark:border-white/10 ${
          drawerOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-medium">Buscar y filtrar</span>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Cerrar"
            className="rounded-md px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
          >
            ✕
          </button>
        </div>

        <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide opacity-50">Buscar</h2>
        <div className="mt-2">{searchFields}</div>

        <h2 className="mt-5 border-t border-black/10 pt-4 text-xs font-semibold uppercase tracking-wide opacity-50 dark:border-white/10">
          Filtros
        </h2>
        <div className="mt-2">{filterFields}</div>

        <h2 className="mt-5 border-t border-black/10 pt-4 text-xs font-semibold uppercase tracking-wide opacity-50 dark:border-white/10">
          Estadísticas
        </h2>
        <div className="mt-2">{statsFields}</div>

        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="mt-5 w-full rounded-md bg-[hsl(153_28%_30%)] py-2.5 text-sm font-medium text-white"
        >
          Ver {loading ? '' : fmtInt(stats?.count ?? 0)} resultados en el mapa
        </button>
      </section>

      {/* Layer dock + map: the sidebar lives IN FLOW on the left and pushes
          the map on desktop; on mobile it is a fixed bottom drawer. Both are
          siblings so every `absolute`/`fixed` control positions against the
          right box: map overlays against the section, sidebar controls against
          this container. */}
      <div className="relative flex min-h-0 flex-1 overflow-x-clip">
        <LayersControl
          layerOpacity={layerOpacity}
          onLayerOpacity={(key, value) => setLayerOpacity((previous) => ({ ...previous, [key]: value }))}
          activeId={activePanel}
          onActivate={togglePanel}
          showPoints={showPoints}
          onTogglePoints={setShowPoints}
          showHexbins={showHexbins}
          onToggleHexbins={setShowHexbins}
          hexbinStatus={hexbinStatus}
          hexbinDestino={hexbinDestino}
          onHexbinDestino={setHexbinDestino}
          hexbinMinN={hexbinMinN}
          onHexbinMinN={setHexbinMinN}
          showProtected={showProtected}
          onToggleProtected={setShowProtected}
          showUrbanLimit={showUrbanLimit}
          onToggleUrbanLimit={setShowUrbanLimit}
          showComunas={showComunas}
          onToggleComunas={setShowComunas}
          showRedVial={showRedVial}
          onToggleRedVial={setShowRedVial}
          showRedDrenaje={showRedDrenaje}
          onToggleRedDrenaje={setShowRedDrenaje}
          showLineasTransmision={showLineasTransmision}
          onToggleLineasTransmision={setShowLineasTransmision}
          showSuelos={showSuelos}
          onToggleSuelos={setShowSuelos}
          suelosStatus={suelosStatus}
          showBioclima={showBioclima}
          onToggleBioclima={setShowBioclima}
          bioclimaVariable={bioclimaVariable}
          onBioclimaVariable={setBioclimaVariable}
          showCatastroFruticola={showCatastroFruticola}
          onToggleCatastroFruticola={setShowCatastroFruticola}
          showVegetacional={showVegetacional}
          onToggleVegetacional={setShowVegetacional}
          showHumedales={showHumedales}
          onToggleHumedales={setShowHumedales}
          humedalesStatus={humedalesStatus}
          showPropiedadesRurales={showPropiedadesRurales}
          onTogglePropiedadesRurales={setShowPropiedadesRurales}
          propiedadesRuralesStatus={propiedadesRuralesStatus}
          showNdviVisual={showNdviVisual}
          onToggleNdviVisual={setShowNdviVisual}
          ndviVisualStatus={ndviVisualStatus}
          kmlLayers={kmlLayers}
          kmlError={kmlError}
          onAddKmlFiles={addKmlFiles}
          onToggleKml={toggleKml}
          onRemoveKml={removeKml}
          onRenameKml={renameKml}
          onExport={handleExportClick}
          exporting={exporting}
          ndviMode={ndviMode}
          onToggleNdviMode={() => setNdviMode((m) => !m)}
        />

        {/* Mapa a pantalla completa con paneles flotantes */}
        <section className="relative min-h-[70vh] flex-1 md:min-h-0">
          {/* Falla de las transacciones CBR (Neon). Es un aviso, no una capa:
              antes cubría todo el mapa (`inset-0`) y se tragaba los clics, así
              que las capas que sí funcionaban (humedales, suelos, NDVI…)
              quedaban inutilizables. */}
          {error && (
            <div
              role="alert"
              className="absolute left-1/2 top-28 z-[650] w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-center md:top-16 text-xs leading-snug text-red-800 shadow-lg backdrop-blur dark:text-red-200"
            >
              <strong>No se pudieron cargar las transacciones CBR.</strong>{' '}
              Las demás capas del mapa siguen disponibles.
            </div>
          )}
          <div className="absolute inset-0">
            <MapView
              layerOpacity={layerOpacity}
              points={points}
              showPoints={showPoints}
              showProtected={showProtected}
              showUrbanLimit={showUrbanLimit}
              showComunas={showComunas}
              showRedVial={showRedVial}
              showRedDrenaje={showRedDrenaje}
              showLineasTransmision={showLineasTransmision}
              showSuelos={showSuelos}
              onSuelosStatus={setSuelosStatus}
              showBioclima={showBioclima}
              bioclimaVariable={bioclimaVariable}
              showCatastroFruticola={showCatastroFruticola}
              showVegetacional={showVegetacional}
              showHumedales={showHumedales}
              onHumedalesStatus={setHumedalesStatus}
              showPropiedadesRurales={showPropiedadesRurales}
              showNdviVisual={showNdviVisual}
              onNdviVisualStatus={setNdviVisualStatus}
              onPropiedadesRuralesStatus={setPropiedadesRuralesStatus}
              selectedRuralFeature={selectedRuralFeature}
              showHexbins={showHexbins}
              hexbinDestino={hexbinDestino}
              hexbinMinN={hexbinMinN}
              hexbinFiltersQs={debouncedQs}
              onHexbinStatus={setHexbinStatus}
              kmlLayers={kmlLayers}
              basemap={basemap}
              focus={focus}
              initialView={initial.view}
              onViewChange={onViewChange}
              onRenderProgress={handleRenderProgress}
              onRenderComplete={handleRenderComplete}
              mapExportRef={mapExportRef}
              ndviMode={ndviMode}
              ndviConsulta={ndviConsulta}
              onNdviPoint={handleNdviPoint}
              ndvi={ndviExport}
            />
          </div>
          {/* Carga en segundo plano tras «Saltar»: avance y aviso de término. */}
          {loaderSkipped && !error && (!bootDone || loadedNotice) && (
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute left-1/2 top-28 z-[640] -translate-x-1/2 whitespace-nowrap rounded-full border border-black/15 bg-[var(--background)]/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur md:top-16 dark:border-white/20"
            >
              {bootDone ? (
                <>
                  <span aria-hidden="true" className="mr-1 text-[hsl(153_40%_40%)]">✓</span>
                  {fmtInt(points.length)} transacciones cargadas
                </>
              ) : (
                <>
                  <span aria-hidden="true" className="mr-1 inline-block animate-pulse">◌</span>
                  Cargando transacciones en segundo plano · {Math.min(99, bootProgress)} %
                </>
              )}
            </div>
          )}

          {showSuelos && suelosStatus.kind === 'error' && (
            <div
              role="alert"
              className="absolute bottom-8 left-1/2 z-[650] w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-xs leading-snug text-red-800 shadow-lg backdrop-blur dark:text-red-200"
            >
              <strong>Capa de suelos temporalmente no disponible.</strong>{' '}
              No responde {suelosStatus.service || SUELOS_SERVICE_NAME} (operación{' '}
              {suelosStatus.operation}). El resto del SIG continúa funcionando normalmente.
            </div>
          )}
          {showHumedales && humedalesStatus.kind === 'error' && (
            <div
              role="alert"
              className="absolute bottom-32 left-1/2 z-[650] w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-xs leading-snug text-red-800 shadow-lg backdrop-blur dark:text-red-200"
            >
              <strong>Capa de humedales temporalmente no disponible.</strong>{' '}
              No responde {humedalesStatus.service || HUMEDALES_SERVICE_NAME} (operación{' '}
              {humedalesStatus.operation}). El resto del SIG continúa funcionando normalmente.
            </div>
          )}
          {exportError && (
            <div
              role="alert"
              className="absolute bottom-32 left-1/2 z-[650] w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-xs leading-snug text-red-800 shadow-lg backdrop-blur dark:text-red-200"
            >
              <div className="flex items-start justify-between gap-2">
                <p>
                  <strong>No se pudo generar el PNG.</strong>{' '}
                  La vista del mapa sigue intacta; puedes reintentar o apagar
                  alguna capa antes de exportar.
                  <span className="mt-1 block opacity-70">Detalle: {exportError}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setExportError(null)}
                  aria-label="Descartar el aviso de error de exportación"
                  className="-mr-1 -mt-1 rounded px-1.5 text-base leading-none opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </div>
            </div>
          )}
          {showPropiedadesRurales && propiedadesRuralesStatus.kind === 'error' && (
            <div role="alert" className="absolute bottom-20 left-1/2 z-[650] w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-xs text-red-800 shadow-lg dark:text-red-200">
              <strong>Capa de propiedades rurales temporalmente no disponible.</strong>{' '}
              No responde {propiedadesRuralesStatus.service || PROPIEDADES_RURALES_SERVICE_NAME}.
            </div>
          )}
          {showNdviVisual && ndviVisualStatus.kind === 'error' && (
            <div
              role="alert"
              className="absolute bottom-44 left-1/2 z-[650] w-[min(34rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-red-500/35 bg-[var(--background)]/95 px-3 py-2 text-xs leading-snug text-red-800 shadow-lg backdrop-blur dark:text-red-200"
            >
              <strong>Capa NDVI Visual temporalmente no disponible.</strong>{' '}
              No responde {NDVI_VISUAL_SERVICE_NAME}. El resto del SIG continúa
              funcionando normalmente.
            </div>
          )}

          {/* Geocoder mobile: barra flotante sobre el mapa, a la derecha del zoom */}
          <div className="absolute left-14 right-3 top-3 z-[600] md:hidden">
            <GeocoderSearch onSelect={handleGeocode} />
          </div>

          {/* Panel cluster at top-left, next to the zoom control (desktop).
              `right-3` bounds the row so `flex-wrap` can drop the chips to a
              second line when the 320 px layer dock squeezes the map area at
              the md breakpoint, instead of overflowing off-screen. */}
          <div className="absolute left-14 right-3 top-3 z-[600] hidden items-start gap-2 flex-wrap md:flex">
            <GeocoderSearch onSelect={handleGeocode} className="w-72" />

            <MapPanel
              id="search"
              activeId={activePanel}
              onActivate={togglePanel}
              icon={SearchIcon}
              label="Buscar"
              badge={activeSearch}
              widthClassName="w-72"
            >
              {searchFields}
            </MapPanel>

            <MapPanel
              id="filters"
              activeId={activePanel}
              onActivate={togglePanel}
              icon={FilterIcon}
              label="Filtros"
              badge={activeFilters}
              widthClassName="w-80"
            >
              {filterFields}
            </MapPanel>

            <MapPanel
              id="stats"
              activeId={activePanel}
              onActivate={togglePanel}
              icon={StatsIcon}
              label="Estadísticas"
              widthClassName="w-72"
            >
              <p className="mb-2 text-xs opacity-60">
                {loading ? 'Cargando…' : `${fmtInt(stats?.count ?? 0)} transacciones en la selección`}
              </p>
              {statsFields}
            </MapPanel>

            {/* Herramienta NDVI (chip escritorio): arma el modo cruceta; el
                móvil entra por «Herramientas de consulta» en el sidebar. */}
            <button
              type="button"
              onClick={() => {
                setActivePanel(null);
                setDrawerOpen(false);
                setNdviMode((m) => !m);
              }}
              aria-pressed={ndviMode}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium shadow-lg backdrop-blur transition-colors ${
                ndviMode
                  ? 'border-[hsl(153_28%_35%)]/70 bg-[var(--background)] text-[hsl(153_28%_25%)]'
                  : 'border-black/15 bg-[var(--background)]/95 hover:bg-[var(--background)] dark:border-white/20'
              }`}
            >
              {CrosshairIcon}
              {ndviMode ? 'Cancelar consulta' : 'Consulta NDVI'}
            </button>
          </div>

          {/* Serie NDVI: panel flotante arriba a la derecha. z-[700] = igual
              que los dropdowns; la pestaña de capas (850) y el drawer móvil
              (1100) siguen por sobre él y siguen siendo clicables. */}
          {ndviConsulta && (
            <div className="absolute right-3 top-24 z-[700] max-h-[calc(100vh-7rem)] w-[min(30rem,calc(100%-1.5rem))] overflow-y-auto md:top-14">
              <NdviPanel
                consulta={ndviConsulta}
                mostrarConaf={showVegetacional}
                onSerie={handleNdviSerie}
                onResaltado={handleNdviResaltado}
                onCerrar={cerrarNdvi}
              />
            </div>
          )}

          {/* Aviso del modo armado: visible en todas las pantallas, sobre el
              FAB móvil y la barra de escala, hasta que se arma el clic o Esc. */}
          {ndviMode && (
            <div
              role="status"
              className="absolute bottom-28 left-1/2 z-[650] -translate-x-1/2 rounded-full border border-black/15 bg-[var(--background)]/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur dark:border-white/20"
            >
              Haz clic en el punto a consultar · Esc para cancelar
            </div>
          )}

          {/* Selector de mapa base: esquina inferior izquierda, sobre la barra
              de escala de Leaflet — el lugar donde Google Maps y los visores SIG
              ponen este control. En mobile sube para no chocar con el FAB. */}
          <div className="absolute bottom-20 left-3 z-[600] md:bottom-9">
            <BasemapSwitcher value={basemap} onChange={handleBasemap} />
          </div>

          {/* Mobile FAB: opens the consolidated drawer. Any floating panel is
              closed first so two open layers never stack. */}
          <button
            type="button"
            onClick={() => {
              setActivePanel(null);
              setDrawerOpen(true);
            }}
            className="fixed bottom-4 left-1/2 z-[600] inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 bg-[var(--background)]/95 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur md:hidden dark:border-white/20"
          >
            {FilterIcon}
            Buscar y filtrar
            {activeFilters + activeSearch > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(153_28%_35%)] px-1 text-xs font-semibold text-white">
                {activeFilters + activeSearch}
              </span>
            )}
            <span className="tabular-nums opacity-60">
              · {loading ? '…' : fmtInt(stats?.count ?? 0)}
            </span>
          </button>
        </section>
      </div>
    </main>
    </>
  );
}
