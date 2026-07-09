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
export function RetroLoader({ progress, done }: { progress: number; done: boolean }) {
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

  // Cierre: cuando el padre marca done, espera a que la barra alcance el 100%
  // visual y recién entonces hace el fade-out (el mapa ya está detrás).
  useEffect(() => {
    if (!done) return;
    const id = setInterval(() => {
      if (shownRef.current < 99.5) return;
      clearInterval(id);
      shownRef.current = 100;
      setShown(100);
      setTimeout(() => setFading(true), 180);
      setTimeout(() => setGone(true), 650);
    }, 50);
    return () => clearInterval(id);
  }, [done]);

  if (gone) return null;

  const percent = Math.floor(shown);
  const filled = Math.round((percent / 100) * BAR_BLOCKS);
  const empty = BAR_BLOCKS - filled;
  const bar = FILL_CHAR.repeat(filled) + EMPTY_CHAR.repeat(empty);

  return (
    <div
      className="absolute inset-0 z-[500] flex items-center justify-center"
      style={{
        backgroundColor: 'var(--background)',
        opacity: fading ? 0 : 1,
        transition: fading ? 'opacity 0.45s ease-out' : undefined,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-geist-mono, monospace)',
          color: 'hsl(153 28% 30%)',
          border: '2px solid hsl(153 28% 30%)',
          padding: '1.5rem 2rem',
          minWidth: '22rem',
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
    </div>
  );
}
