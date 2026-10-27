import { beforeEach, describe, expect, it, vi } from 'vitest';

const obtenerGrilla = vi.fn();
vi.mock('@/lib/estado-server', () => ({ obtenerGrilla }));

const { GET } = await import('./route');

const request = () => new Request('http://localhost/api/estado/grilla', {
  headers: { 'x-forwarded-for': `10.0.1.${Math.floor(Math.random() * 250)}` },
});

describe('GET /api/estado/grilla', () => {
  beforeEach(() => {
    obtenerGrilla.mockReset();
  });

  it('devuelve la grilla con caché de una hora en la CDN', async () => {
    obtenerGrilla.mockResolvedValue({ total: 3, celdas: [{ lat: -45.5, lng: -72.1, n: 3 }] });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('s-maxage=3600, stale-while-revalidate=86400');
    expect(await res.json()).toEqual({ total: 3, celdas: [{ lat: -45.5, lng: -72.1, n: 3 }] });
  });

  it('sin grilla responde 503 sin caché', async () => {
    obtenerGrilla.mockResolvedValue(null);
    const res = await GET(request());
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0');
  });
});
