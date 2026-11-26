import { describe, expect, it } from 'vitest';
import {
  CBR_CLUSTER_FILL_OPACITY,
  CBR_CLUSTER_MAX_COUNT,
  CBR_CLUSTER_MAX_RADIUS,
  CBR_CLUSTER_MIN_BOX_SIZE,
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

  it('grows logarithmically between 2 and 5.000', () => {
    expect(CBR_CLUSTER_MAX_COUNT).toBe(5_000);
    expect(cbrClusterRadius(2)).toBe(6);
    expect(cbrClusterRadius(10)).toBe(11);
    expect(cbrClusterRadius(100)).toBe(17);
    expect(cbrClusterRadius(1_000)).toBe(23);
    expect(cbrClusterRadius(5_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
  });

  it('saturates at the maximum above 5.000', () => {
    expect(cbrClusterRadius(5_001)).toBe(CBR_CLUSTER_MAX_RADIUS);
    expect(cbrClusterRadius(50_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
    expect(cbrClusterRadius(1_000_000)).toBe(CBR_CLUSTER_MAX_RADIUS);
  });

  it('is monotonically non-decreasing and stays within bounds', () => {
    const counts = [2, 3, 5, 10, 25, 100, 500, 1_000, 2_500, 5_000, 10_000, 50_000];
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
  it('returns an even box of at least 24 px centred on the ring', () => {
    for (const count of [2, 10, 100, 1_566, 5_000, 50_000]) {
      const { boxSize, radius } = cbrClusterSvg(count);
      expect(boxSize).toBe(
        Math.max(CBR_CLUSTER_MIN_BOX_SIZE, (radius + CBR_CLUSTER_PADDING) * 2),
      );
      expect(boxSize).toBeGreaterThanOrEqual(CBR_CLUSTER_MIN_BOX_SIZE);
      expect(boxSize % 2).toBe(0);
    }
  });

  it('paints a single carmesí ring and never brings the white halo back', () => {
    const { html } = cbrClusterSvg(1_566);
    expect(html.match(/<circle/g)).toHaveLength(1);
    expect(html).toContain(`fill="${CBR_POINT_COLOR}"`);
    expect(html).toContain(`fill-opacity="${CBR_CLUSTER_FILL_OPACITY}"`);
    expect(html).toContain(`stroke="${CBR_POINT_COLOR}"`);
    expect(html).toContain(`stroke-width="${CBR_CLUSTER_STROKE_WIDTH}"`);
    expect(html).not.toContain('255');
    expect(html).not.toContain('#fff');
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
