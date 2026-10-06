import { describe, expect, it } from 'vitest';
import { buildRampLut, quantileScale, rampPosition } from '@/lib/heat-surface';
import { HEXBIN_RAMPS } from '@/lib/hexbins';

describe('quantileScale', () => {
  it('returns steps + 1 thresholds from min to max', () => {
    const scale = quantileScale([10, 20, 30, 40, 50], 4);
    expect(scale).toEqual([10, 20, 30, 40, 50]);
  });

  it('drops non-finite values', () => {
    expect(quantileScale([NaN, Infinity])).toEqual([]);
    expect(quantileScale([1, NaN, 3], 2)).toEqual([1, 2, 3]);
  });
});

describe('rampPosition', () => {
  // A long-tailed $/m² sample, as in the real data.
  const values = [5_000, 8_000, 12_000, 20_000, 35_000, 60_000, 150_000, 900_000];
  const scale = quantileScale(values);

  it('clamps to [0, 1] at the ends of the scale', () => {
    expect(rampPosition(1, scale)).toBe(0);
    expect(rampPosition(5_000, scale)).toBe(0);
    expect(rampPosition(900_000, scale)).toBe(1);
    expect(rampPosition(10_000_000, scale)).toBe(1);
  });

  it('is monotonic, so colour always tracks value', () => {
    let previous = -1;
    for (let v = 5_000; v <= 900_000; v *= 1.1) {
      const t = rampPosition(v, scale);
      expect(t).toBeGreaterThanOrEqual(previous);
      previous = t;
    }
  });

  it('returns the middle of the ramp for a degenerate scale', () => {
    expect(rampPosition(42, [])).toBe(0.5);
    expect(rampPosition(42, [42])).toBe(0.5);
  });
});

describe('buildRampLut', () => {
  it('starts and ends on the ramp anchors', () => {
    for (const id of ['plasma', 'tasacion'] as const) {
      const lut = buildRampLut(id, 256);
      expect(lut).toHaveLength(256 * 3);
      const hex = (i: number) => `#${[0, 1, 2].map((c) => lut[i * 3 + c].toString(16).padStart(2, '0')).join('')}`;
      const anchors = HEXBIN_RAMPS[id];
      expect(hex(0)).toBe(anchors[0]);
      expect(hex(255)).toBe(anchors[anchors.length - 1]);
    }
  });
});
