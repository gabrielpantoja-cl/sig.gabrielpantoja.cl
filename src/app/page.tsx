'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Facets, GeocodeResult, MapPoint, Stats } from '@/lib/types';
import { kmlColorFor, kmlDisplayName, parseKmlFile, type KmlLayer } from '@/lib/kml';
import type { LayerMetadataEntry } from '@/lib/map-export';
import { SUELOS_SERVICE_NAME, type SuelosStatus } from '@/lib/suelos';
import { RetroLoader } from '@/components/RetroLoader';
import { LayersControl } from '@/components/LayersControl';
import { MapPanel, type PanelId } from '@/components/MapPanel';
import { SearchFields, FilterFields, StatsFields } from '@/components/FieldGroups';
import { GeocoderSearch } from '@/components/GeocoderSearch';
import { InfoPanel } from '@/components/InfoPanel';

// El RetroLoader de page.tsx cubre también la carga del módulo, así que el
// dynamic no necesita fallback propio (evita dos loaders superpuestos).
const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => null,
});

/**
 * Descarga /api/points reportando el avance real de bytes. El servidor expone
 * X-Total-Bytes (tamaño descomprimido) porque tras el gzip de la CDN el
 * Content-Length deja de corresponder a los bytes que entrega el reader. Si el
 * header faltara, cae a una curva asintótica sobre el tamaño típico (~18 MB).
 */
async function fetchPointsWithProgress(
  url: string,
  signal: AbortSignal,
  onProgress: (frac: number) => void,
): Promise<MapPoint[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) return res.json();

  const total = Number(res.headers.get('x-total-bytes')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total > 0 ? Math.min(received / total, 1) : received / (received + 6_000_000));
  }

  const buf = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf)) as MapPoint[];
}

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

/** Handle imperativo hacia MapView para disparar el export a PNG. La función
 *  es provista por el componente (tiene acceso al mapa y a los refs de las
 *  capas) y la página sólo la invoca y la bloquea mientras está corriendo.
 *  Acepta `{ metadata }` opcional: page.tsx construye el cajetín de
 *  trazabilidad legal en el momento del click (con los filtros vigentes) y
 *  se lo pasa para que MapView lo reenvíe a `exportMapToPng`. */
type MapExportArgs = { metadata?: LayerMetadataEntry[] };
type MapExportFn = (args?: MapExportArgs) => Promise<void>;

/** Símbolo que separa unidades monetarias en formato chileno. Las inputs de
 *  filtros vienen como strings; aquí las formateamos a CLP para el cajetín
 *  del PNG exportado (la idea es que el informe pericial vea un rango
 *  legible, no un número crudo de `?monto_min=10000000`). */
const fmtMoney = (raw: string): string | null => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);
};

const fmtIntPlain = (v: number): string => v.toLocaleString('es-CL');

/** Inputs para el cajetín de trazabilidad. Es una función pura (no tiene
 *  closures ni estado) para que sea trivial de testear si añadimos tests. */
type BuildMetadataInput = {
  showPoints: boolean;
  showProtected: boolean;
  showUrbanLimit: boolean;
  showComunas: boolean;
  showRedVial: boolean;
  showRedDrenaje: boolean;
  showSuelos: boolean;
  showCatastroFruticola: boolean;
  showVegetacional: boolean;
  comuna: string;
  anioFrom: number | null;
  montoMin: string;
  montoMax: string;
  supMin: string;
  supMax: string;
  predio: string;
  rol: string;
  stats: Stats | null;
  kmlLayers: KmlLayer[];
};

/** Construye las entradas del cajetín legal a partir del estado vigente de
 *  filtros y visibilidad de capas. Se llama al hacer click en «Exportar
 *  PNG» (no en cada keystroke), así que es OK que filtre un poco más de lo
 *  necesario: la captura es momentánea, el cajetín solo se usa en ese PNG.
 *
 *  Estructura del cajetín (cada entrada = un bloque con negrita + detalles):
 *  - Transacciones CBR (título con conteo de inscripciones en la selección)
 *  - Una entrada por cada capa vectorial activa con su fuente oficial
 *  - Una entrada por cada capa KML subida por el usuario */
