import { describe, expect, it } from 'vitest';
import {
  MAX_SUPERFICIE_HA,
  MAX_VERTICES,
  RADIO_DEFAULT_M,
  RADIO_MAX_M,
  RADIO_MIN_M,
  holguraGrados,
  parseRadioM,
  poligonoDeFeatures,
  poligonoDesdeVertices,
  validarPoligono,
  type Posicion,
} from '@/lib/analisis-predio';
import { distanciaM } from '@/lib/medicion';

/** Cuadrado de `ladoM` metros cerca de Valdivia (anillo cerrado, lng/lat). */
function cuadrado(ladoM: number, lat = -39.82, lng = -73.24): Posicion[] {
  const dLat = ladoM / 111_195;
  const dLng = ladoM / (111_195 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng, lat],
    [lng + dLng, lat],
    [lng + dLng, lat + dLat],
    [lng, lat + dLat],
    [lng, lat],
  ];
}

describe('validarPoligono', () => {
  it('accepts a Polygon and measures it on the sphere', () => {
    const r = validarPoligono({ type: 'Polygon', coordinates: [cuadrado(1000)] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.superficieHa).toBeCloseTo(100, 0);
    expect(r.vertices).toBe(4);
    expect(r.geometry.type).toBe('Polygon');
  });

  it('unwraps a Feature and closes an open ring', () => {
    const abierto = cuadrado(500).slice(0, -1);
    const r = validarPoligono({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [abierto] } });
    expect(r.ok).toBe(true);
    if (!r.ok || r.geometry.type !== 'Polygon') return;
    const ring = r.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('drops the Z coordinate that KML exports carry', () => {
    const conZ = cuadrado(500).map(([x, y]) => [x, y, 12]);
    const r = validarPoligono({ type: 'Polygon', coordinates: [conZ] });
    expect(r.ok).toBe(true);
    if (!r.ok || r.geometry.type !== 'Polygon') return;
    expect(r.geometry.coordinates[0][0]).toHaveLength(2);
  });

  it('subtracts holes from the surface', () => {
    const r = validarPoligono({ type: 'Polygon', coordinates: [cuadrado(1000), cuadrado(500, -39.818, -73.238)] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.superficieHa).toBeCloseTo(75, 0);
  });

  it('sums the parts of a MultiPolygon', () => {
    const r = validarPoligono({
      type: 'MultiPolygon',
      coordinates: [[cuadrado(1000)], [cuadrado(1000, -39.9, -73.3)]],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.superficieHa).toBeCloseTo(200, 0);
  });

  it('rejects anything that is not a polygon', () => {
    expect(validarPoligono(null).ok).toBe(false);
    expect(validarPoligono({ type: 'Point', coordinates: [-73, -39] }).ok).toBe(false);
    expect(validarPoligono({ type: 'LineString', coordinates: cuadrado(100) }).ok).toBe(false);
    expect(validarPoligono({ type: 'Polygon', coordinates: [] }).ok).toBe(false);
    expect(validarPoligono({ type: 'Polygon', coordinates: [[]] }).ok).toBe(false);
    expect(validarPoligono({ type: 'Polygon', coordinates: [[[-73, -39], [-73.1, -39]]] }).ok).toBe(false);
    expect(validarPoligono({ type: 'Polygon', coordinates: [[['-73', -39], [-73.1, -39], [-73.1, -39.1]]] }).ok).toBe(false);
  });

  it('rejects swapped lat/lng and points outside Chile', () => {
    const invertido = cuadrado(1000).map(([x, y]) => [y, x]);
    const r = validarPoligono({ type: 'Polygon', coordinates: [invertido] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/fuera de Chile/);
    expect(validarPoligono({ type: 'Polygon', coordinates: [cuadrado(1000, 40, -3)] }).ok).toBe(false);
  });

  it('accepts Rapa Nui', () => {
    expect(validarPoligono({ type: 'Polygon', coordinates: [cuadrado(1000, -27.12, -109.35)] }).ok).toBe(true);
  });

  it('rejects a degenerate ring with no surface', () => {
    // Ida y vuelta sobre un meridiano: tres vértices, cero superficie.
    const linea: Posicion[] = [[-73.2, -39.8], [-73.2, -39.7], [-73.2, -39.6], [-73.2, -39.8]];
    expect(validarPoligono({ type: 'Polygon', coordinates: [linea] }).ok).toBe(false);
  });

  it('caps vertices and surface', () => {
    const muchos: Posicion[] = Array.from({ length: MAX_VERTICES + 1 }, (_, i) => {
      const a = (2 * Math.PI * i) / (MAX_VERTICES + 1);
      return [-73.24 + 0.01 * Math.cos(a), -39.82 + 0.01 * Math.sin(a)];
    });
    muchos.push(muchos[0]);
    expect(validarPoligono({ type: 'Polygon', coordinates: [muchos] }).ok).toBe(false);

    const lado = Math.sqrt(MAX_SUPERFICIE_HA * 10_000) * 1.1;
    const r = validarPoligono({ type: 'Polygon', coordinates: [cuadrado(lado)] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ha/);
  });
});

describe('poligonoDesdeVertices', () => {
  it('closes the ring of the measure tool in lng/lat order', () => {
    const g = poligonoDesdeVertices([
      { lat: -39.8, lng: -73.2 },
      { lat: -39.8, lng: -73.1 },
      { lat: -39.7, lng: -73.1 },
    ]);
    expect(g).toEqual({
      type: 'Polygon',
      coordinates: [[[-73.2, -39.8], [-73.1, -39.8], [-73.1, -39.7], [-73.2, -39.8]]],
    });
    expect(validarPoligono(g).ok).toBe(true);
  });
});

describe('parseRadioM', () => {
  it('defaults and clamps', () => {
    expect(parseRadioM(null)).toBe(RADIO_DEFAULT_M);
    expect(parseRadioM('')).toBe(RADIO_DEFAULT_M);
    expect(parseRadioM('abc')).toBe(RADIO_DEFAULT_M);
    expect(parseRadioM('10')).toBe(RADIO_MIN_M);
    expect(parseRadioM('999999')).toBe(RADIO_MAX_M);
    expect(parseRadioM('2500.4')).toBe(2500);
  });
});

describe('holguraGrados', () => {
  it('never excludes a point the exact radius would accept', () => {
    // Punto a exactamente `radio` al este y al norte del vértice más austral.
    for (const lat of [-18.5, -39.8, -53.2, -55.9]) {
      const radio = 20_000;
      const g = { type: 'Polygon' as const, coordinates: [cuadrado(100, lat)] };
      const { dLng, dLat } = holguraGrados(g, radio);
      const [lng0, lat0] = g.coordinates[0][0];
      const este = { lat: lat0, lng: lng0 + dLng };
      const norte = { lat: lat0 + dLat, lng: lng0 };
      expect(distanciaM({ lat: lat0, lng: lng0 }, este)).toBeGreaterThanOrEqual(radio);
      expect(distanciaM({ lat: lat0, lng: lng0 }, norte)).toBeGreaterThanOrEqual(radio);
    }
  });
});

describe('poligonoDeFeatures', () => {
  it('keeps only polygons and merges several into a MultiPolygon', () => {
    const fc = {
      features: [
        { geometry: { type: 'Point', coordinates: [-73.2, -39.8] } },
        { geometry: { type: 'Polygon', coordinates: [cuadrado(100)] } },
        { geometry: { type: 'LineString', coordinates: cuadrado(100) } },
        { geometry: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', coordinates: [cuadrado(50)] }] } },
        { geometry: null },
      ],
    };
    const g = poligonoDeFeatures(fc);
    expect(g?.type).toBe('MultiPolygon');
    if (g?.type === 'MultiPolygon') expect(g.coordinates).toHaveLength(2);
    expect(validarPoligono(g).ok).toBe(true);
  });

  it('returns a plain Polygon for one feature and null for none', () => {
    expect(poligonoDeFeatures({ features: [{ geometry: { type: 'Polygon', coordinates: [cuadrado(100)] } }] })?.type).toBe('Polygon');
    expect(poligonoDeFeatures({ features: [{ geometry: { type: 'Point', coordinates: [-73, -39] } }] })).toBeNull();
  });
});
