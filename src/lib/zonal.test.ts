import { describe, expect, it } from 'vitest';
import { crucesFila, resumirRelieve } from '@/lib/zonal';
import type { Posicion } from '@/lib/analisis-predio';

const cuadrado = (x0: number, y0: number, lado: number): Posicion[] => [
  [x0, y0], [x0 + lado, y0], [x0 + lado, y0 + lado], [x0, y0 + lado], [x0, y0],
];

describe('crucesFila', () => {
  it('crosses a square twice inside its latitude span and never outside', () => {
    expect(crucesFila([cuadrado(0, 0, 10)], 5)).toEqual([0, 10]);
    expect(crucesFila([cuadrado(0, 0, 10)], 11)).toEqual([]);
  });

  it('counts a vertex exactly on the row once (half-open edges)', () => {
    const rombo: Posicion[] = [[0, 0], [5, 5], [10, 0], [5, -5], [0, 0]];
    expect(crucesFila([rombo], 0)).toHaveLength(2);
    expect(crucesFila([rombo], 5)).toHaveLength(0);
  });

  it('leaves a hole out by even-odd', () => {
    expect(crucesFila([cuadrado(0, 0, 10), cuadrado(3, 3, 4)], 5)).toEqual([0, 3, 7, 10]);
  });
});

describe('resumirRelieve', () => {
  it('splits slopes into SAG classes and legal thresholds', () => {
    const r = resumirRelieve([0.5, 2, 10, 20, 35, 50, 70, 46], [100, 110, 120, 130, 140, 150, 160, 170], 30);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.celdas).toBe(8);
    expect(r.pctSobre45).toBe(37.5);
    expect(r.pctSobre30).toBe(50);
    expect(r.cotaMin).toBe(100);
    expect(r.cotaMax).toBe(170);
    expect(r.cotaMedia).toBe(135);
    expect(r.pendienteMediana).toBe(27.5);
    expect(r.clases.map((c) => c.clase)).toEqual(['A', 'B', 'E', 'F', 'G', 'H', 'I']);
    expect(r.clases.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100, 10);
  });

  it('is null without cells', () => {
    expect(resumirRelieve([], [], 30)).toBeNull();
  });
});
