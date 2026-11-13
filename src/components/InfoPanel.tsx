'use client';

import Link from 'next/link';
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
          {/* Ficha breve, al estilo «Acerca de» de una app: nombre, versión y
              enlaces. El detalle (qué datos se publican, analítica, finalidades)
              vive en /privacidad, la única fuente; no repetirlo aquí. */}
          <p className="font-semibold">SIG de suelo</p>
          <p className="text-xs opacity-60">v{APP_VERSION}</p>
          <p className="mt-2 opacity-80">
            Compraventas de suelo en Chile y capas oficiales del territorio, para
            investigar cómo el mercado de suelo puede contribuir a la conservación
            de la naturaleza.
          </p>
          <p className="mt-3 border-t border-black/10 pt-2 text-xs opacity-60 dark:border-white/10">
            © {new Date().getFullYear()} Gabriel Pantoja Rivera
            {' · '}
            <a
              href="https://github.com/gabrielpantoja-cl/sig.gabrielpantoja.cl"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-100"
            >
              Código abierto (MIT)
            </a>
            {' · '}
            <Link href="/privacidad" className="underline underline-offset-2 hover:opacity-100">
              Privacidad
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
