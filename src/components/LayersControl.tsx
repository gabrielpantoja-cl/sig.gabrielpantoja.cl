'use client';

import { createContext, useContext, useEffect, useDeferredValue, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_LAYER_OPACITY, type LayerOpacity } from '@/lib/layer-opacity';
import { CATEGORY_COLORS } from '@/lib/protected-areas';
import { URBAN_LIMIT_COLOR } from '@/lib/urban-limit';
import { COMUNAS_ATTRIBUTION, COMUNAS_COLOR, COMUNAS_SOURCE_URL } from '@/lib/comunas';
import {
  RED_VIAL_ATTRIBUTION,
  RED_VIAL_COLOR,
  RED_VIAL_SOURCE_URL,
  ROAD_CLASS_GROUPS,
} from '@/lib/red-vial';
import {
  DRENAJE_TYPE_GROUPS,
  RED_DRENAJE_ATTRIBUTION,
  RED_DRENAJE_SOURCE_URL,
} from '@/lib/red-drenaje';
import {
  LINEAS_TRANSMISION_ATTRIBUTION,
  LINEAS_TRANSMISION_COLOR,
  LINEAS_TRANSMISION_DISCLAIMER,
  LINEAS_TRANSMISION_SOURCE_URL,
  TENSION_GROUPS,
} from '@/lib/lineas-transmision';
import {
  SUELOS_ATTRIBUTION,
  SUELOS_CLASSES,
  SUELOS_SOURCE_URL,
  type SuelosStatus,
} from '@/lib/suelos';
import {
  CATASTRO_FRUTICOLA_ATTRIBUTION,
  CATASTRO_FRUTICOLA_LEGEND,
  CATASTRO_FRUTICOLA_SOURCE_URL,
} from '@/lib/catastro-fruticola';
import { CBR_POINT_COLOR } from '@/lib/cbr-points';
import {
  DESTINO_OPTIONS,
  HEXBINS_ATTRIBUTION,
  HEXBINS_DISCLAIMER,
  HEXBIN_RAMPS,
  destinoLabel,
  hexEdgeLabel,
  type HexbinStatus,
} from '@/lib/hexbins';
import { rampPosition } from '@/lib/heat-surface';
import {
  VEGETACIONAL_ATTRIBUTION,
  VEGETACIONAL_COLOR,
  VEGETACIONAL_MIN_ZOOM,
  VEGETACIONAL_REGIONS,
  VEGETACIONAL_SOURCE_URL,
} from '@/lib/vegetacional';
import {
  NDVI_VISUAL_ATTRIBUTION,
  NDVI_VISUAL_DESCARGO,
  NDVI_VISUAL_MIN_ZOOM,
  NDVI_VISUAL_SERVICE_NAME,
  NDVI_VISUAL_SOURCE_URL,
  ndviRampCssGradient,
  ndviRampTicks,
  type NdviVisualEstado,
} from '@/lib/ndvi-visual';
import { KML_MAX_FILE_MB, kmlDisplayName, type KmlLayer } from '@/lib/kml';
import { PROPIEDADES_RURALES_ATTRIBUTION, PROPIEDADES_RURALES_COLOR, PROPIEDADES_RURALES_DISCLAIMER, PROPIEDADES_RURALES_MIN_ZOOM, PROPIEDADES_RURALES_REGIONS, PROPIEDADES_RURALES_SOURCE_URL, type PropiedadesRuralesStatus } from '@/lib/propiedades-rurales';
import {
  BIOCLIMA_SOURCE_URL,
  bioclimaAttribution,
  bioclimaRamp,
  type BioclimaVariable,
} from '@/lib/bioclima';
import { type PanelId } from '@/components/MapPanel';
import { LayerSidebar, type LayerSidebarView } from '@/components/LayerSidebar';
import {
  LAYER_CATALOG,
  countLayerMatches,
  groupMatches,
  layerMatches,
  normalizeLayerQuery,
  type CatalogLayerId,
  type LayerGroupId,
} from '@/lib/layer-catalog';

// Rendering mode of a layer list. `query` is the (deferred) search text rows
// filter themselves against; `grouped` tells <LayerGroupHeader> whether to
// draw category headers. The "Capas activas" column is a flat list of checked
// layers — it draws no headers and filters nothing, so its badge and its
// "Restablecer" action keep describing the real map, never a filtered view.
const LayerListContext = createContext<{ query: string; grouped: boolean }>({
  query: '',
  grouped: false,
});

/**
 * Category header inside the catalogue. It hides itself when no member of its
 * group matches the search — the rows below already filter individually with
 * the SAME predicate, so a query never leaves a heading over an empty list. In
 * the active-legends column it draws nothing: that column is a flat report of
 * what is on the map (headerless, unfiltered) exactly as it was before.
 *
 * A bare heading rather than a wrapping <section> keeps the diff surgical: no
 * row moves, and `LayerRow` keeps owning its own visibility.
 */
function LayerGroupHeader({ id }: { id: LayerGroupId }) {
  const { query, grouped } = useContext(LayerListContext);
  if (!grouped) return null;
  if (!groupMatches(id, query)) return null;
  const group = LAYER_CATALOG.find((entry) => entry.id === id);
  if (!group) return null;
  return (
    <h3 className="mt-3 border-b border-black/10 pb-1 pt-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50 first:mt-0 dark:border-white/10">
      {group.title}
    </h3>
  );
}

// Dos presentaciones de un único catálogo: selector y leyendas activas.
// Las escalas, fuentes y controles se definen una sola vez, más abajo.
const ActiveLegendContext = createContext(false);

