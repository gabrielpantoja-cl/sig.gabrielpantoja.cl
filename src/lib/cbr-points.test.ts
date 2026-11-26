import { describe, expect, it } from 'vitest';
import {
  CBR_CLUSTER_FILL_OPACITY,
  CBR_CLUSTER_MAX_RADIUS,
  CBR_CLUSTER_MIN_RADIUS,
  CBR_CLUSTER_PADDING,
  CBR_CLUSTER_STROKE_WIDTH,
  CBR_POINT_COLOR,
  cbrClusterRadius,
  cbrClusterSvg,
} from '@/lib/cbr-points';

describe('cbrClusterRadius', () => {
  it('falls back to the minimum for non-finite or tiny counts', () => {
    for (const count of [0, 1, 2, -3, NaN]) {
      expect(cbrClusterRadius(count)).toBe(CBR_CLUSTER_MIN_RADIUS);
    }
    // `Infinity` no es un conteo real: la guarda de `Number.isFinite` lo manda
    // al mínimo en vez de saturar el anillo.
    expect(cbrClusterRadius(Infinity)).toBe(CBR_CLUSTER_MIN_RADIUS);
  });

  it('grows logarithmically between 2 and 25.000', () => {
    expect(cbrClusterRadius(10)).toBe(12);
    expect(cbrClusterRadius(100)).toBe(16);
    expect(cbrClusterRadius(1_000)).toBe(20);
    expect(cbrClusterRadius(10_000)).toBe(24);
    expect(cbrClusterRadius(25_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
  });

  it('saturates at the maximum above 25.000', () => {
    expect(cbrClusterRadius(25_001)).toBe(CBR_CLUSTER_MAX_RADIUS);
    expect(cbrClusterRadius(50_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
    expect(cbrClusterRadius(1_000_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
  });

  it('is monotonically non-decreasing and stays within bounds', () => {
    const counts = [2, 3, 5, 10, 25, 100, 500, 1_000, 5_000, 10_000, 25_000, 50_000];
    let previous = CBR_CLUSTER_MIN_RADIUS;
    for (const count of counts) {
      const radius = cbrClusterRadius(count);
      expect(radius).toBeGreaterThanOrEqual(previous);
      expect(radius).toBeGreaterThanOrEqual(CBR_CLUSTER_MIN_RADIUS);
      expect(radius).toBeLessThanOrEqual(CBR_CLUSTER_MAX_RADIUS);
      previous = radius;
    }
  });
});

describe('cbrClusterSvg', () => {
  it('returns an even box centred on the ring plus its halo padding', () => {
    for (const count of [2, 10, 100, 1_566, 25_000, 50_000]) {
      const { boxSize, radius } = cbrClusterSvg(count);
      expect(boxSize).toBe((radius + CBR_CLUSTER_PADDING) * 2);
      expect(boxSize % 2).toBe(0);
    }
  });

  it('paints the shared CBR colour and the two concentric strokes', () => {
    const { html } = cbrClusterSvg(1_566);
    expect(html).toContain(`stroke="${CBR_POINT_COLOR}"`);
    expect(html).toContain(`stroke-width="${CBR_CLUSTER_STROKE_WIDTH}"`);
    expect(html).toContain(`fill-opacity="${CBR_CLUSTER_FILL_OPACITY}"`);
    expect(html).toContain('rgba(255,255,255,0.85)');
  });

  it('renders no visible numeric text inside the SVG', () => {
    const { html } = cbrClusterSvg(1_566);
    expect(html).not.toContain('<text');
    expect(html).not.toContain('<span');
    // El conteo solo puede aparecer en el title y el aria-label accesibles.
    const withoutAccessibleText = html
      .replace(/<title>.*?<\/title>/, '')
      .replace(/aria-label="[^"]*"/, '');
    expect(withoutAccessibleText).not.toContain('1.566');
  });

  it('formats the accessible label in es-CL', () => {
    const { html } = cbrClusterSvg(1_566);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="1.566 transacciones agrupadas"');
    expect(html).toContain('<title>1.566 transacciones agrupadas</title>');
  });

  it('uses the singular for one transaction and never leaks NaN', () => {
    expect(cbrClusterSvg(1).html).toContain('1 transacción agrupada');
    const nan = cbrClusterSvg(NaN).html;
    expect(nan).toContain('0 transacciones agrupadas');
    expect(nan).not.toContain('NaN');
  });
});
