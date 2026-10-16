import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/neon', () => ({ getSql: () => ({ query }) }));

const { GET, OPTIONS } = await import('./route');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cbr-14101',
  nombre: 'Valdivia',
  direccion: 'Independencia 455',
  comuna: 'Valdivia',
  region: 'Los Ríos',
  telefono: '',
  email: null,
  sitioWeb: 'https://www.cbrvaldivia.cl',
  jurisdiccion: ['Valdivia', 'Corral'],
  jurisdiccion_cut: ['14101', '14102'],
  lat: -39.8142,
  lng: -73.2459,
  ...over,
});

const request = () => new Request('http://localhost/api/conservadores', {
  headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
});

describe('GET /api/conservadores', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('selects only the public columns and only located offices', async () => {
    query.mockResolvedValue([]);
    await GET(request());
    const sqlText = String(query.mock.calls[0][0]);
    expect(sqlText).toContain('WHERE lat IS NOT NULL AND lng IS NOT NULL');
    expect(sqlText).toMatch(/SELECT id, nombre, direccion, comuna, region, telefono, email, "sitioWeb",\s+jurisdiccion, jurisdiccion_cut, lat, lng/);
    expect(sqlText).not.toMatch(/\*/);
  });

  it('returns the normalized shape with a long CDN cache', async () => {
    query.mockResolvedValue([row({ lat: '-39.8142', lng: '-73.2459' })]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('s-maxage=86400, stale-while-revalidate=604800');
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'cbr-14101',
        nombre: 'Valdivia',
        direccion: 'Independencia 455',
        comuna: 'Valdivia',
        region: 'Los Ríos',
        telefono: null,
        email: null,
        sitioWeb: 'https://www.cbrvaldivia.cl',
        jurisdiccion: ['Valdivia', 'Corral'],
        jurisdiccion_cut: ['14101', '14102'],
        lat: -39.8142,
        lng: -73.2459,
      },
    ]);
  });

  it('drops rows without coordinates even if the database returns them', async () => {
    query.mockResolvedValue([row(), row({ id: 'copiapo-cbr', lat: null }), row({ id: 'cbr-x', lng: 'abc' })]);
    const body = await (await GET(request())).json();
    expect(body.map((c: { id: string }) => c.id)).toEqual(['cbr-14101']);
  });

  it('answers a generic 500 when the database fails', async () => {
    query.mockImplementation(async () => { throw new Error('boom'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(request());
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch conservadores' });
  });

  it('answers the CORS preflight', async () => {
    const res = await OPTIONS(request());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});