function OpacityControl({ value, onChange, fillOnly = false }: {
  value: number;
  onChange: (value: number) => void;
  fillOnly?: boolean;
}) {
  return (
    <label className="mb-2 block text-xs">
      <span className="flex justify-between gap-2">
        <span>Opacidad{fillOnly ? ' del relleno' : ''}</span>
        <span className="tabular-nums">{Math.round(value * 100)} %</span>
      </span>
      <input type="range" min="0" max="1" step="0.01" value={value}
        aria-valuetext={`${Math.round(value * 100)} %`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 w-full cursor-pointer accent-[hsl(153_28%_35%)] focus-visible:outline-2" />
    </label>
  );
}

/**
 * Fila de capa estilo Google Earth Pro: triángulo de despliegue (▸/▾) +
 * checkbox + swatch + nombre. El triángulo abre los DETALLES de la capa
 * (fuente y atribución) de forma independiente del checkbox. Al activar una
 * capa, su contenido se presenta en la leyenda flotante, sin duplicar escalas.
 */
function LayerRow({
  checked,
  onChange,
  readOnly = false,
  swatch,
  label,
  layerId,
  children,
  controls,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  readOnly?: boolean;
  swatch: ReactNode;
  label: string;
  /** Id of this layer in the search manifest (`layer-catalog.ts`). Required,
   *  so renaming or adding a layer without indexing it fails to compile. */
  layerId: CatalogLayerId;
  children?: ReactNode;
  controls?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const activeLegend = useContext(ActiveLegendContext);
  const { query } = useContext(LayerListContext);

  if (activeLegend) {
    if (!checked || !children) return null;
    return (
      <section className="border-b border-black/10 pb-3 dark:border-white/15" aria-label={label}>
        <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">{swatch}{label}</h3>
        {controls}
        {children}
      </section>
    );
  }

  // Filter AFTER the active-legends branch above: that column is a report of
  // what is on the map and never hides a row. Same predicate as
  // `countLayerMatches`, so the empty state cannot disagree with these rows.
  if (!layerMatches(layerId, query)) return null;

  return (
    <div>
      <div className="flex items-center gap-1">
        {children ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`${open ? 'Ocultar' : 'Mostrar'} detalles de ${label}`}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-50 hover:opacity-100"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 10 10"
              fill="currentColor"
              aria-hidden="true"
              className={`transition-transform ${open ? 'rotate-90' : ''}`}
            >
              <path d="M2.5 1l5 4-5 4z" />
            </svg>
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}

        <label
          className={`flex flex-1 items-center gap-2 ${readOnly ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
        >
          <input
            type="checkbox"
            checked={checked}
            readOnly={readOnly}
            onChange={readOnly ? undefined : (e) => onChange?.(e.target.checked)}
            className="accent-[hsl(153_28%_35%)]"
          />
          <span className="inline-flex items-center gap-1.5">
            {swatch}
            {label}
          </span>
        </label>
      </div>

      {open && children && (
        <div className="ml-5 mt-1.5 border-l border-black/10 pb-1 pl-2.5 dark:border-white/10">
          {checked ? <p className="text-xs opacity-70">Escala y controles en «Capas activas».</p> : children}
        </div>
      )}
    </div>
  );
}

function SuelosStatusNotice({ status }: { status: SuelosStatus }) {
  const activeLegend = useContext(ActiveLegendContext);
  if (!activeLegend) return null;
  if (status.kind === 'idle') return null;

  const content = (() => {
    switch (status.kind) {
      case 'zoom-required':
        return {
          tone: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
          icon: '↗',
          text: `Acerca el mapa hasta zoom ${status.minZoom} o superior para solicitar la cobertura.`,
        };
      case 'loading':
        return {
          tone: 'border-amber-500/25 bg-amber-500/10 text-amber-900 dark:text-amber-100',
          icon: '◌',
          text: 'Consultando la cobertura oficial de CIREN…',
        };
      case 'ready':
        return {
          tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
          icon: '✓',
          text: 'Servicio CIREN operativo en esta vista.',
        };
      case 'error':
        return {
          tone: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
          icon: '!',
          text: `Servicio sin respuesta: ${status.service} (operación ${status.operation}). Se reintentará al mover el mapa o al reactivar la capa.`,
        };
    }
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`ml-5 mt-1.5 rounded-md border px-2 py-1.5 text-[0.65rem] leading-snug ${content.tone}`}
    >
      <span className="mr-1 font-bold" aria-hidden="true">{content.icon}</span>
      {content.text}
    </div>
  );
}

function NdviVisualStatusNotice({ status }: { status: NdviVisualEstado }) {
  const activeLegend = useContext(ActiveLegendContext);
  if (!activeLegend) return null;
  if (status.kind === 'idle') return null;

  const content = (() => {
    switch (status.kind) {
      case 'zoom-required':
        return {
          tone: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
          icon: '↗',
          text: `Acerca el mapa hasta zoom ${status.minZoom} o superior para solicitar el raster NDVI.`,
        };
      case 'loading':
        return {
          tone: 'border-amber-500/25 bg-sky-500/10 text-amber-900 dark:text-amber-100',
          icon: '◌',
          text: 'Componiendo el NDVI de la vista con las escenas Sentinel-2 más despejadas…',
        };
      case 'ready':
        return status.fecha
          ? {
              tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
              icon: '✓',
              text: `Raster Sentinel-2 del ${status.fecha.split('-').reverse().join('-')} operativo en esta vista.`,
            }
          : {
              tone: 'border-sky-500/25 bg-sky-500/10 text-sky-800 dark:text-sky-200',
              icon: '○',
              text: 'Sin escenas despejadas en esta vista: el raster queda transparente y se ve el mapa base.',
            };
      case 'error':
        return {
          tone: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
          icon: '!',
          text: `Servicio sin respuesta: ${NDVI_VISUAL_SERVICE_NAME}. Se reintentará al mover el mapa o al reactivar la capa.`,
        };
    }
  })();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`ml-5 mt-1.5 rounded-md border px-2 py-1.5 text-[0.65rem] leading-snug ${content.tone}`}
    >
      <span className="mr-1 font-bold" aria-hidden="true">{content.icon}</span>
      {content.text}
    </div>
  );
}

/**
 * Layer panel of the map. Toggling layers is kept apart from the download
 * buttons (CSV/GeoJSON), which live in the filters panel. Every thematic layer
 * carries its own legend and attribution behind a disclosure triangle
 * (`LayerRow`), collapsed by default. The CBR transaction layer — the primary
 * one — ships enabled but can still be switched off: the appraiser hides it to
 * compose a clean view, for instance before exporting the map as a PNG with a
 * north arrow to attach to an appraisal report. It also holds the «Mis capas»
 * section, where the user uploads `.kml` files processed locally (see
 * lib/kml.ts) and lists them with visibility, delete, inline rename and a
 * colour swatch per layer, plus the PNG export button.
 *
 * Presentation lives in `LayerSidebar` (320 px dock on desktop, bottom drawer
 * on mobile, search field and tabs). This component owns every piece of layer
 * STATE — toggles, opacity, hexbin settings, KML, the search query — and only
 * renders it. Open/closed is still decided by `page.tsx` through
 * `activeId === 'layers'`, so only one panel (search/filters/stats/layers) is
 * ever open at a time.
 */

/**
 * Alias editable inline para una capa KML. El perito la sube con el nombre
 * del archivo («Res-305-Lts-81-100.kml»), hace clic sobre el texto y la
 * renombra a algo peritajísticamente útil («Sector de Tasación»). El cambio
 * se propaga al cajetín del PNG exportado y al popup del feature, no toca
 * el `name` original.
 *
 * Modelo de interacción: clic en el span → abre `<input>` con foco + selección
 * total. Enter confirma, blur confirma, Escape cancela. El input acepta
 * también limpiar el texto: en ese caso el cajetín vuelve a mostrar el
 * `name` original (debido al fallback `displayName || name`).
 */
function InlineEditableKmlName({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Al entrar en modo edición, sincronizamos el draft con el value vigente.
  // Si el perito está editando y un cambio externo actualiza `value`, NO
  // pisamos su tecleo: el draft queda congelado hasta confirmar/cancelar.
  // Esto evita el patrón "setState en useEffect" que eslint marca como
  // re-render en cascada — el sync ocurre solo en el evento del usuario.
  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  // Tras montar el <input>, seleccionamos todo el texto para que la tecla
  // siguiente lo reemplace sin tener que borrar primero. Solo aplica a la
  // transición entering edit (deps: editing), no se re-dispara si value cambia.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onSave(trimmed); // vacío → "" y display cae a name.
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        maxLength={120}
        className="min-w-0 flex-1 rounded border border-black/30 bg-white px-1 text-xs outline-none focus:border-[hsl(153_28%_35%)] dark:border-white/40 dark:bg-black/40"
        aria-label="Renombrar capa"
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={startEdit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEdit();
        }
      }}
      className="min-w-0 flex-1 cursor-text truncate rounded px-1 -mx-1 outline-none hover:bg-black/5 focus:bg-black/5 dark:hover:bg-white/10 dark:focus:bg-white/10"
      title="Clic para renombrar"
    >
      {value}
    </span>
  );
}
/**
 * $/m² en notación compacta para la leyenda del mapa de calor. Los cortes de
 * cuantiles llegan con decimales ($348.997,42) y en una tira de seis clases no
 * cabe el número completo; el valor exacto queda en el `title`.
 */
function fmtPpm2Compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

/**
 * Leyenda del mapa de calor de valor.
 *
 * Declara explícitamente sobre qué se calculó lo que se está viendo —
 * resolución, destino, umbral y cobertura — porque el color de una celda no
 * significa nada sin esos cuatro datos: la misma comuna se ve distinta con
 * `N_min = 3` que con `N_min = 5`, y radicalmente distinta entre destinos
 * (261× entre habitacional y agrícola). Ver `docs/plan-mapa-de-calor.md` §2.
 */
function HexbinLegend({ status }: { status: HexbinStatus }) {
  if (status.kind === 'idle') return null;
  if (status.kind === 'loading') {
    return <p className="text-[0.6rem] opacity-50">Agregando transacciones del viewport…</p>;
  }
  if (status.kind === 'error') {
    return (
      <p className="text-[0.6rem] leading-snug text-red-700 dark:text-red-300">
        No se pudo calcular la agregación para esta vista.
      </p>
    );
  }
  if (status.kind === 'empty') {
    return (
      <p className="text-[0.6rem] leading-snug opacity-60">
        Ninguna celda de {hexEdgeLabel(status.meta.edge_m)} alcanza {status.meta.min_n}{' '}
        transacciones de destino {destinoLabel(status.meta.destino)} en esta vista. Aleja el zoom o
        baja el umbral.
      </p>
    );
  }

  const colors = HEXBIN_RAMPS[status.ramp];
  const { meta, breaks, scale } = status;
  // La barra es un degradado continuo, igual que el raster. Cada marca se
  // sitúa en la posición que `rampPosition` le da a ese valor — la MISMA
  // función que colorea el mapa — así el color bajo la etiqueta es
  // exactamente el que tiene ese valor en pantalla, sin depender de cómo esté
  // ponderada la escala por dentro.
  // Con cinco cortes las etiquetas se pisan en un panel de 224 px; se muestra
  // una de cada dos.
  const labelled = breaks.length > 3 ? breaks.filter((_, i) => i % 2 === 0) : breaks;
  const marks = labelled.map((value) => ({
    value,
    left: `${(rampPosition(value, scale) * 100).toFixed(1)}%`,
  }));
  return (
    <div className="space-y-1.5">
      <div
        className="h-3 rounded-sm"
        style={{ background: `linear-gradient(90deg, ${colors.join(', ')})` }}
      />
      <div className="relative h-3 text-[0.55rem] tabular-nums opacity-70">
        {marks.map((mark) => (
          <span
            key={mark.value}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: mark.left }}
            title={`${Math.round(mark.value).toLocaleString('es-CL')} $/m²`}
          >
            {fmtPpm2Compact(mark.value)}
          </span>
        ))}
      </div>
      {/* El sentido de la rampa cambia con el tema (claro→oscuro sobre fondo
          claro, oscuro→claro sobre fondo oscuro), así que hay que rotularlo. */}
      <div className="flex justify-between text-[0.55rem] uppercase tracking-wide opacity-45">
        <span>menor $/m²</span>
        <span>mayor $/m²</span>
      </div>
      <p className="text-[0.6rem] leading-snug opacity-60">
        Superficie interpolada desde las medianas de $/m² de terreno de celdas de{' '}
        {hexEdgeLabel(meta.edge_m)}. Los cortes de color son cuantiles recalculados sobre
        lo visible. La opacidad indica cobertura de dato: donde no hay transacciones
        cerca, la superficie se desvanece en vez de estimar.
      </p>
      <p className="text-[0.6rem] leading-snug opacity-60">
        {meta.cells.toLocaleString('es-CL')} celdas de muestreo ·{' '}
        {meta.points.toLocaleString('es-CL')} transacciones agregadas · mínimo {meta.min_n} por
        celda · destino {destinoLabel(meta.destino)}. Clic en el mapa para ver la celda más cercana.
      </p>
    </div>
  );
}

export function LayersControl({
  layerOpacity,
  onLayerOpacity,
  activeId,
  onActivate,
  showPoints,
  onTogglePoints,
  showHexbins,
  onToggleHexbins,
  hexbinStatus,
  hexbinDestino,
  onHexbinDestino,
  hexbinMinN,
  onHexbinMinN,
  showProtected,
  onToggleProtected,
  showUrbanLimit,
  onToggleUrbanLimit,
  showComunas,
  onToggleComunas,
  showRedVial,
  onToggleRedVial,
  showRedDrenaje,
  onToggleRedDrenaje,
  showLineasTransmision,
  onToggleLineasTransmision,
  showSuelos,
  onToggleSuelos,
  suelosStatus,
  showBioclima,
  onToggleBioclima,
  bioclimaVariable,
  onBioclimaVariable,
  showCatastroFruticola,
  onToggleCatastroFruticola,
  showVegetacional,
  onToggleVegetacional,
  showPropiedadesRurales,
  onTogglePropiedadesRurales,
  propiedadesRuralesStatus,
  showNdviVisual,
  onToggleNdviVisual,
  ndviVisualStatus,
  kmlLayers,
  kmlError,
  onAddKmlFiles,
  onToggleKml,
  onRemoveKml,
  onRenameKml,
  onExport,
  exporting,
  ndviMode,
  onToggleNdviMode,
}: {
  layerOpacity: LayerOpacity;
  onLayerOpacity: (key: keyof LayerOpacity, value: number) => void;
  activeId: PanelId | null;
  onActivate: (id: PanelId) => void;
  showPoints: boolean;
  onTogglePoints: (v: boolean) => void;
  showHexbins: boolean;
  onToggleHexbins: (v: boolean) => void;
  hexbinStatus: HexbinStatus;
  hexbinDestino: string;
  onHexbinDestino: (code: string) => void;
  hexbinMinN: number;
  onHexbinMinN: (n: number) => void;
  showProtected: boolean;
  onToggleProtected: (v: boolean) => void;
  showUrbanLimit: boolean;
  onToggleUrbanLimit: (v: boolean) => void;
  showComunas: boolean;
  onToggleComunas: (v: boolean) => void;
  showRedVial: boolean;
  onToggleRedVial: (v: boolean) => void;
  showRedDrenaje: boolean;
  onToggleRedDrenaje: (v: boolean) => void;
  showLineasTransmision: boolean;
  onToggleLineasTransmision: (v: boolean) => void;
  showSuelos: boolean;
  onToggleSuelos: (v: boolean) => void;
  suelosStatus: SuelosStatus;
  showBioclima: boolean;
  onToggleBioclima: (v: boolean) => void;
  bioclimaVariable: BioclimaVariable;
  onBioclimaVariable: (v: BioclimaVariable) => void;
  showCatastroFruticola: boolean;
  onToggleCatastroFruticola: (v: boolean) => void;
  showVegetacional: boolean;
  onToggleVegetacional: (v: boolean) => void;
  showPropiedadesRurales: boolean;
  onTogglePropiedadesRurales: (v: boolean) => void;
  propiedadesRuralesStatus: PropiedadesRuralesStatus;
  showNdviVisual: boolean;
  onToggleNdviVisual: (v: boolean) => void;
  /** Estado del raster por viewport: la leyenda lo muestra para no presentar
   *  una falla del servicio como "sin datos". */
  ndviVisualStatus: NdviVisualEstado;
  kmlLayers: KmlLayer[];
  kmlError: string | null;
  onAddKmlFiles: (files: FileList) => void;
  onToggleKml: (id: string) => void;
  onRemoveKml: (id: string) => void;
  /** Actualiza el alias editable del perito («Sector de Tasación», etc.).
   *  El cambio se refleja en el popup del feature y en el cajetín del PNG
   *  exportado. El nombre original del archivo, en `KmlLayer.name`, no se
   *  toca: solo se reemplaza `displayName`. */
  onRenameKml: (id: string, displayName: string) => void;
  /** Dispara la rasterización de la vista actual a PNG con flecha norte,
   *  escala y atribuciones. La página se ocupa del guard contra re-entradas. */
  onExport: () => void;
  /** True mientras canvas.toBlob está corriendo; deshabilita el botón y
   *  muestra "Generando…" para feedback al usuario. */
  exporting: boolean;
  /** Herramienta NDVI armada (modo cruceta en el mapa). */
  ndviMode: boolean;
  /** Arma/desarma la consulta NDVI por punto en el mapa. */
  onToggleNdviMode: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Tab shown inside the panel. Was `mobileView` when the two columns only
  // existed on small screens; now the sidebar is 320 px wide at every
  // breakpoint, so the tabs replace the old `md:grid-cols-[16rem_1fr]`.
  const [view, setView] = useState<LayerSidebarView>('catalogue');
  const [query, setQuery] = useState('');
  // Deferred so typing stays responsive: the value used for FILTERING and for
  // COUNTING is the same one, so rows and the empty state cannot disagree.
  const deferredQuery = useDeferredValue(query);

  const open = activeId === 'layers';
  const handleToggle = () => {
    // Forgetting the filter on close keeps a reopened panel from looking
    // broken ("why is everything missing?").
    if (open) setQuery('');
    onActivate('layers');
  };

  const normalizedQuery = normalizeLayerQuery(deferredQuery);
  const visibleKmlLayers = normalizedQuery === ''
    ? kmlLayers
    : kmlLayers.filter((layer) =>
        normalizeLayerQuery(`${kmlDisplayName(layer)} ${layer.name}`).includes(normalizedQuery),
      );
  // null = no search in flight (and always null on the active tab, which does
  // not filter): the sidebar renders its single status region only then.
  const matchCount =
    view === 'catalogue' && deferredQuery !== ''
      ? countLayerMatches(deferredQuery) + visibleKmlLayers.length
      : null;

  const opacityControl = (key: keyof LayerOpacity, fillOnly = false) => (
    <OpacityControl value={layerOpacity[key]} onChange={(value) => onLayerOpacity(key, value)} fillOnly={fillOnly} />
  );
  const bioclimaControls = (
    <>
      {opacityControl('bioclima')}
      <label className="block text-xs">
        <span className="font-medium">Variable climática</span>
        <select value={bioclimaVariable}
          onChange={(event) => onBioclimaVariable(event.target.value as BioclimaVariable)}
          className="mt-1 w-full rounded border border-black/15 bg-[var(--background)] px-1.5 py-1 text-xs text-[var(--foreground)] dark:border-white/20">
          <option value="precipitation">Precipitación anual (mm)</option>
          <option value="temperature">Temperatura media anual (°C)</option>
        </select>
      </label>
    </>
  );
  const hasActiveLegend = showHexbins || showProtected || showUrbanLimit || showComunas ||
    showRedVial || showRedDrenaje || showLineasTransmision || showSuelos || showBioclima ||
    showCatastroFruticola || showVegetacional || showPropiedadesRurales || showNdviVisual;
  const activeLayerCount = [showHexbins, showProtected, showUrbanLimit, showComunas,
    showRedVial, showRedDrenaje, showLineasTransmision, showSuelos, showBioclima,
    showCatastroFruticola, showVegetacional, showPropiedadesRurales, showNdviVisual].filter(Boolean).length;
  const catalogue = (
      <div className="space-y-2">
        <LayerGroupHeader id="cbr" />
        <LayerRow
          checked={showPoints}
          onChange={onTogglePoints}
          layerId="points"
          label="Transacciones CBR"
          swatch={
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CBR_POINT_COLOR }} />
          }
        />

        <LayerRow
          checked={showHexbins}
          onChange={onToggleHexbins}
          layerId="hexbins"
          label="Mapa de calor de valor ($/m²)"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: `linear-gradient(90deg, ${HEXBIN_RAMPS.plasma[2]}, ${HEXBIN_RAMPS.plasma[5]})`,
              }}
            />
          }
        >
          <div className="space-y-2">
            <label className="block">
              <span className="text-[0.6rem] font-medium uppercase tracking-wide opacity-60">
                Destino SII
              </span>
              <select
                value={hexbinDestino}
                onChange={(e) => onHexbinDestino(e.target.value)}
                className="mt-0.5 w-full rounded border border-black/15 bg-[var(--background)] px-1.5 py-1 text-xs text-[var(--foreground)] dark:border-white/20"
              >
                {/* El popup nativo del <select> lo pinta el sistema operativo y
                    NO hereda el fondo del panel: con `bg-transparent` el UA
                    caía a blanco mientras el texto seguía heredando el
                    `--foreground` claro del tema oscuro, dejando la lista
                    ilegible. Por eso fondo y color van explícitos aquí y
                    también en cada <option>. */}
                {DESTINO_OPTIONS.map((d) => (
                  <option
                    key={d.code}
                    value={d.code}
                    className="bg-[var(--background)] text-[var(--foreground)]"
                  >
                    {destinoLabel(d.code)} · {d.n.toLocaleString('es-CL')}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[0.6rem] font-medium uppercase tracking-wide opacity-60">
                Mínimo por celda: {hexbinMinN}
              </span>
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={hexbinMinN}
                onChange={(e) => onHexbinMinN(Number(e.target.value))}
                className="mt-0.5 w-full accent-[#b12a90]"
              />
            </label>

            <HexbinLegend status={hexbinStatus} />

            <p className="text-[0.6rem] leading-snug opacity-50">
              <strong className="font-semibold">{HEXBINS_DISCLAIMER}</strong>
            </p>
            <p className="text-[0.6rem] leading-snug opacity-50">
              El destino no se puede mezclar: la mediana de $/m² es ~261× mayor en
              habitacional que en agrícola, y una escala compartida no distingue nada.
              La base no trae el diccionario oficial de destinos del SII, así que los
              códigos sin rótulo se muestran con su mediana de superficie como referencia.
            </p>
            <p className="text-[0.6rem] leading-snug opacity-50">{HEXBINS_ATTRIBUTION}</p>
          </div>
        </LayerRow>

        <LayerGroupHeader id="static" />
        <LayerRow
          checked={showProtected}
          onChange={onToggleProtected}
          layerId="protected"
          label="Áreas protegidas (RNAP)"
          swatch={
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS['Parque Nacional'] }} />
          }
        >
          <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-xs">
            {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
              <li key={cat} className="flex items-center gap-1.5 leading-tight">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                <span className="opacity-80">{cat}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            Fuente: Ministerio del Medio Ambiente · Registro Nacional de Áreas Protegidas · CC0
          </p>
        </LayerRow>

        <LayerRow
          checked={showUrbanLimit}
          onChange={onToggleUrbanLimit}
          layerId="urbanLimit"
          label="Límite urbano (PRC)"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: `${URBAN_LIMIT_COLOR}22`, border: `1.5px solid ${URBAN_LIMIT_COLOR}` }}
            />
          }
        >
          <p className="text-[0.6rem] leading-snug opacity-50">
            Límites urbanos de Planes Reguladores Comunales. Fuente: MINVU · IPT · geoide.minvu.cl
          </p>
        </LayerRow>

        <LayerRow
          checked={showComunas}
          onChange={onToggleComunas}
          layerId="comunas"
          label="Límites comunales (DPA)"
          controls={opacityControl('comunas', true)}
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ border: `1.5px dashed ${COMUNAS_COLOR}` }}
            />
          }
        >
          <p className="text-[0.6rem] leading-snug opacity-50">
            {COMUNAS_ATTRIBUTION}. Límites referenciales para visualización; los límites
            oficiales corresponden a DIFROL/SUBDERE.{' '}
            <a
              href={COMUNAS_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <LayerRow
          checked={showRedVial}
          onChange={onToggleRedVial}
          layerId="redVial"
          label="Red caminera (MOP)"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: `${RED_VIAL_COLOR}18`, border: `1.5px solid ${RED_VIAL_COLOR}` }}
            />
          }
        >
          <ul className="space-y-1 text-xs">
            {Object.entries(ROAD_CLASS_GROUPS).map(([key, group]) => (
              <li key={key} className="flex items-center gap-1.5 leading-tight">
                <span
                  className="inline-block w-4 shrink-0 rounded-full"
                  style={{ background: group.color, height: `${Math.max(group.weight, 1.5)}px` }}
                />
                <span className="opacity-80">{group.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            {RED_VIAL_ATTRIBUTION}. Toponimia y ROL oficiales de Vialidad (pueden diferir de
            Google/OSM); trazado referencial para visualización.{' '}
            <a
              href={RED_VIAL_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <LayerRow
          checked={showRedDrenaje}
          onChange={onToggleRedDrenaje}
          layerId="redDrenaje"
          label="Red de drenaje (DGA)"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: `${DRENAJE_TYPE_GROUPS.rio.color}22`, border: `1.5px solid ${DRENAJE_TYPE_GROUPS.rio.color}` }}
            />
          }
        >
          <ul className="space-y-1 text-xs">
            {Object.entries(DRENAJE_TYPE_GROUPS).map(([key, group]) => (
              <li key={key} className="flex items-center gap-1.5 leading-tight">
                <span
                  className="inline-block w-4 shrink-0 rounded-full"
                  style={{ background: group.color, height: `${Math.max(group.weight, 1.5)}px` }}
                />
                <span className="opacity-80">{group.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            {RED_DRENAJE_ATTRIBUTION}. Toponimia oficial DGA (puede diferir de Google/OSM);
            jerarquía BNA (cuenca → subcuenca → subsubcuenca) en el popup. Trazado
            referencial para visualización.{' '}
            <a
              href={RED_DRENAJE_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <LayerRow
          checked={showCatastroFruticola}
          onChange={onToggleCatastroFruticola}
          layerId="catastroFruticola"
          label="Catastro frutícola (CIREN)"
          controls={opacityControl('catastroFruticola', true)}
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: CATASTRO_FRUTICOLA_LEGEND[3].color }}
            />
          }
        >
          <ul className="max-h-44 space-y-1 overflow-y-auto pr-1 text-xs">
            {CATASTRO_FRUTICOLA_LEGEND.map(({ label, color }) => (
              <li key={label} className="flex items-center gap-1.5 leading-tight">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: color }}
                />
                <span className="opacity-80">{label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            {CATASTRO_FRUTICOLA_ATTRIBUTION}. Cobertura: 14 regiones administrativas (Aysén
            a Arica y Parinacota), levantamientos CIREN 2019–2025 según región (rotativos,
            cada ~5 años). El año del popup es la fecha del levantamiento regional, no el
            año de plantación del huerto: CIREN no publica atributos temporales por predio.
            El ROL del popup coincide con el ROL SII de los puntos CBR. Geometría
            referencial.{' '}
            <a
              href={CATASTRO_FRUTICOLA_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <LayerRow
          checked={showLineasTransmision}
          onChange={onToggleLineasTransmision}
          layerId="lineasTransmision"
          label="Líneas de transmisión eléctrica"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: `${LINEAS_TRANSMISION_COLOR}22`,
                border: `1.5px solid ${LINEAS_TRANSMISION_COLOR}`,
              }}
            />
          }
        >
          <ul className="space-y-1 text-xs">
            {Object.entries(TENSION_GROUPS).map(([key, group]) => (
              <li key={key} className="flex items-center gap-1.5 leading-tight">
                <span
                  className="inline-block w-4 shrink-0 rounded-full"
                  style={{ background: group.color, height: `${Math.max(group.weight, 1.5)}px` }}
                />
                <span className="opacity-80">{group.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            {LINEAS_TRANSMISION_ATTRIBUTION}. Incluye nombre oficial del tramo, tensión,
            circuito, estado y propietario de la línea. <strong>{LINEAS_TRANSMISION_DISCLAIMER}</strong>{' '}
            <a
              href={LINEAS_TRANSMISION_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <LayerGroupHeader id="remote" />
        <LayerRow
          checked={showVegetacional}
          onChange={onToggleVegetacional}
          layerId="vegetacional"
          label="Recursos vegetacionales (CONAF)"
          controls={opacityControl('vegetacional')}
          swatch={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: VEGETACIONAL_COLOR }} />}
        >
          <p className="text-[0.6rem] leading-snug opacity-50">
            {VEGETACIONAL_ATTRIBUTION}. Carga regional bajo demanda; años disponibles:{' '}
            {VEGETACIONAL_REGIONS.map((region) => `${region.label} ${region.vintage}`).join(' · ')}. Los
            polígonos son referenciales y el año corresponde a la actualización regional.
            <strong> Visible desde zoom {VEGETACIONAL_MIN_ZOOM}: acerca el mapa para consultar usos y especies.</strong>{' '}
            <a href={VEGETACIONAL_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-100">
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>

        <div>
          <LayerRow
            checked={showSuelos}
            onChange={onToggleSuelos}
            layerId="suelos"
            label="Suelos agrológicos (CIREN)"
            controls={opacityControl('suelos')}
            swatch={
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: SUELOS_CLASSES[1].color }}
              />
            }
          >
            <ul className="space-y-1 text-xs">
              {SUELOS_CLASSES.map((c) => (
                <li key={c.label} className="flex items-center gap-1.5 leading-tight">
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20 dark:border-white/25"
                    style={{ background: c.color }}
                  />
                  <span className="opacity-80">
                    {c.label}
                    <span className="opacity-60"> · {c.description}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
              {SUELOS_ATTRIBUTION}. Capa servida en vivo por CIREN (12 regiones estudiadas,
              Atacama a Aysén). <strong>Visible desde zoom regional: acerca el mapa</strong>.
              Haz clic para consultar la clase de un punto.{' '}
              <a
                href={SUELOS_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-100"
              >
                Ver fuente oficial →
              </a>
            </p>
          </LayerRow>
          {showSuelos && <SuelosStatusNotice status={suelosStatus} />}
        </div>

        <LayerRow checked={showPropiedadesRurales} onChange={onTogglePropiedadesRurales} layerId="propiedadesRurales" controls={opacityControl('propiedadesRurales')} label="Propiedades rurales (CIREN)" swatch={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `${PROPIEDADES_RURALES_COLOR}22`, border: `1.5px solid ${PROPIEDADES_RURALES_COLOR}` }} />}>
          <p className="text-[0.6rem] leading-snug opacity-50">
            {PROPIEDADES_RURALES_ATTRIBUTION}. 14 regiones, sin Antofagasta ni Magallanes; levantamientos {PROPIEDADES_RURALES_REGIONS[0][1]}–{PROPIEDADES_RURALES_REGIONS.at(-1)?.[1]}. <strong>Visible desde zoom {PROPIEDADES_RURALES_MIN_ZOOM}.</strong> {PROPIEDADES_RURALES_DISCLAIMER}{' '}
            <a href={PROPIEDADES_RURALES_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-100">Ver fuente oficial →</a>
          </p>
          {propiedadesRuralesStatus.kind === 'zoom-required' && <p className="mt-1 text-[0.6rem] opacity-50">Acerca el mapa para consultar ROL y comuna.</p>}
        </LayerRow>

        <div>
          <LayerRow
            checked={showNdviVisual}
            onChange={onToggleNdviVisual}
            layerId="ndviVisual"
            label="NDVI Visual (Sentinel-2)"
            controls={opacityControl('ndviVisual')}
            swatch={
              <span
                className="inline-block h-2.5 w-4 rounded-sm"
                style={{ background: ndviRampCssGradient() }}
              />
            }
          >
            {/* Misma rampa JSON que el pintor del PNG (padre bioclima-ramp):
                leyenda y capa no pueden divergir por construcción. */}
            <div className="h-2.5 w-full rounded-sm" style={{ background: ndviRampCssGradient() }} aria-hidden />
            <div className="relative mt-0.5 h-3.5" aria-label="Escala NDVI de -0,1 a 0,9">
              {ndviRampTicks().map((tick) => (
                <span
                  key={tick.label}
                  className="absolute top-0 text-[0.6rem] opacity-60"
                  style={{
                    left: `${tick.t * 100}%`,
                    transform: tick.t <= 0 ? 'none' : tick.t >= 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[0.6rem] leading-snug opacity-50">
              {NDVI_VISUAL_ATTRIBUTION}. Composición por viewport con las escenas
              Sentinel-2 más despejadas de los últimos días; la máscara SCL quita
              nubes y sombras. <strong>{NDVI_VISUAL_DESCARGO}</strong>{' '}
              <strong>Visible desde zoom {NDVI_VISUAL_MIN_ZOOM}.</strong>{' '}
              <a
                href={NDVI_VISUAL_SOURCE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:opacity-100"
              >
                Ver fuente oficial →
              </a>
            </p>
          </LayerRow>
          {showNdviVisual && <NdviVisualStatusNotice status={ndviVisualStatus} />}
        </div>

        <LayerGroupHeader id="climate" />
        <LayerRow
          checked={showBioclima}
          onChange={onToggleBioclima}
          layerId="bioclima"
          label="Bioclima (WorldClim)"
          controls={bioclimaControls}
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: `linear-gradient(90deg, ${bioclimaRamp[bioclimaVariable].stops[0].color}, ${bioclimaRamp[bioclimaVariable].stops.at(-1)?.color})`,
              }}
            />
          }
        >
          <ul className="mt-2 space-y-1 text-xs">
            {bioclimaRamp[bioclimaVariable].stops.map((stop) => (
              <li key={stop.label} className="flex items-center gap-1.5 leading-tight">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20 dark:border-white/25"
                  style={{ background: stop.color }}
                />
                <span className="opacity-80">
                  {stop.label}
                  <span className="opacity-60"> {bioclimaRamp[bioclimaVariable].unit}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.6rem] leading-snug opacity-50">
            {bioclimaAttribution}{' '}
            <a
              href={BIOCLIMA_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:opacity-100"
            >
              Ver fuente oficial →
            </a>
          </p>
        </LayerRow>
      </div>

  );

  return (
    <LayerSidebar
      open={open}
      onToggle={handleToggle}
      badge={activeLayerCount}
      query={query}
      onQuery={setQuery}
      view={view}
      onViewChange={setView}
      matchCount={matchCount}
    >
      <section
        id="layer-panel-catalogue"
        role="tabpanel"
        aria-labelledby="layer-tab-catalogue"
        className={view === 'catalogue' ? 'block' : 'hidden'}
      >
        <h2 className="sr-only">Catálogo de capas</h2>
        {/* One context for BOTH filtering and counting (see `matchCount` above):
            the rows below and the sidebar's status line read the same deferred
            query, so the empty state can never disagree with what is visible. */}
        <LayerListContext.Provider value={{ query: deferredQuery, grouped: true }}>
          {catalogue}
        </LayerListContext.Provider>
      </section>

      <section
        id="layer-panel-active"
        role="tabpanel"
        aria-labelledby="layer-tab-active"
        className={view === 'active' ? 'block' : 'hidden'}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide opacity-55">Capas activas</h2>
          {hasActiveLegend && (
            <button type="button" className="text-[0.65rem] underline opacity-70 hover:opacity-100 focus-visible:outline-2"
              onClick={() => (Object.keys(DEFAULT_LAYER_OPACITY) as (keyof LayerOpacity)[]).forEach((key) => onLayerOpacity(key, DEFAULT_LAYER_OPACITY[key]))}>
              Restablecer
            </button>
          )}
        </div>
        {!hasActiveLegend ? (
          <div className="rounded-md border border-dashed border-black/15 px-3 py-6 text-center text-xs leading-relaxed opacity-55 dark:border-white/20">
            Activa una capa temática para ver aquí su escala, opacidad y fuente.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs opacity-65">Opacidad visual; no modifica los datos. Los bordes vectoriales se conservan.</p>
            <ActiveLegendContext.Provider value={true}>{catalogue}</ActiveLegendContext.Provider>
          </div>
        )}
      </section>

      {/* User KML layers. Deliberately OUTSIDE both tab panels: uploading a
          layer, renaming it or exporting a PNG must not depend on which tab
          happens to be open. The list itself is still filtered by the search
          (`visibleKmlLayers`) and counted in `matchCount`. */}

      <div className="mt-3 border-t border-black/10 pt-2.5 dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">Mis capas</p>

        {kmlLayers.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-xs">
            {kmlLayers.map((layer) => {
              // El alias efectivo prioriza el nombre editado por el perito;
              // si está vacío o es solo espacios, cae al nombre del archivo.
              // El original del archivo queda como tooltip para diagnóstico.
              const label = kmlDisplayName(layer);
              return (
                <li key={layer.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={layer.visible}
                    onChange={() => onToggleKml(layer.id)}
                    className="accent-[hsl(153_28%_35%)]"
                    aria-label={`Mostrar capa ${label}`}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: layer.color }}
                  />
                  <InlineEditableKmlName
                    value={label}
                    onSave={(v) => onRenameKml(layer.id, v)}
                  />
                  <span className="opacity-50 no-shrink-0">({layer.featureCount})</span>
                  <button
                    type="button"
                    onClick={() => onRemoveKml(layer.id)}
                    aria-label={`Quitar capa ${label}`}
                    className="shrink-0 rounded px-1 leading-none opacity-40 hover:opacity-100"
                    title={layer.name !== label ? `Original: ${layer.name}` : 'Quitar capa'}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAddKmlFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 w-full rounded-md border border-dashed border-black/25 py-1.5 text-xs font-medium opacity-70 hover:opacity-100 dark:border-white/30"
        >
          + Subir archivo KML / KMZ
        </button>

        {kmlError && (
          <p className="mt-1.5 text-[0.65rem] leading-snug text-red-600 dark:text-red-400">
            {kmlError}
          </p>
        )}

        <p className="mt-1.5 text-[0.6rem] leading-snug opacity-50">
          Solo .kml o .kmz, máx. {KML_MAX_FILE_MB} MB. Se procesa en tu navegador; no se sube a ningún
          servidor.
        </p>
      </div>

      {/* Export a PNG: rasteriza la vista actual con flecha norte, escala y
          atribución. Pensado como anexo de informe de tasación. */}
      <div className="mt-3 border-t border-black/10 pt-2.5 dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">Exportar</p>

        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          aria-busy={exporting}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-black/20 py-1.5 text-xs font-medium opacity-90 hover:opacity-100 disabled:opacity-50 dark:border-white/25"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={exporting ? 'animate-spin' : ''}
          >
            {exporting ? (
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            ) : (
              <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </>
            )}
          </svg>
          {exporting ? 'Generando PNG…' : 'Exportar PNG'}
        </button>

        <p className="mt-1.5 text-[0.6rem] leading-snug opacity-50">
          Captura la vista con flecha norte, escala y atribuciones. Ideal como
          anexo de un informe de tasación.
        </p>
      </div>

      {/* Herramienta NDVI: entrada móvil de la consulta por punto (el chip del
          cluster de escritorio vive en page.tsx). NDVI no es una capa del
          catálogo — no se enciende ni se apaga, se consulta — por eso vive en
          su propio bloque, al nivel de «Mis capas» y «Exportar». */}
      <div className="mt-3 border-t border-black/10 pt-2.5 dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">Herramientas de consulta</p>

        <button
          type="button"
          onClick={onToggleNdviMode}
          aria-pressed={ndviMode}
          className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors ${
            ndviMode
              ? 'border-[hsl(153_28%_35%)]/70 bg-[hsl(153_28%_35%)]/10 text-[hsl(153_28%_25%)]'
              : 'border-black/20 opacity-90 hover:opacity-100 dark:border-white/25'
          }`}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="7" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
          {ndviMode ? 'Cancelar consulta NDVI' : 'Consultar NDVI en el mapa'}
        </button>

        <p className="mt-1.5 text-[0.6rem] leading-snug opacity-50">
          Serie mensual de Sentinel-2 (36 meses) para un punto: arma la
          consulta y haz clic en el mapa. La primera vez tarda 20–45 s.
        </p>
      </div>

    </LayerSidebar>
  );
}
