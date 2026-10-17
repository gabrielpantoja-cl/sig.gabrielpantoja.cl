'use client';

import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/lib/version';

/**
 * Botón "i" en el header con dropdown de información: aquí vive la
 * descripción del sitio (mensaje de datos públicos / privacidad Ley 19.628)
 * y la atribución de fuentes que antes ocupaban header y footer completos.
 * Tiene estado propio: no participa de la exclusión mutua de los paneles
 * del mapa. Se cierra con Escape o con un clic fuera.
 */
export function InfoPanel() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Acerca de este sitio"
        title="Acerca de este sitio"
        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/15 transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)] dark:border-white/20 dark:hover:bg-white/10 ${
          open ? 'bg-black/5 dark:bg-white/10' : ''
        }`}
      >
        <svg
          width="16"
          height="16"
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
        <div className="absolute right-0 top-full z-[1300] mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-black/15 bg-[var(--background)]/95 p-3 text-sm shadow-lg backdrop-blur dark:border-white/20">
          <p className="opacity-80">
            Sistema de información geográfica para estudiar el valor y el
            contexto del suelo en Chile: compraventas inscritas en los
            Conservadores de Bienes Raíces del centro-sur, junto a capas
            oficiales de territorio, suelo, agua, vegetación y relieve. Pensado
            para peritos tasadores e investigación.
          </p>
          <p className="mt-2 border-t border-black/10 pt-2 text-xs opacity-60 dark:border-white/10">
            Transacciones: recopilación propia de inscripciones públicas.
            Se muestran precio, año, comuna, superficie, ROL y ubicación; nunca
            nombres ni RUT de las partes. Cada capa indica su fuente y licencia
            en la leyenda.
          </p>
          <p className="mt-2 border-t border-black/10 pt-2 text-xs opacity-60 dark:border-white/10">
            Medimos el uso del sitio de forma agregada y sin cookies de
            seguimiento: no guardamos tu IP ni lo que buscas, solo la región
            aproximada, el tipo de dispositivo y qué herramientas se usan. Si tu
            navegador envía Do Not Track o GPC, no registramos nada.
          </p>
          <p className="mt-2 border-t border-black/10 pt-2 text-xs opacity-60 dark:border-white/10">
            <a
              href="https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-100"
            >
              Código abierto (MIT)
            </a>
            {' · '}v{APP_VERSION}
          </p>
        </div>
      )}
    </div>
  );
}
