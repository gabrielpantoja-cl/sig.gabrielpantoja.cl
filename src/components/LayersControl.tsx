'use client';

import { CATEGORY_COLORS } from '@/lib/protected-areas';
import { URBAN_LIMIT_COLOR } from '@/lib/urban-limit';
import { MapPanel, type PanelId } from '@/components/MapPanel';

/**
 * Panel de capas del mapa. Separa la activación/desactivación de capas de los
 * botones de descarga (CSV/GeoJSON), que viven en el panel de filtros. Cuando
 * una capa temática está activa, muestra su leyenda y atribución. El estado
 * abierto/cerrado lo controla page.tsx vía MapPanel (un solo panel a la vez).
 */
export function LayersControl({
  activeId,
  onActivate,
  showProtected,
  onToggleProtected,
  showUrbanLimit,
  onToggleUrbanLimit,
}: {
  activeId: PanelId | null;
  onActivate: (id: PanelId) => void;
  showProtected: boolean;
  onToggleProtected: (v: boolean) => void;
  showUrbanLimit: boolean;
  onToggleUrbanLimit: (v: boolean) => void;
}) {
  return (
    <MapPanel
      id="layers"
      activeId={activeId}
      onActivate={onActivate}
      widthClassName="w-60"
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
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'hsl(153 28% 35%)' }} />
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
    </MapPanel>
  );
}
