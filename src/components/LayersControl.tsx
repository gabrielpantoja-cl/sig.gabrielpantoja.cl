'use client';

import { useRef } from 'react';
import { CATEGORY_COLORS } from '@/lib/protected-areas';
import { URBAN_LIMIT_COLOR } from '@/lib/urban-limit';
import { CBR_POINT_COLOR } from '@/lib/cbr-points';
import { KML_MAX_FILE_MB, type KmlLayer } from '@/lib/kml';
import { MapPanel, type PanelId } from '@/components/MapPanel';

/**
 * Panel de capas del mapa. Separa la activación/desactivación de capas de los
 * botones de descarga (CSV/GeoJSON), que viven en el panel de filtros. Cuando
 * una capa temática está activa, muestra su leyenda y atribución. Incluye la
 * sección «Mis capas», donde el usuario sube archivos .kml que se procesan
 * localmente (ver lib/kml.ts) y se listan con visibilidad y borrado por capa.
 * El estado abierto/cerrado lo controla page.tsx vía MapPanel (un solo panel
 * a la vez).
 */
export function LayersControl({
  activeId,
  onActivate,
  showProtected,
  onToggleProtected,
  showUrbanLimit,
  onToggleUrbanLimit,
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
      widthClassName="w-60"
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
      <label className="flex cursor-default items-center gap-2 opacity-70">
        <input type="checkbox" checked readOnly className="accent-[hsl(153_28%_35%)]" />
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: CBR_POINT_COLOR }} />
          Transacciones CBR
        </span>
      </label>

      <label className="mt-2 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={showProtected}
          onChange={(e) => onToggleProtected(e.target.checked)}
          className="accent-[hsl(153_28%_35%)]"
        />
        Áreas protegidas (RNAP)
      </label>

      {showProtected && (
        <div className="mt-2.5 border-t border-black/10 pt-2 dark:border-white/10">
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
        </div>
      )}

      <label className="mt-2 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={showUrbanLimit}
          onChange={(e) => onToggleUrbanLimit(e.target.checked)}
          className="accent-[hsl(153_28%_35%)]"
        />
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: `${URBAN_LIMIT_COLOR}22`, border: `1.5px solid ${URBAN_LIMIT_COLOR}` }}
          />
          Límite urbano (PRC)
        </span>
      </label>

      {showUrbanLimit && (
        <p className="mt-2 border-t border-black/10 pt-2 text-[0.6rem] leading-snug opacity-50 dark:border-white/10">
          Límites urbanos de Planes Reguladores Comunales. Fuente: MINVU · IPT · geoide.minvu.cl
        </p>
      )}

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
