import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Geometry } from 'geojson';
import {
  comoLlegarUrl,
  highlightOnClose,
  highlightOnOpen,
  indexComunasByCut,
  jurisdiccionFeatures,
  normalizeConservadorRow,
} from '@/lib/conservadores';

const square = (x: number): Geometry => ({
  type: 'Polygon',
  coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]],
});

const comunas: FeatureCollection<Geometry, { CUT_COM: string | null }> = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: square(0), properties: { CUT_COM: '14101' } },
    { type: 'Feature', geometry: square(1), properties: { CUT_COM: '14102' } },
    // Comuna partida en dos polígonos: ambos son parte de la jurisdicción.
    { type: 'Feature', geometry: square(2), properties: { CUT_COM: '14102' } },
    { type: 'Feature', geometry: square(3), properties: { CUT_COM: null } },
  ],
};

describe('normalizeConservadorRow', () => {
  const base = {
    id: 'cbr-14101', nombre: ' Valdivia ', direccion: '', comuna: 'Valdivia', region: 'Los Ríos',
    telefono: '  ', email: null, sitioWeb: 'https://www.cbrvaldivia.cl',
    jurisdiccion: ['Valdivia', ''], jurisdiccion_cut: ['14101', '', '1410', 'abcde'],
    lat: '-39.8', lng: -73.2,
  };

  it('turns empty strings into null, casts coordinates and keeps only 5-digit CUTs', () => {
    expect(normalizeConservadorRow(base)).toEqual({
      id: 'cbr-14101', nombre: 'Valdivia', direccion: null, comuna: 'Valdivia', region: 'Los Ríos',
      telefono: null, email: null, sitioWeb: 'https://www.cbrvaldivia.cl',
      jurisdiccion: ['Valdivia'], jurisdiccion_cut: ['14101'], lat: -39.8, lng: -73.2,
    });
  });

  it('rejects offices that are not located yet', () => {
    expect(normalizeConservadorRow({ ...base, lat: null })).toBeNull();
    expect(normalizeConservadorRow({ ...base, lng: undefined })).toBeNull();
    expect(normalizeConservadorRow({ ...base, lat: 'NaN' })).toBeNull();
  });

  it('tolerates NULL arrays', () => {
    const c = normalizeConservadorRow({ ...base, jurisdiccion: null, jurisdiccion_cut: null });
    expect(c?.jurisdiccion).toEqual([]);
    expect(c?.jurisdiccion_cut).toEqual([]);
  });
});

describe('jurisdiccionFeatures', () => {
  const index = indexComunasByCut(comunas);

  it('collects every polygon of every CUT present', () => {
    const { features, missing } = jurisdiccionFeatures(index, ['14101', '14102']);
    expect(features).toHaveLength(3);
    expect(missing).toEqual([]);
  });

  it('reports CUTs absent from the DPA file and ignores duplicates', () => {
    const { features, missing } = jurisdiccionFeatures(index, ['14101', '14101', '99999']);
    expect(features).toHaveLength(1);
    expect(missing).toEqual(['99999']);
  });

  it('an office without CUTs highlights nothing', () => {
    expect(jurisdiccionFeatures(index, [])).toEqual({ features: [], missing: [] });
  });
});

describe('highlight transitions', () => {
  it('opening an office replaces the highlight', () => {
    expect(highlightOnOpen(null, 'a')).toBe('a');
    expect(highlightOnOpen('a', 'b')).toBe('b');
  });

  it('closing the highlighted office clears it (toggle)', () => {
    let current: string | null = highlightOnOpen(null, 'a');
    current = highlightOnClose(current, 'a');
    expect(current).toBeNull();
  });

  it('a late close of the previous office does not clear the new one', () => {
    let current: string | null = highlightOnOpen('a', 'b');
    current = highlightOnClose(current, 'a');
    expect(current).toBe('b');
  });

  it('switching A → B in Leaflet order (close A, open B) ends on B', () => {
    let current: string | null = 'a';
    current = highlightOnClose(current, 'a');
    current = highlightOnOpen(current, 'b');
    expect(current).toBe('b');
  });
});

describe('comoLlegarUrl', () => {
  it('builds the Google Maps directions link', () => {
    expect(comoLlegarUrl(-39.8, -73.2)).toBe('https://www.google.com/maps/dir/?api=1&destination=-39.8,-73.2');
  });
});
