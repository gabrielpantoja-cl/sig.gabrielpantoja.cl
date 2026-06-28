'use client';

import { useEffect, useRef, useState } from 'react';

const BAR_BLOCKS = 24;
const FILL_CHAR = '▓';
const EMPTY_CHAR = '░';

export function RetroLoader({ loading }: { loading: boolean }) {
  const [percent, setPercent] = useState(0);
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const prevLoading = useRef(loading);

  useEffect(() => {
    if (loading) {
      // Reset if loading re-triggers
      setFading(false);
      setGone(false);
      startRef.current = null;

      function tick(ts: number) {
        if (!startRef.current) startRef.current = ts;
        const elapsed = ts - startRef.current;
        // Cubic ease-out: fills to 85% in 2.5s
        const t = Math.min(elapsed / 2500, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        setPercent(Math.floor(eased * 85));
        rafRef.current = requestAnimationFrame(tick);
      }

      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    } else if (prevLoading.current) {
      // Loading just finished
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPercent(100);
      setTimeout(() => setFading(true), 150);
      setTimeout(() => setGone(true), 600);
    }
    prevLoading.current = loading;
  }, [loading]);

  if (gone) return null;

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
