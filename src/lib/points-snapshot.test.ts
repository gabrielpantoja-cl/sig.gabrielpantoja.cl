import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSnapshotPoints, parseManifest } from '@/lib/points-snapshot';

const manifest = {
  version: 1,
  token: '2.1794227445678',
  count: 2,
  file: 'points-2.1794227445678.json.gz',
  bytes: 40,
  generatedAt: '2026-11-14T07:45:00Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('parseManifest', () => {
  it('acepta un manifiesto válido', () => {
    expect(parseManifest(manifest)).toEqual(manifest);
  });

  it('rechaza un archivo que no lleva el token o sale de la carpeta', () => {
    expect(parseManifest({ ...manifest, file: 'points-9.9.json.gz' })).toBeNull();
    expect(parseManifest({ ...manifest, file: '../points-2.1794227445678.json.gz' })).toBeNull();
    expect(parseManifest({ ...manifest, file: 'https://otro.sitio/points-2.1794227445678.json.gz' })).toBeNull();
  });

  it('rechaza versión, conteo o forma desconocidos', () => {
    expect(parseManifest({ ...manifest, version: 2 })).toBeNull();
    expect(parseManifest({ ...manifest, count: 0 })).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('x')).toBeNull();
  });
});

describe('fetchSnapshotPoints', () => {
  const puntos = [{ lat: -39.8, lng: -72.3 }, { lat: -40.1, lng: -73.2 }];

  function stub(body: unknown) {
    const f = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith('manifest.json') ? manifest : body)),
    );
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('lee el manifiesto y luego el archivo vigente', async () => {
    const f = stub(puntos);
    const { points } = await fetchSnapshotPoints('https://datos.ejemplo/sig', new AbortController().signal, () => {});
    expect(points).toEqual(puntos);
    expect(f.mock.calls.map((c) => c[0])).toEqual([
      'https://datos.ejemplo/sig/manifest.json',
      'https://datos.ejemplo/sig/points-2.1794227445678.json.gz',
    ]);
  });

  it('lanza si el archivo no calza con el conteo del manifiesto', async () => {
    stub(puntos.slice(0, 1));
    await expect(
      fetchSnapshotPoints('https://datos.ejemplo/sig', new AbortController().signal, () => {}),
    ).rejects.toThrow(/no calza/);
  });
});
