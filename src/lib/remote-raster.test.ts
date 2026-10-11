import { describe, expect, it } from 'vitest';
import {
  RASTER_GRID_PX,
  RASTER_MAX_SIZE,
  project,
  rasterRequest,
  retryAfterSeconds,
  unproject,
} from '@/lib/remote-raster';

const VALDIVIA = { lat: -39.85067, lng: -73.23874 };
const VIEW = { x: 1080, y: 843 };

describe('project / unproject', () => {
  it('round-trips a Chilean coordinate', () => {
    const [x, y] = project(VALDIVIA.lat, VALDIVIA.lng, 15);
    const [lat, lng] = unproject(x, y, 15);
    expect(lat).toBeCloseTo(VALDIVIA.lat, 9);
    expect(lng).toBeCloseTo(VALDIVIA.lng, 9);
  });
});

describe('rasterRequest', () => {
  it('asks for the viewport plus one grid cell, with the Mercator aspect of the size', () => {
    const r = rasterRequest(VALDIVIA, 15, VIEW);
    expect(r.size).toEqual([VIEW.x + RASTER_GRID_PX, VIEW.y + RASTER_GRID_PX]);
    const [w, s, e, n] = r.bbox;
    const [x0, y0] = project(n, w, 15);
    const [x1, y1] = project(s, e, 15);
    // ArcGIS re-ajusta la extensión si la proporción no calza: debe calzar.
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(r.size[0] / r.size[1], 4);
  });

  it('always covers the real viewport', () => {
    for (let dx = -200; dx <= 200; dx += 37) {
      const [cx, cy] = project(VALDIVIA.lat, VALDIVIA.lng, 14);
      const [lat, lng] = unproject(cx + dx, cy + dx / 2, 14);
      const r = rasterRequest({ lat, lng }, 14, VIEW);
      const [w, s, e, n] = r.bbox;
      const [vx0, vy0] = [cx + dx - VIEW.x / 2, cy + dx / 2 - VIEW.y / 2];
      const [rx0, ry0] = project(n, w, 14);
      const [rx1, ry1] = project(s, e, 14);
      expect(rx0).toBeLessThanOrEqual(vx0 + 0.01);
      expect(ry0).toBeLessThanOrEqual(vy0 + 0.01);
      expect(rx1).toBeGreaterThanOrEqual(vx0 + VIEW.x - 0.01);
      expect(ry1).toBeGreaterThanOrEqual(vy0 + VIEW.y - 0.01);
    }
  });

  it('reuses the same request for a small pan and changes it for a large one', () => {
    const [cx, cy] = project(VALDIVIA.lat, VALDIVIA.lng, 15);
    const snapped = unproject(Math.round(cx / RASTER_GRID_PX) * RASTER_GRID_PX, Math.round(cy / RASTER_GRID_PX) * RASTER_GRID_PX, 15);
    const base = rasterRequest({ lat: snapped[0], lng: snapped[1] }, 15, VIEW);
    const [sx, sy] = project(snapped[0], snapped[1], 15);
    const small = unproject(sx + 20, sy - 30, 15);
    const large = unproject(sx + 300, sy, 15);
    expect(rasterRequest({ lat: small[0], lng: small[1] }, 15, VIEW).key).toBe(base.key);
    expect(rasterRequest({ lat: large[0], lng: large[1] }, 15, VIEW).key).not.toBe(base.key);
    expect(rasterRequest({ lat: snapped[0], lng: snapped[1] }, 16, VIEW).key).not.toBe(base.key);
  });

  it('falls back to the exact view on very wide screens, never above the proxy cap', () => {
    const r = rasterRequest(VALDIVIA, 12, { x: 2560, y: 1300 });
    expect(r.size[0]).toBeLessThanOrEqual(RASTER_MAX_SIZE);
    expect(r.size[1]).toBe(1300);
  });
});

describe('retryAfterSeconds', () => {
  const res = (value: string | null) => ({ headers: new Headers(value === null ? {} : { 'Retry-After': value }) });
  it('reads, rounds up and bounds the header', () => {
    expect(retryAfterSeconds(res('13'))).toBe(13);
    expect(retryAfterSeconds(res('0.2'))).toBe(1);
    expect(retryAfterSeconds(res('9999'))).toBe(120);
  });
  it('assumes 10 s when missing or unreadable', () => {
    expect(retryAfterSeconds(res(null))).toBe(10);
    expect(retryAfterSeconds(res('mañana'))).toBe(10);
  });
});
