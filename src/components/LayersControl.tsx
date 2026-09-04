'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
import { KML_MAX_FILE_MB, kmlDisplayName, type KmlLayer } from '@/lib/kml';
import { PROPIEDADES_RURALES_ATTRIBUTION, PROPIEDADES_RURALES_COLOR, PROPIEDADES_RURALES_DISCLAIMER, PROPIEDADES_RURALES_MIN_ZOOM, PROPIEDADES_RURALES_REGIONS, PROPIEDADES_RURALES_SOURCE_URL, type PropiedadesRuralesStatus } from '@/lib/propiedades-rurales';
import {
  BIOCLIMA_SOURCE_URL,
  bioclimaAttribution,
  bioclimaRamp,
  type BioclimaVariable,
} from '@/lib/bioclima';
import { MapPanel, type PanelId } from '@/components/MapPanel';

/**
 * Fila de capa estilo Google Earth Pro: triángulo de despliegue (▸/▾) +
 * checkbox + swatch + nombre. El triángulo abre los DETALLES de la capa
 * (leyenda, fuente, atribución) de forma independiente del checkbox, así
 * activar una capa no obliga a desplegar su leyenda y la lista se mantiene
 * compacta a medida que crece el catálogo de capas.
 */
function LayerRow({
  checked,
  onChange,
  readOnly = false,
  swatch,
  label,
  children,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  readOnly?: boolean;
  swatch: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

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
          {children}
        </div>
      )}
    </div>
  );
}

function SuelosStatusNotice({ status }: { status: SuelosStatus }) {
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

/**
 * Panel de capas del mapa. Separa la activación/desactivación de capas de los
 * botones de descarga (CSV/GeoJSON), que viven en el panel de filtros. Cada
 * capa temática lleva su leyenda y atribución detrás de un triángulo de
 * despliegue (LayerRow), colapsadas por defecto. La capa de transacciones CBR
 * —la principal— está activada por defecto pero también es ocultable: el
 * perito la quita cuando quiere componer una vista limpia, por ejemplo para
 * exportar el mapa como PNG con flecha norte y adjuntarlo a un informe de
 * tasación. Incluye la sección «Mis capas», donde el usuario sube archivos
 * .kml que se procesan localmente (ver lib/kml.ts) y se listan con visibilidad,
 * borrado, renombrado y swatch de color por capa. El estado abierto/cerrado
 * del panel lo controla page.tsx vía MapPanel (uno a la vez).
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
  kmlLayers,
  kmlError,
  onAddKmlFiles,
  onToggleKml,
  onRemoveKml,
  onRenameKml,
  onExport,
  exporting,
}: {
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
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <MapPanel
      id="layers"
      activeId={activeId}
      onActivate={onActivate}
      widthClassName="w-64"
      align="right"
      label="Capas"
      icon={
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      }
    >
      <div className="space-y-2">
        <LayerRow
          checked={showPoints}
          onChange={onTogglePoints}
          label="Transacciones CBR"
          swatch={
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CBR_POINT_COLOR }} />
          }
        />

        <LayerRow
          checked={showHexbins}
          onChange={onToggleHexbins}
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

        <LayerRow checked={showPropiedadesRurales} onChange={onTogglePropiedadesRurales} label="Propiedades rurales (CIREN)" swatch={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: `${PROPIEDADES_RURALES_COLOR}22`, border: `1.5px solid ${PROPIEDADES_RURALES_COLOR}` }} />}>
          <p className="text-[0.6rem] leading-snug opacity-50">
            {PROPIEDADES_RURALES_ATTRIBUTION}. 14 regiones, sin Antofagasta ni Magallanes; levantamientos {PROPIEDADES_RURALES_REGIONS[0][1]}–{PROPIEDADES_RURALES_REGIONS.at(-1)?.[1]}. <strong>Visible desde zoom {PROPIEDADES_RURALES_MIN_ZOOM}.</strong> {PROPIEDADES_RURALES_DISCLAIMER}{' '}
            <a href={PROPIEDADES_RURALES_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:opacity-100">Ver fuente oficial →</a>
          </p>
          {propiedadesRuralesStatus.kind === 'zoom-required' && <p className="mt-1 text-[0.6rem] opacity-50">Acerca el mapa para consultar ROL y comuna.</p>}
        </LayerRow>

        <LayerRow
          checked={showProtected}
          onChange={onToggleProtected}
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
          label="Límites comunales (DPA)"
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
          label="Catastro frutícola (CIREN)"
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

        <LayerRow
          checked={showVegetacional}
          onChange={onToggleVegetacional}
          label="Recursos vegetacionales (CONAF)"
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
            label="Suelos agrológicos (CIREN)"
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

        <LayerRow
          checked={showBioclima}
          onChange={onToggleBioclima}
          label="Bioclima (WorldClim)"
          swatch={
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{
                background: `linear-gradient(90deg, ${bioclimaRamp[bioclimaVariable].stops[0].color}, ${bioclimaRamp[bioclimaVariable].stops.at(-1)?.color})`,
              }}
            />
          }
        >
          <label className="block">
            <span className="text-[0.6rem] font-medium uppercase tracking-wide opacity-60">
              Variable
            </span>
            <select
              value={bioclimaVariable}
              onChange={(e) => onBioclimaVariable(e.target.value as BioclimaVariable)}
              className="mt-0.5 w-full rounded border border-black/15 bg-[var(--background)] px-1.5 py-1 text-xs text-[var(--foreground)] dark:border-white/20"
            >
              <option value="precipitation" className="bg-[var(--background)] text-[var(--foreground)]">
                Precipitación anual (mm)
              </option>
              <option value="temperature" className="bg-[var(--background)] text-[var(--foreground)]">
                Temperatura media anual (°C)
              </option>
            </select>
          </label>
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

      {/* Capas KML del usuario */}
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
          accept=".kml"
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
          + Subir archivo KML
        </button>

        {kmlError && (
          <p className="mt-1.5 text-[0.65rem] leading-snug text-red-600 dark:text-red-400">
            {kmlError}
          </p>
        )}

        <p className="mt-1.5 text-[0.6rem] leading-snug opacity-50">
          Solo .kml, máx. {KML_MAX_FILE_MB} MB. Se procesa en tu navegador; no se sube a ningún
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
    </MapPanel>
  );
}
