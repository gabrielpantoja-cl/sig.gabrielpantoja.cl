'use client';

import { useEffect, useRef, useState } from 'react';

const BAR_BLOCKS = 24;
const FILL_CHAR = '▓';
const EMPTY_CHAR = '░';

/**
 * Pantalla de carga retro controlada por progreso REAL (0–100), no por un
 * temporizador. El padre reporta el avance (descarga del dataset + render de
 * marcadores) y este componente solo suaviza el movimiento de la barra con un
 * acercamiento exponencial. Mientras `done` sea false la barra nunca pasa de
 * 99%, así el 100% coincide exactamente con el mapa ya pintado en pantalla:
 * sin quedarse pegada a mitad de camino ni dejar segundos en blanco al final.
 */
export function RetroLoader({
  progress,
  done,
  skipped = false,
  onSkip,
  onGone,
}: {
  progress: number;
  done: boolean;
  /** El usuario eligió explorar mientras carga: el loader se desvanece ya. */
  skipped?: boolean;
  onSkip?: () => void;
  /** El loader terminó de desvanecerse: la página vuelve a ser interactiva. */
  onGone?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const shownRef = useRef(0);
  const targetRef = useRef(0);

  useEffect(() => {
    targetRef.current = done ? 100 : Math.min(progress, 99);
  }, [progress, done]);

  // Suavizado: la barra persigue el objetivo real, rápido cuando está lejos y
  // fino cuando está cerca, sin retroceder jamás.
  useEffect(() => {
    let raf = requestAnimationFrame(function tick() {
      const cur = shownRef.current;
      const target = targetRef.current;
      if (cur < target) {
        const next = Math.min(target, cur + Math.max(0.4, (target - cur) * 0.14));
        shownRef.current = next;
        setShown(next);
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const onGoneRef = useRef(onGone);
  useEffect(() => {
    onGoneRef.current = onGone;
  }, [onGone]);

  // Cierre: cuando el padre marca done, espera a que la barra alcance el 100%
  // visual y recién entonces hace el fade-out (el mapa ya está detrás).
  useEffect(() => {
    if (!done || skipped) return;
    const id = setInterval(() => {
      if (shownRef.current < 99.5) return;
      clearInterval(id);
      shownRef.current = 100;
      setShown(100);
      setTimeout(() => setFading(true), 180);
      setTimeout(() => {
        setGone(true);
        onGoneRef.current?.();
      }, 650);
    }, 50);
    return () => clearInterval(id);
  }, [done, skipped]);

  // «Explorar mientras carga»: se desvanece sin esperar a la barra; la carga
  // sigue en segundo plano y la página avisa cuando termina.
  useEffect(() => {
    if (!skipped) return;
    const fade = setTimeout(() => setFading(true), 0);
    const end = setTimeout(() => {
      setGone(true);
      onGoneRef.current?.();
    }, 380);
    return () => {
      clearTimeout(fade);
      clearTimeout(end);
    };
  }, [skipped]);

  if (gone) return null;

  const percent = Math.floor(shown);
  const filled = Math.round((percent / 100) * BAR_BLOCKS);
  const empty = BAR_BLOCKS - filled;
  const bar = FILL_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty);

  // Cubre TODA la pantalla (cabecera incluida): una viñeta que desenfoca y
  // oscurece los bordes y deja nítido el centro, donde está la barra. La página
  // de atrás queda `inert` mientras tanto (lo decide page.tsx), así que nada
  // invita a escribir o tocar antes de tiempo.
  return (
    <div
      className="sig-loader fixed inset-0 z-[2000] flex flex-col items-center justify-center gap-3"
      role="status"
      aria-live="polite"
      aria-label={`Cargando transacciones: ${percent} %`}
      style={{
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 0.45s ease-out' : undefined,
      }}
    >
      <div className="sig-loader-blur" aria-hidden="true" />
      <div className="sig-loader-dim" aria-hidden="true" />
      <div
        className="relative"
        style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          color: 'hsl(153 28% 30%)',
          border: '2px solid hsl(153 28% 30%)',
          background: 'color-mix(in srgb, var(--background) 92%, transparent)',
          padding: '1.5rem 2rem',
          minWidth: 'min(22rem, calc(100vw - 2rem))',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: '0.65rem', letterSpacing: '0.2em', marginBottom: '0.75rem', opacity: 0.7 }}>
          SIG · SUELO · CBR
        </div>
        <div style={{ fontSize: '0.8rem', letterSpacing: '0.12em', marginBottom: '1rem' }}>
          CARGANDO TRANSACCIONES...
        </div>
        <div style={{ fontSize: '0.85rem', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          [{bar}]
        </div>
        <div style={{ fontSize: '0.65rem', opacity: 0.55, letterSpacing: '0.08em' }}>
          {percent}% · CONSERVADORES DE BIENES RAÍCES
        </div>
      </div>
      {onSkip && !fading && (
        <button
          type="button"
          onClick={onSkip}
          className="relative rounded px-2 py-1 text-xs underline decoration-dotted underline-offset-4 opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(153_28%_35%)]"
          style={{ fontFamily: 'var(--font-geist-mono, monospace)', color: 'hsl(153 28% 38%)' }}
        >
          Saltar y explorar el mapa mientras carga →
        </button>
      )}
    </div>
  );
}
