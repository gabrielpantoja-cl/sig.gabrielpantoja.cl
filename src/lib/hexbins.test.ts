import { describe, expect, it } from 'vitest';
import { HEXBIN_CLASSES, hexEdgeForZoom, hexEdgeLabel, quantileBreaks } from '@/lib/hexbins';

describe('hexEdgeForZoom', () => {
  it('spans 4 km at country scale down to 60 m at street scale', () => {
    expect(hexEdgeForZoom(0)).toBe(4000);
    expect(hexEdgeForZoom(22)).toBe(60);
  });

  it('never grows as the zoom increases', () => {
    for (let z = 0; z < 22; z++) {
      expect(hexEdgeForZoom(z + 1)).toBeLessThanOrEqual(hexEdgeForZoom(z));
    }
  });
});

describe('hexEdgeLabel', () => {
  it('switches to km from 1000 m', () => {
    expect(hexEdgeLabel(60)).toBe('60 m');
    expect(hexEdgeLabel(1500)).toBe('1.5 km');
  });
});

describe('quantileBreaks', () => {
  it('returns HEXBIN_CLASSES - 1 increasing breaks over spread data', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    const breaks = quantileBreaks(values);
    expect(breaks).toHaveLength(HEXBIN_CLASSES - 1);
    for (let i = 1; i < breaks.length; i++) expect(breaks[i]).toBeGreaterThan(breaks[i - 1]);
  });

  it('deduplicates breaks so no legend class is empty', () => {
    expect(quantileBreaks([5, 5, 5, 5])).toEqual([5]);
  });

  it('ignores non-finite values and handles empty input', () => {
    expect(quantileBreaks([])).toEqual([]);
    expect(quantileBreaks([NaN, Infinity])).toEqual([]);
    expect(quantileBreaks([1, NaN, 2])).toEqual(quantileBreaks([1, 2]));
  });
});
