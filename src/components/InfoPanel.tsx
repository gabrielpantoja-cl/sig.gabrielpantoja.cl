'use client';

import { useState } from 'react';

/**
 * Botón "i" en el header con dropdown de información: aquí vive la
 * descripción del sitio (mensaje de datos públicos / privacidad Ley 19.628)
 * y la atribución de fuentes que antes ocupaban header y footer completos.
 * Tiene estado propio: no participa de la exclusión mutua de los paneles
 * del mapa.
 */
export function InfoPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Acerca de este sitio"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-black/15 text-sm opacity-70 hover:opacity-100 dark:border-white/20"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[700] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-black/15 bg-[var(--background)]/95 p-3 text-sm shadow-lg backdrop-blur dark:border-white/20">
          <p className="opacity-80">
            Compraventas inscritas en el CBR del centro-sur de Chile. Datos públicos:
            precio, año, comuna, superficie, ROL y coordenadas — sin nombres ni RUT.
            Consulta libre para peritos e investigación en ecoinformática.
          </p>
          <p className="mt-2 border-t border-black/10 pt-2 text-xs opacity-60 dark:border-white/10">
            Fuente: recopilación propia de inscripciones del Conservador de Bienes
            Raíces. Datos públicos y anonimizados.
          </p>
        </div>
      )}
    </div>
  );
}
