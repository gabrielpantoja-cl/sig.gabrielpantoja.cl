'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { APP_VERSION } from '@/lib/version';
import type { FuenteServicio, NivelEstado } from '@/lib/estado';

/**
 * Resumen de una línea, al estilo del pie de una página de estado: un punto y
 * dos o tres palabras. El detalle (qué base atiende, qué falla, desde cuándo)
 * vive solo en /estado; no repetirlo aquí.
 */
type Resumen = { texto: string; color: string };

const OK: Resumen = { texto: 'Todo funciona', color: 'bg-emerald-500' };
const PARCIAL: Resumen = { texto: 'Funcionamiento parcial', color: 'bg-amber-500' };
const REVISION: Resumen = { texto: 'Respaldo en revisión', color: 'bg-amber-500' };
const SIN_DATOS: Resumen = { texto: 'Ver estado', color: 'bg-gray-400' };

function resumen(servicio: FuenteServicio | null, nivel: NivelEstado): Resumen {
  // Funcionar con la copia pesa más que el respaldo: es lo que nota quien usa
  // el mapa ahora (datos con atraso, ficha del predio parcial).
  if (servicio === 'respaldo') return PARCIAL;
  if (nivel === 'falla' || nivel === 'atrasado') return REVISION;
  if (nivel === 'al-dia') return OK;
  return SIN_DATOS;
}

/**
 * Botón "i" en el header con dropdown de información: aquí vive la
 * descripción del sitio (mensaje de datos públicos / privacidad Ley 19.628)
 * y la atribución de fuentes que antes ocupaban header y footer completos.
 * Tiene estado propio: no participa de la exclusión mutua de los paneles
 * del mapa. Se cierra con Escape o con un clic fuera.
 */
export function InfoPanel() {
  const [open, setOpen] = useState(false);
  const [nivel, setNivel] = useState<NivelEstado | null>(null);
  const [servicio, setServicio] = useState<FuenteServicio | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // El estado se pide al abrir el panel, una sola vez. /api/health nunca
  // consulta la base principal (lee la tabla de verificaciones con caché).
  useEffect(() => {
    if (!open || nivel) return;
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { servicio?: FuenteServicio; datos?: { nivel?: NivelEstado } } | null) => {
        setServicio(j?.servicio ?? null);
        const n = j?.datos?.nivel;
        setNivel(n ?? 'sin-datos');
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setNivel('sin-datos');
      });
    return () => ctrl.abort();
  }, [open, nivel]);

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
          <Link
            href="/estado"
            className="mt-3 flex items-center gap-2 rounded-md border border-black/10 px-2 py-1.5 text-xs transition-colors hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${
                nivel ? resumen(servicio, nivel).color : 'animate-pulse bg-gray-400'
              }`}
            />
            <span className="flex-1">{nivel ? resumen(servicio, nivel).texto : 'Estado…'}</span>
            <span className="opacity-60">Estado →</span>
          </Link>
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