function buildExportMetadata(input: BuildMetadataInput): LayerMetadataEntry[] {
  const entries: LayerMetadataEntry[] = [];

  if (input.showPoints) {
    const filtrosLineas: string[] = [];
    if (input.comuna !== 'todas') filtrosLineas.push(`Comuna: ${input.comuna}`);
    if (input.anioFrom != null) filtrosLineas.push(`Año desde: ${input.anioFrom}`);

    const minD = fmtMoney(input.montoMin);
    const maxD = fmtMoney(input.montoMax);
    if (minD || maxD) {
      // Construimos el rango con strings pre-formateados para no anidar
      // template literals con backticks sueltos (riesgo de desbalance de
      // delimitadores en TSX strict).
      const left = minD ? `≥ ${minD}` : 'sin mínimo';
      const right = maxD ? `≤ ${maxD}` : 'sin máximo';
      filtrosLineas.push(`Monto: ${left} – ${right}`);
    }
    if (input.supMin) {
      const n = Number(input.supMin);
      if (Number.isFinite(n)) {
        filtrosLineas.push(`Superficie terreno ≥ ${n.toLocaleString('es-CL')} m²`);
      }
    }
    if (input.supMax) {
      const n = Number(input.supMax);
      if (Number.isFinite(n)) {
        filtrosLineas.push(`Superficie terreno ≤ ${n.toLocaleString('es-CL')} m²`);
      }
    }
    if (input.predio.trim()) filtrosLineas.push(`Predio contiene: «${input.predio.trim()}»`);
    if (input.rol.trim()) filtrosLineas.push(`ROL SII contiene: «${input.rol.trim()}»`);

    const count = input.stats?.count ?? 0;
    const details = [
      `${fmtIntPlain(count)} inscripciones en la selección`,
      ...filtrosLineas,
      'Fuente: Servicio de Conservadores de Bienes Raíces (Ley 20.285)',
    ].join('\n');
    entries.push({
      title: 'Transacciones CBR',
      details,
      color: '#e11d48', // carmesí — color de marca CBR (lib/cbr-points)
      shape: 'dot',
    });
  }

  // Capas temáticas activas: cada una aporta su fuente oficial + el color
  // y la forma que se ven en el mapa, para que la muestra del cajetín se
  // corresponda 1:1 con el polígono/línea/marker del mapa en vivo.
  if (input.showProtected) {
    entries.push({
      title: 'Áreas protegidas (RNAP)',
      details: 'Designaciones legales según categoría\nFuente: Ministerio del Medio Ambiente · CC0\nhttps://sig.mma.gob.cl/rnap/',
      color: '#10b981', // verde bosque, dominante de las categorías RNAP
      shape: 'square',
    });
  }
  if (input.showUrbanLimit) {
    entries.push({
      title: 'Límite urbano (PRC)',
      details: 'Planes Reguladores Comunales vigentes\nFuente: MINVU · IPT · geoide.minvu.cl',
      color: '#c2410c', // ámbar (URBAN_LIMIT_COLOR)
      shape: 'square',
    });
  }
  if (input.showComunas) {
    entries.push({
      title: 'Límites comunales (DPA 2023)',
      details: 'División Político-Administrativa referencial\nFuente: SUBDERE · geoportal.cl',
      color: '#475569', // pizarra (COMUNAS_COLOR)
      shape: 'square',
    });
  }
  if (input.showRedVial) {
    entries.push({
      title: 'Red caminera (MOP)',
      details: 'Red Vial Nacional + ROL de Vialidad (puede diferir de Google/OSM)\nFuente: Dirección de Vialidad · mapasvialidad.mop.gob.cl',
      color: '#7c3aed', // violeta (clase 'nacional' de ROAD_CLASS_GROUPS)
      shape: 'line',
    });
  }
  if (input.showRedDrenaje) {
    entries.push({
      title: 'Red de drenaje (DGA)',
      details: 'Ríos + esteros del Banco Nacional de Aguas\nFuente: DGA · MOP · CC-BY 4.0',
      color: '#0ea5e9', // cian (paleta drenaje)
      shape: 'line',
    });
  }
  if (input.showSuelos) {
    entries.push({
      title: 'Suelos agrológicos (CIREN)',
      details: 'Capacidad de uso I–VIII, 12 regiones (Atacama a Aysén)\nFuente: CIREN · esri.ciren.cl',
      color: '#ca8a04', // amarillo tierra (SUELOS_CLASSES aprox.)
      shape: 'square',
    });
  }
  if (input.showCatastroFruticola) {
    entries.push({
      title: 'Catastro frutícola (CIREN-ODEPA)',
      details: 'Productores frutícolas por especie; levantamientos regionales CIREN 2019–2025 (el año es la fecha del catastro, no de plantación)\nFuente: CIREN-ODEPA · IDE Minagri',
      color: '#be185d', // magenta (especie por defecto)
      shape: 'square',
    });
  }
  if (input.showVegetacional) {
    entries.push({
      title: 'Recursos vegetacionales (CONAF)',
      details: 'Uso, subuso, estructura, cobertura y especies dominantes; actualización regional variable\nFuente: CONAF · IDE Minagri',
      color: '#15803d',
      shape: 'square',
    });
  }

  // Capas KML del operador: usamos el alias del perito (`kmlDisplayName`),
  // que es lo que aparece ya en el popup del feature tras renombrarlo.
  // El color es el de la paleta asignada por `kmlColorFor` al subir la capa,
  // único por KML para que se distingan entre sí dentro de un mismo mapa.
  for (const kml of input.kmlLayers) {
    if (!kml.visible) continue;
    entries.push({
      title: `KML: ${kmlDisplayName(kml)}`,
      details: `${kml.featureCount} entidades vectoriales\nFuente: archivo local del operador (no publicado)`,
      color: kml.color,
      shape: 'square',
    });
  }

  return entries;
}

