'use client';

import { useRef, useState, type ReactNode } from 'react';
import { CATEGORY_COLORS } from '@/lib/protected-areas';
import { URBAN_LIMIT_COLOR } from '@/lib/urban-limit';
import { COMUNAS_ATTRIBUTION, COMUNAS_COLOR, COMUNAS_SOURCE_URL } from '@/lib/comunas';
import {
  RED_VIAL_ATTRIBUTION,
  RED_VIAL_COLOR,
  RED_VIAL_SOURCE_URL,
  ROAD_CLASS_GROUPS,
} from '@/lib/red-vial';
import { CBR_POINT_COLOR } from '@/lib/cbr-points';
import { KML_MAX_FILE_MB, type KmlLayer } from '@/lib/kml';
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

/**
 * Panel de capas del mapa. Separa la activación/desactivación de capas de los
 * botones de descarga (CSV/GeoJSON), que viven en el panel de filtros. Cada
 * capa temática lleva su leyenda y atribución detrás de un triángulo de
 * despliegue (LayerRow), colapsadas por defecto. Incluye la sección «Mis
 * capas», donde el usuario sube archivos .kml que se procesan localmente
 * (ver lib/kml.ts) y se listan con visibilidad y borrado por capa. El estado
 * abierto/cerrado del panel lo controla page.tsx vía MapPanel (uno a la vez).
 */
export function LayersControl({
  activeId,
  onActivate,
  showProtected,
  onToggleProtected,
  showUrbanLimit,
  onToggleUrbanLimit,
  showComunas,
  onToggleComunas,
  showRedVial,
  onToggleRedVial,
  kmlLayers,
  kmlError,
  onAddKmlFiles,
  onToggleKml,
  onRemoveKml,
}: {
  activeId: PanelId | null;
  onActivate: (id: PanelId) => void;
  showProtected: boolean;
  onToggleProtected: (v: boolean) => void;
  showUrbanLimit: boolean;
  onToggleUrbanLimit: (v: boolean) => void;
  showComunas: boolean;
  onToggleComunas: (v: boolean) => void;
  showRedVial: boolean;
  onToggleRedVial: (v: boolean) => void;
  kmlLayers: KmlLayer[];
  kmlError: string | null;
  onAddKmlFiles: (files: FileList) => void;
  onToggleKml: (id: string) => void;
  onRemoveKml: (id: string) => void;
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
          checked
          readOnly
          label="Transacciones CBR"
          swatch={
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CBR_POINT_COLOR }} />
          }
        />

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
      </div>

      {/* Capas KML del usuario */}
      <div className="mt-3 border-t border-black/10 pt-2.5 dark:border-white/10">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-50">Mis capas</p>

        {kmlLayers.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-xs">
            {kmlLayers.map((layer) => (
              <li key={layer.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={layer.visible}
                  onChange={() => onToggleKml(layer.id)}
                  className="accent-[hsl(153_28%_35%)]"
                  aria-label={`Mostrar capa ${layer.name}`}
                />
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: layer.color }}
                />
                <span className="min-w-0 flex-1 truncate" title={layer.name}>
                  {layer.name}
                  <span className="ml-1 opacity-50">({layer.featureCount})</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveKml(layer.id)}
                  aria-label={`Quitar capa ${layer.name}`}
                  className="shrink-0 rounded px-1 leading-none opacity-40 hover:opacity-100"
                >
                  ✕
                </button>
              </li>
            ))}
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
    </MapPanel>
  );
}
