import { describe, expect, it } from 'vitest';
import { extensionRobusta } from '@/lib/encuadre';

describe('extensionRobusta', () => {
  it('answers null without points', () => {
    expect(extensionRobusta([])).toBeNull();
    expect(extensionRobusta([{ lat: NaN, lng: -72 }])).toBeNull();
  });

  it('uses every point of a small selection', () => {
    expect(extensionRobusta([{ lat: -45.5, lng: -72.1 }, { lat: -45.6, lng: -72.0 }]))
      .toEqual([-45.6, -72.1, -45.5, -72.0]);
  });

  it('ignores a stray point in a large selection', () => {
    const points = Array.from({ length: 99 }, (_, i) => ({ lat: -45.5 - i / 1000, lng: -72 - i / 1000 }));
    points.push({ lat: 0, lng: 0 });
    const [south, west, north, east] = extensionRobusta(points)!;
    expect(north).toBeLessThan(-45);
    expect(east).toBeLessThan(-71);
    expect(south).toBeGreaterThan(-46);
    expect(west).toBeGreaterThan(-73);
  });
});
