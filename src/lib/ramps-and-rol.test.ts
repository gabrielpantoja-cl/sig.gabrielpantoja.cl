import { describe, expect, it } from 'vitest';
import { normalizePropiedadRuralRol } from '@/lib/propiedades-rurales';
import { NDVI_VISUAL_STOPS, ndviRampRgb, ndviRampTicks } from '@/lib/ndvi-visual';

describe('normalizePropiedadRuralRol', () => {
  it('accepts manzana-predio and normalizes dashes and spaces', () => {
    expect(normalizePropiedadRuralRol('123-45')).toBe('123-45');
    expect(normalizePropiedadRuralRol(' 123 – 45 ')).toBe('123-45');
    expect(normalizePropiedadRuralRol('123—45')).toBe('123-45');
  });

  it('rejects anything that could reach the ArcGIS where clause', () => {
    expect(normalizePropiedadRuralRol("123-45' OR '1'='1")).toBeNull();
    expect(normalizePropiedadRuralRol('12345')).toBeNull();
    expect(normalizePropiedadRuralRol('12345678-1')).toBeNull();
  });
});

describe('ndviRampRgb', () => {
  const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const first = NDVI_VISUAL_STOPS[0].color;
  const last = NDVI_VISUAL_STOPS[NDVI_VISUAL_STOPS.length - 1].color;

  it('hits the first and last stop at the domain edges', () => {
    expect(hex(ndviRampRgb(-0.1))).toBe(first);
    expect(hex(ndviRampRgb(0.9))).toBe(last);
  });

  it('clamps values outside the domain to the end colours', () => {
    expect(hex(ndviRampRgb(-1))).toBe(first);
    expect(hex(ndviRampRgb(1))).toBe(last);
  });

  it('places legend ticks inside [0, 1]', () => {
    for (const { t } of ndviRampTicks()) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});
