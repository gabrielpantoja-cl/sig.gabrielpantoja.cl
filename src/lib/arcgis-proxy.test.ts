import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchArcGis,
  identifySearch,
  isPngBody,
  parseNumberTuple,
  readExactParams,
  readExportParams,
  readIdentifyParams,
  validGeographicExtent,
  validIntegerTuple,
} from '@/lib/arcgis-proxy';

const sp = (query: string) => new URLSearchParams(query);
const IDENTIFY = 'geometry=-73.2,-39.8&mapExtent=-73.3,-39.9,-73.1,-39.7&imageDisplay=400,400,96&tolerance=1';

describe('readExactParams', () => {
  it('accepts exactly the required keys', () => {
    expect(readExactParams(sp('a=1&b=2'), ['a', 'b'])).toEqual({ a: '1', b: '2' });
  });

  it('rejects extra, missing and repeated keys', () => {
    expect(readExactParams(sp('a=1&b=2&c=3'), ['a', 'b'])).toBeNull();
    expect(readExactParams(sp('a=1'), ['a', 'b'])).toBeNull();
    expect(readExactParams(sp('a=1&a=2&b=2'), ['a', 'b'])).toBeNull();
  });
});

describe('parseNumberTuple', () => {
  it('parses a comma list of the exact length', () => {
    expect(parseNumberTuple('1, 2.5,-3', 3)).toEqual([1, 2.5, -3]);
  });

  it('rejects wrong length, blanks and non-numbers', () => {
    expect(parseNumberTuple('1,2', 3)).toBeNull();
    expect(parseNumberTuple('1,,3', 3)).toBeNull();
    expect(parseNumberTuple('1,x,3', 3)).toBeNull();
    expect(parseNumberTuple('1,Infinity,3', 3)).toBeNull();
  });
});

describe('validators', () => {
  it('requires an ordered extent inside the globe', () => {
    expect(validGeographicExtent([-74, -40, -73, -39])).toBe(true);
    expect(validGeographicExtent([-73, -40, -74, -39])).toBe(false);
    expect(validGeographicExtent([-181, -40, -73, -39])).toBe(false);
  });

  it('checks integer tuples by length and range', () => {
    expect(validIntegerTuple([1, 2048], 2, 1, 2048)).toBe(true);
    expect(validIntegerTuple([0, 10], 2, 1, 2048)).toBe(false);
    expect(validIntegerTuple([1.5, 10], 2, 1, 2048)).toBe(false);
    expect(validIntegerTuple([10], 2, 1, 2048)).toBe(false);
  });
});

describe('readExportParams', () => {
  it('parses bbox and size without range-checking them', () => {
    expect(readExportParams(sp('bbox=1,2,3,4&size=256,256'))).toEqual({
      bbox: [1, 2, 3, 4],
      size: [256, 256],
    });
    expect(readExportParams(sp('bbox=1,2,3&size=256,256'))).toBeNull();
    expect(readExportParams(sp('bbox=1,2,3,4&size=256,256&f=json'))).toBeNull();
  });
});

describe('readIdentifyParams', () => {
  it('parses a valid identify request', () => {
    expect(readIdentifyParams(sp(IDENTIFY))).toEqual({
      geometry: [-73.2, -39.8],
      mapExtent: [-73.3, -39.9, -73.1, -39.7],
      imageDisplay: [400, 400, 96],
      tolerance: 1,
    });
  });

  it.each([
    ['dpi out of range', IDENTIFY.replace('400,400,96', '400,400,300')],
    ['oversized display', IDENTIFY.replace('400,400,96', '4000,400,96')],
    ['fractional tolerance', IDENTIFY.replace('tolerance=1', 'tolerance=1.5')],
    ['tolerance above 10', IDENTIFY.replace('tolerance=1', 'tolerance=11')],
    ['point outside the globe', IDENTIFY.replace('-73.2,-39.8', '-200,-39.8')],
    ['extra parameter', `${IDENTIFY}&layers=all`],
  ])('rejects %s', (_label, query) => {
    expect(readIdentifyParams(sp(query))).toBeNull();
  });

  it('applies a custom extent validator', () => {
    expect(readIdentifyParams(sp(IDENTIFY), () => false)).toBeNull();
  });

  it('builds the upstream query string', () => {
    const params = readIdentifyParams(sp(IDENTIFY))!;
    const upstream = new URLSearchParams(identifySearch(params, 'visible:1,2'));
    expect(upstream.get('layers')).toBe('visible:1,2');
    expect(upstream.get('sr')).toBe('4326');
    expect(upstream.get('returnGeometry')).toBe('false');
    expect(upstream.get('mapExtent')).toBe('-73.3,-39.9,-73.1,-39.7');
  });
});

describe('isPngBody', () => {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  it('checks the PNG signature', () => {
    expect(isPngBody(new Uint8Array([...signature, 0]))).toBe(true);
    expect(isPngBody(new Uint8Array(signature.slice(0, 7)))).toBe(false);
    expect(isPngBody(new Uint8Array([0, ...signature]))).toBe(false);
    expect(isPngBody(null)).toBe(false);
  });
});

describe('fetchArcGis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const url = new URL('https://example.test/MapServer/export');

  it('returns the body when it fits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    const result = await fetchArcGis(url, 'image/png', 10);
    expect(result.bodyError).toBe(false);
    expect(Array.from(result.body!)).toEqual([1, 2, 3]);
  });

  it('flags a body larger than the cap, declared or streamed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(20))));
    const streamed = await fetchArcGis(url, 'image/png', 10);
    expect(streamed).toMatchObject({ body: null, bodyError: true });

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('x', { headers: { 'content-length': '999' } })));
    const declared = await fetchArcGis(url, 'image/png', 10);
    expect(declared).toMatchObject({ body: null, bodyError: true });
  });

  it('hands back non-OK responses without a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const result = await fetchArcGis(url, 'image/png', 10);
    expect(result.response?.status).toBe(500);
    expect(result).toMatchObject({ body: null, bodyError: false, timedOut: false });
  });

  it('reports a network failure as no response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const result = await fetchArcGis(url, 'image/png', 10);
    expect(result).toMatchObject({ response: null, body: null, timedOut: false, bodyError: false });
  });

  it('never follows redirects', async () => {
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);
    await fetchArcGis(url, 'image/png', 10);
    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }));
  });
});
