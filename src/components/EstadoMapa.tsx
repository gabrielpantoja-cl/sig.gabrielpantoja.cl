'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { getBasemap, prefersDark } from '@/lib/basemap';
import { radioCelda, type GrillaRespaldo } from '@/lib/estado';

/**
 * Micro visor de `/estado`: la copia restaurada del respaldo, agrupada en
 * celdas de ~10 km (`/api/estado/grilla`). Sirve para ver de un vistazo que la
 * copia trae datos en todo el territorio, no solo el conteo correcto.
 *
 * Liviano a propósito: Leaflet se importa recién al montar (no entra al
 * render del servidor ni al bundle inicial de la página), un solo fondo (OSM
 * neutro) y círculos en canvas, sin clusters ni controles extra.
 */

const ACENTO = 'hsl(153 28% 35%)';
/** Chile continental. Isla de Pascua queda fuera del encuadre inicial: lo aplastaría. */
const ENCUADRE_CHILE: [[number, number], [number, number]] = [
  [-56, -76],
  [-17.4, -66.4],
];

const fmtNumero = new Intl.NumberFormat('es-CL');

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error' }
  | { tipo: 'ok'; total: number; celdas: number };

export default function EstadoMapa() {
  const contenedor = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  useEffect(() => {
    const div = contenedor.current;
    if (!div) return;
    let cancelado = false;
    let destruir: (() => void) | null = null;
    // Filtro del fondo neutro según el tema (globals.css). Se pone acá y no en
    // el JSX: en el servidor no hay `matchMedia` y la hidratación no calzaría.
    div.dataset.basemap = prefersDark() ? 'dark' : 'light';

    (async () => {
      try {
        const [{ default: L }, res] = await Promise.all([
          import('leaflet'),
          fetch('/api/estado/grilla'),
        ]);
        if (!res.ok) throw new Error(`grilla ${res.status}`);
        const grilla = (await res.json()) as GrillaRespaldo;
        if (cancelado) return;

        const mapa = L.map(div, {
          preferCanvas: true,
          zoomControl: true,
          attributionControl: true,
          scrollWheelZoom: false,
        });
        destruir = () => mapa.remove();
        mapa.fitBounds(ENCUADRE_CHILE);

        const fondo = getBasemap('neutro');
        if (fondo.url) {
          L.tileLayer(fondo.url, {
            subdomains: fondo.subdomains,
            attribution: fondo.attribution,
            maxNativeZoom: fondo.maxNativeZoom,
          }).addTo(mapa);
        }

        const nMax = grilla.celdas.reduce((m, c) => Math.max(m, c.n), 0);
        for (const c of grilla.celdas) {
          L.circleMarker([c.lat, c.lng], {
            radius: radioCelda(c.n, nMax),
            color: ACENTO,
            weight: 0.5,
            fillColor: ACENTO,
            fillOpacity: 0.55,
          })
            .bindTooltip(`${fmtNumero.format(c.n)} transacciones`)
            .addTo(mapa);
        }

        setEstado({ tipo: 'ok', total: grilla.total, celdas: grilla.celdas.length });
      } catch (error) {
        console.error('Micro visor del respaldo:', error);
        if (!cancelado) setEstado({ tipo: 'error' });
      }
    })();

    return () => {
      cancelado = true;
      destruir?.();
    };
  }, []);

  return (
    <div>
      <div
        ref={contenedor}
        className="mt-3 h-80 w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10 md:h-96"
        role="img"
        aria-label="Mapa de la copia restaurada del respaldo, agrupada en celdas de unos 10 km"
      />
      <p className="mt-2 text-xs opacity-60" aria-live="polite">
        {estado.tipo === 'cargando' && 'Cargando la copia restaurada…'}
        {estado.tipo === 'error' && 'No se pudo leer la copia restaurada por ahora.'}
        {estado.tipo === 'ok' &&
          `${fmtNumero.format(estado.total)} transacciones georreferenciadas en ${fmtNumero.format(estado.celdas)} celdas de ~10 km. Se actualiza una vez al día.`}
      </p>
    </div>
  );
}
