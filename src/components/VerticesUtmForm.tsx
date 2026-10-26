'use client';

import { useId, useState } from 'react';
import { parsearVerticesUtm, type ZonaUtmChile } from '@/lib/vertices-utm';
import type { Punto } from '@/lib/medicion';

const inputClass =
  'rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-xs focus:border-[hsl(153_28%_35%)] focus:outline-none dark:border-white/20';

/**
 * «Predio por coordenadas»: el perito pega la tabla de vértices UTM del plano
 * o de la escritura y abre la ficha del predio sobre ese polígono. Todo se
 * convierte en el navegador (`lib/vertices-utm.ts`); las coordenadas solo
 * viajan al servidor como parte del análisis y no se guardan.
 */
export function VerticesUtmForm({ onAnalizar }: { onAnalizar: (vertices: Punto[]) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [zona, setZona] = useState<ZonaUtmChile>(19);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const idTexto = useId();

  const analizar = () => {
    const r = parsearVerticesUtm(texto, zona);
    if (!r.ok) {
      setError(r.error);
      setAviso(null);
      return;
    }
    setError(null);
    setAviso(r.descartadas > 0 ? `${r.descartadas} línea(s) sin coordenadas se ignoraron (encabezados).` : null);
    onAnalizar(r.puntos);
  };

  return (
    <div className="border-t border-black/10 pt-3 dark:border-white/10">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between text-sm font-medium"
      >
        Predio por coordenadas UTM
        <span aria-hidden="true" className="text-xs opacity-60">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="mt-2 flex flex-col gap-2">
          <label htmlFor={idTexto} className="text-[0.68rem] leading-snug opacity-60">
            Pega los vértices del plano, uno por línea: este y norte (acepta etiquetas, tabulación,
            «;» y coma decimal).
          </label>
          <textarea
            id={idTexto}
            rows={5}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={'V1  732364,52  4947573,18\nV2  732911,05  4947602,40\nV3  732880,77  4947120,93'}
            className={`${inputClass} font-mono`}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs">
              <span className="opacity-70">Huso</span>
              <select
                value={zona}
                onChange={(e) => setZona(Number(e.target.value) as ZonaUtmChile)}
                className={inputClass}
              >
                <option value={19}>19 S (72° O al este)</option>
                <option value={18}>18 S (al oeste de 72° O)</option>
              </select>
            </label>
            <button
              type="button"
              onClick={analizar}
              disabled={!texto.trim()}
              className="ml-auto rounded-md border border-[hsl(153_28%_35%)] bg-[hsl(153_28%_35%)] px-2 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analizar predio
            </button>
          </div>
          <p className="text-[0.65rem] leading-snug opacity-55">
            Datum WGS84 / SIRGAS-Chile. Un plano antiguo en PSAD56 o SAD69 queda desplazado unos
            200-400 m: revisa que el polígono caiga donde corresponde.
          </p>
          {error && <p role="alert" className="text-[0.68rem] text-red-700 dark:text-red-300">{error}</p>}
          {aviso && <p className="text-[0.68rem] text-amber-700 dark:text-amber-300">{aviso}</p>}
        </div>
      )}
    </div>
  );
}