export default function Home() {
  const [facets, setFacets] = useState<Facets | null>(null);

  const [comuna, setComuna] = useState('todas');
  const [anioFrom, setAnioFrom] = useState<number | null>(null);
  const [montoMin, setMontoMin] = useState('');
  const [montoMax, setMontoMax] = useState('');
  const [supMin, setSupMin] = useState('');
  const [supMax, setSupMax] = useState('');
  const [predio, setPredio] = useState('');
  const [rol, setRol] = useState('');

  const [points, setPoints] = useState<MapPoint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  // loading/error se DERIVAN comparando el query pedido con el resuelto/fallido
  // (nada de setState sincrónico dentro del efecto de fetch): si lo cargado no
  // corresponde al filtro actual, estamos cargando.
  const [loadedQs, setLoadedQs] = useState<string | null>(null);
  const [errorQs, setErrorQs] = useState<string | null>(null);

  // Resultado del geocoder: MapView vuela ahí y deja un marcador pulsante.
  const [focus, setFocus] = useState<GeocodeResult | null>(null);

  // Arranque con progreso real, en dos fases: descarga del dataset (5–60%) y
  // render de los marcadores en el mapa (64–99%). `bootDone` recién se activa
  // cuando MapView confirma que los clusters están pintados, de modo que el
  // 100% de la barra coincide con el mapa visible (sin pantallazo en blanco).
  const [bootProgress, setBootProgress] = useState(3);
  const [bootDone, setBootDone] = useState(false);
  const booting = useRef(true);

  const handleRenderProgress = useCallback((processed: number, total: number) => {
    if (!booting.current || total === 0) return;
    setBootProgress(64 + Math.round((processed / total) * 35));
  }, []);

  const handleRenderComplete = useCallback(() => {
    if (!booting.current) return;
    booting.current = false;
    setBootProgress(100);
    setBootDone(true);
  }, []);

  // Desktop: paneles flotantes sobre el mapa, solo uno abierto a la vez.
  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const togglePanel = (id: PanelId) => setActivePanel((p) => (p === id ? null : id));

  // Mobile: drawer consolidado (búsqueda + filtros + estadísticas), cerrado
  // por defecto para que el mapa sea dueño de la pantalla.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Las transacciones CBR son la capa principal y vienen activadas por defecto,
  // pero el perito las puede ocultar para componer una vista limpia (por ej.
  // al exportar el mapa como anexo PNG de un informe de tasación).
  const [showPoints, setShowPoints] = useState(true);
  const [showProtected, setShowProtected] = useState(false);
  const [showUrbanLimit, setShowUrbanLimit] = useState(false);
  const [showComunas, setShowComunas] = useState(false);
  const [showRedVial, setShowRedVial] = useState(false);
  const [showRedDrenaje, setShowRedDrenaje] = useState(false);
  const [showSuelos, setShowSuelos] = useState(false);
  const [suelosStatus, setSuelosStatus] = useState<SuelosStatus>({ kind: 'idle' });
  const [showCatastroFruticola, setShowCatastroFruticola] = useState(false);
  const [showVegetacional, setShowVegetacional] = useState(false);

  // Capas KML subidas por el usuario: parseo 100% en el navegador (lib/kml),
  // el archivo nunca sale del dispositivo. El contador de colores es un ref
  // para que borrar una capa no re-pinte las que quedan.
  const [kmlLayers, setKmlLayers] = useState<KmlLayer[]>([]);
  const [kmlError, setKmlError] = useState<string | null>(null);
  const kmlColorCount = useRef(0);

  const addKmlFiles = async (files: FileList) => {
    setKmlError(null);
    const errors: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const layer = await parseKmlFile(file, kmlColorFor(kmlColorCount.current++));
        setKmlLayers((prev) => [...prev, layer]);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : `No se pudo leer «${file.name}».`);
      }
    }
    if (errors.length) setKmlError(errors.join(' '));
  };

  const toggleKml = (id: string) =>
    setKmlLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );

  const removeKml = (id: string) => setKmlLayers((prev) => prev.filter((l) => l.id !== id));

  /** Renombra el alias del perito para una capa KML. Acepta string vacío
   *  (el cajetín cae al `name` del archivo cuando `displayName` está vacío).
   *  No toca `geojson` ni el color — solo la etiqueta humana. */
  const renameKml = (id: string, displayName: string) =>
    setKmlLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, displayName } : l)),
    );

  // Imperative handle para el export PNG: MapView publica la función que
  // rasteriza la vista actual; aquí se la invoca y se bloquea el botón mientras
  // dura la generación del archivo (canvas.toBlob puede tardar >1s con 74k
  // pines re-proyectados). El cajetín de trazabilidad legal (filtros vigentes
  // + fuentes de capas activas) se construye acá, en el momento del click, y
  // se entrega por args para no inflar el deps array del useEffect en MapView.
  const mapExportRef = useRef<MapExportFn | null>(null);
  const [exporting, setExporting] = useState(false);
  const handleExportClick = useCallback(async () => {
    if (exporting || !mapExportRef.current) return;
    setExporting(true);
    try {
      const metadata = buildExportMetadata({
        showPoints,
        showProtected,
        showUrbanLimit,
        showComunas,
        showRedVial,
        showRedDrenaje,
        showSuelos,
        showCatastroFruticola,
        showVegetacional,
        comuna,
        anioFrom,
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
    } finally {
      setExporting(false);
    }
  }, [
    exporting,
    showPoints, showProtected, showUrbanLimit, showComunas, showRedVial,
    showRedDrenaje, showSuelos, showCatastroFruticola, showVegetacional,
    comuna, anioFrom, montoMin, montoMax, supMin, supMax, predio, rol,
    stats, kmlLayers,
  ]);

  // Load facets once.
  useEffect(() => {
    fetch('/api/facets')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((f: Facets) => setFacets(f))
      .catch(() => {});
  }, []);

  const effectiveAnioFrom = anioFrom ?? facets?.minAnio ?? 2015;

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (comuna !== 'todas') p.set('comuna', comuna);
    if (anioFrom != null) p.set('anio_min', String(anioFrom));
    if (montoMin) p.set('monto_min', montoMin);
    if (montoMax) p.set('monto_max', montoMax);
    if (supMin) p.set('sup_min', supMin);
    if (supMax) p.set('sup_max', supMax);
    if (predio.trim()) p.set('predio', predio.trim());
    if (rol.trim()) p.set('rol', rol.trim());
    return p.toString();
  }, [comuna, anioFrom, montoMin, montoMax, supMin, supMax, predio, rol]);

  const activeFilters = [
    comuna !== 'todas',
    anioFrom != null,
    montoMin,
    montoMax,
    supMin,
    supMax,
  ].filter(Boolean).length;

  const activeSearch = [predio.trim(), rol.trim()].filter(Boolean).length;

  const debouncedQs = useDebounced(queryString, 400);
  const error = errorQs != null && errorQs === debouncedQs;
  const loading = !error && loadedQs !== debouncedQs;

  // Fetch points + stats whenever the (debounced) filters change.
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    const ctrl = new AbortController();

    const suffix = debouncedQs ? `?${debouncedQs}` : '';
    Promise.all([
      fetchPointsWithProgress(`/api/points${suffix}`, ctrl.signal, (frac) => {
        if (booting.current) setBootProgress(5 + Math.round(frac * 55));
      }),
      fetch(`/api/stats${suffix}`, { signal: ctrl.signal }).then((r) =>
        r.ok ? r.json() : Promise.reject(),
      ),
    ])
      .then(([pts, st]: [MapPoint[], Stats]) => {
        if (id !== reqId.current) return;
        if (booting.current) setBootProgress(64); // dataset decodificado; falta el render
        setPoints(Array.isArray(pts) ? pts : []);
        setStats(st);
        setLoadedQs(debouncedQs);
      })
      .catch(() => {
        if (ctrl.signal.aborted || id !== reqId.current) return;
        setErrorQs(debouncedQs);
        // Cierra el loader para que el mensaje de error quede visible.
        booting.current = false;
        setBootDone(true);
      });

    return () => ctrl.abort();
  }, [debouncedQs]);

  const exportHref = (format: 'csv' | 'geojson') =>
    `/api/export?${debouncedQs ? `${debouncedQs}&` : ''}format=${format}`;

  const searchFields = (
    <SearchFields predio={predio} setPredio={setPredio} rol={rol} setRol={setRol} />
  );

  const filterFields = (
    <FilterFields
      comuna={comuna}
      setComuna={setComuna}
      facets={facets}
      setAnioFrom={setAnioFrom}
      effectiveAnioFrom={effectiveAnioFrom}
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

  return (
    <main className="flex flex-1 flex-col">
      {/* Header — una sola fila delgada para que el mapa domine la pantalla */}
      <header className="flex items-center justify-between border-b border-black/10 px-4 py-2.5 md:px-6 md:py-3 dark:border-white/10">
        <h1 className="text-[0.65rem] uppercase tracking-[0.18em] opacity-60 md:text-xs">
          SIG de suelo · Datos abiertos
        </h1>
        <InfoPanel />
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

      {/* Mapa a pantalla completa con paneles flotantes */}
      <section className="relative min-h-[70vh] flex-1 md:min-h-0">
        {error && (
          <div className="absolute inset-0 z-[500] flex items-center justify-center text-sm text-red-600">
            No se pudieron cargar los datos del mapa.
          </div>
        )}
        <div className="absolute inset-0">
          <MapView
            points={points}
            showPoints={showPoints}
            showProtected={showProtected}
            showUrbanLimit={showUrbanLimit}
            showComunas={showComunas}
            showRedVial={showRedVial}
            showRedDrenaje={showRedDrenaje}
            showSuelos={showSuelos}
            onSuelosStatus={setSuelosStatus}
            showCatastroFruticola={showCatastroFruticola}
            showVegetacional={showVegetacional}
            kmlLayers={kmlLayers}
            focus={focus}
            onRenderProgress={handleRenderProgress}
            onRenderComplete={handleRenderComplete}
            mapExportRef={mapExportRef}
          />
        </div>
        {/* Se desmonta solo (gone) tras llegar al 100% y hacer fade-out. */}
        <RetroLoader progress={bootProgress} done={bootDone} />

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

        {/* Geocoder mobile: barra flotante sobre el mapa, a la derecha del zoom */}
        <div className="absolute left-14 right-3 top-3 z-[600] md:hidden">
          <GeocoderSearch onSelect={setFocus} />
        </div>

        {/* Clúster de paneles arriba a la izquierda, junto al control de zoom (desktop) */}
        <div className="absolute left-14 top-3 z-[600] hidden items-start gap-2 md:flex">
          <GeocoderSearch onSelect={setFocus} className="w-72" />

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
        </div>

        {/* Panel de capas a la derecha: en mobile baja una fila para no chocar
            con la barra del geocoder */}
        <div className="absolute right-3 top-[3.75rem] z-[600] w-60 max-w-[calc(100%-1.5rem)] md:top-3">
          <LayersControl
            activeId={activePanel}
            onActivate={togglePanel}
            showPoints={showPoints}
            onTogglePoints={setShowPoints}
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
            showSuelos={showSuelos}
            onToggleSuelos={setShowSuelos}
            suelosStatus={suelosStatus}
            showCatastroFruticola={showCatastroFruticola}
            onToggleCatastroFruticola={setShowCatastroFruticola}
            showVegetacional={showVegetacional}
            onToggleVegetacional={setShowVegetacional}
            kmlLayers={kmlLayers}
            kmlError={kmlError}
            onAddKmlFiles={addKmlFiles}
            onToggleKml={toggleKml}
            onRemoveKml={removeKml}
            onRenameKml={renameKml}
            onExport={handleExportClick}
            exporting={exporting}
          />
        </div>

        {/* FAB mobile: abre el drawer consolidado */}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
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
    </main>
  );
}
