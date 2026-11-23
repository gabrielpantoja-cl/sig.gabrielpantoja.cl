import { describe, expect, it } from 'vitest';
import { tileSources } from '@/lib/tile-sources';

describe('tileSources', () => {
  it('starts with the tile itself, uncropped', () => {
    expect(tileSources(156940, 325064, 19)[0]).toEqual({
      x: 156940, y: 325064, z: 19, cropSize: 256, cropX: 0, cropY: 0,
    });
  });

  it('walks up the parents and picks the matching quadrant', () => {
    const [, padre, abuelo] = tileSources(5, 6, 10);
    // 5 = 2·2+1 → mitad derecha; 6 = 2·3+0 → mitad superior.
    expect(padre).toEqual({ x: 2, y: 3, z: 9, cropSize: 128, cropX: 128, cropY: 0 });
    // 5 = 4·1+1, 6 = 4·1+2 → cuarto (1, 2) del abuelo.
    expect(abuelo).toEqual({ x: 1, y: 1, z: 8, cropSize: 64, cropX: 64, cropY: 128 });
  });

  it('stops at z0 and at the level cap', () => {
    expect(tileSources(1, 1, 2)).toHaveLength(3);
    expect(tileSources(0, 0, 18)).toHaveLength(5);
  });
});
