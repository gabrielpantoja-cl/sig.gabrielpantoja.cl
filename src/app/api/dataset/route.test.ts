import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/neon', () => ({ getSql: () => ({ query }) }));

const { GET, OPTIONS } = await import('./route');

const request = () => new Request('http://localhost/api/dataset', {
  headers: { 'x-forwarded-for': `10.0.1.${Math.floor(Math.random() * 250)}` },
});

describe('GET /api/dataset', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('counts only the rows the map can draw', async () => {
    query.mockResolvedValue([{ n: 0, updated: null, created: null }]);
    await GET(request());
    const sqlText = String(query.mock.calls[0][0]);
    expect(sqlText).toContain('FROM referenciales');
    expect(sqlText).toContain('WHERE lat IS NOT NULL AND lng IS NOT NULL');
  });

  it('derives a token from the count and the newest timestamp', async () => {
    const updated = new Date('2026-11-05T02:32:51.385Z');
    query.mockResolvedValue([{ n: 130512, updated, created: new Date('2026-11-05T02:12:38.009Z') }]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      token: `130512.${updated.getTime()}`,
      count: 130512,
      updated: updated.toISOString(),
    });
  });

  it('falls back to createdAt when the ETL never touched updatedAt', async () => {
    const created = new Date('2026-11-05T02:12:38.009Z');
    query.mockResolvedValue([{ n: 10, updated: null, created }]);
    const body = await (await GET(request())).json();
    expect(body.updated).toBe(created.toISOString());
    expect(body.token).toBe(`10.${created.getTime()}`);
  });

  it('changes the token when a row is added, and only then', async () => {
    const stamp = new Date('2026-11-05T02:32:51.385Z');
    query.mockResolvedValue([{ n: 100, updated: stamp, created: stamp }]);
    const first = await (await GET(request())).json();
    const second = await (await GET(request())).json();
    expect(second.token).toBe(first.token);

    query.mockResolvedValue([{ n: 101, updated: stamp, created: stamp }]);
    const third = await (await GET(request())).json();
    expect(third.token).not.toBe(first.token);
  });

  it('caps the staleness at 30 s of CDN cache', async () => {
    query.mockResolvedValue([{ n: 1, updated: null, created: null }]);
    const res = await GET(request());
    expect(res.headers.get('Cache-Control')).toBe('s-maxage=30');
  });

  it('answers a generic 500 when the database fails', async () => {
    query.mockImplementation(async () => { throw new Error('boom'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(request());
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to fetch dataset version' });
  });

  it('answers the CORS preflight', async () => {
    const res = await OPTIONS(request());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});
