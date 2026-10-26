import { describe, expect, it } from 'vitest';
import { lonLatToUtm, utmToLonLat } from '@/lib/coordenadas';
import { numeroChileno, parsearVerticesUtm } from '@/lib/vertices-utm';

describe('utmToLonLat', () => {
  it('inverts lonLatToUtm below the millimetre across Chile', () => {
    for (const [lng, lat, zona] of [
      [-70.65, -33.45, 19], [-73.24, -39.82, 18], [-72.06, -45.57, 18], [-70.91, -53.16, 19], [-74.9, -48.0, 18],
    ]) {
      const [e, n] = lonLatToUtm(lng, lat, zona);
      const [lng2, lat2] = utmToLonLat(e, n, zona);
      expect(Math.abs(lng2 - lng)).toBeLessThan(1e-8);
      expect(Math.abs(lat2 - lat)).toBeLessThan(1e-8);
    }
  });

  it('puts E 500.000 on the central meridian', () => {
    expect(utmToLonLat(500000, 5_000_000, 19)[0]).toBeCloseTo(-69, 10);
  });
});

describe('numeroChileno', () => {
  it('reads Chilean and plain formats', () => {
    expect(numeroChileno('4.947.573')).toBe(4947573);
    expect(numeroChileno('4.947.573,25')).toBe(4947573.25);
    expect(numeroChileno('732364,52')).toBe(732364.52);
    expect(numeroChileno('732364.52')).toBe(732364.52);
    expect(numeroChileno('732,364')).toBe(732364);
    expect(numeroChileno('V1')).toBeNull();
    expect(numeroChileno('')).toBeNull();
  });
});

describe('parsearVerticesUtm', () => {
  const vertices = (zona: 18 | 19, puntos: [number, number][]) =>
    puntos.map(([lng, lat]) => lonLatToUtm(lng, lat, zona));

  it('parses a pasted table with labels, Chilean decimals and a header', () => {
    const [a, b, c] = vertices(18, [[-72.08, -45.58], [-72.05, -45.58], [-72.05, -45.56]]);
    const fmt = (v: number) => v.toFixed(2).replace('.', ',');
    const texto = [
      'Vértice\tEste\tNorte',
      `V1\t${fmt(a[0])}\t${fmt(a[1])}`,
      `V2; ${fmt(b[0])}; ${fmt(b[1])}`,
      `V3 ${fmt(c[0])} ${fmt(c[1])}`,
      `V1\t${fmt(a[0])}\t${fmt(a[1])}`,
    ].join('\n');
    const r = parsearVerticesUtm(texto, 18);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.puntos).toHaveLength(3); // el cierre repetido se quita
    expect(r.descartadas).toBe(1); // el encabezado
    expect(r.puntos[0].lat).toBeCloseTo(-45.58, 6);
    expect(r.puntos[0].lng).toBeCloseTo(-72.08, 6);
  });

  it('swaps N E columns and accepts comma-separated values', () => {
    const [a, b, c] = vertices(19, [[-70.6, -33.4], [-70.59, -33.4], [-70.59, -33.41]]);
    const texto = [a, b, c].map(([e, n]) => `${n.toFixed(1)},${e.toFixed(1)}`).join('\n');
    const r = parsearVerticesUtm(texto, 19);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.puntos[1].lng).toBeCloseTo(-70.59, 5);
  });

  it('rejects coordinates that are not UTM of Chile and too few vertices', () => {
    expect(parsearVerticesUtm('-73.2 -39.8\n-73.1 -39.8\n-73.1 -39.7', 18).ok).toBe(false);
    expect(parsearVerticesUtm('650000 5590000\n651000 5590000', 18).ok).toBe(false);
    expect(parsearVerticesUtm('', 18).ok).toBe(false);
  });
});
