import { describe, expect, it } from 'vitest';
import type { Geometry } from 'geojson';
import { mensajeFalla, pointInGeometry } from '@/lib/consulta-punto';
import { buildConsultaPuntoPopup, buildPropiedadRuralResult, buildSuelosResult } from '@/lib/map-popups';

const XSS = '<img src=x onerror=alert(1)>';

/** Cuadrado de 0..10 con un hueco de 4..6 (coordenadas [lng, lat]). */
const donut: Geometry = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};

describe('pointInGeometry', () => {
  it('finds points inside the exterior and outside the holes', () => {
    expect(pointInGeometry(2, 2, donut)).toBe(true);
    expect(pointInGeometry(5, 5, donut)).toBe(false); // en el hueco
    expect(pointInGeometry(11, 5, donut)).toBe(false);
  });

  it('handles MultiPolygon and ignores lines and points', () => {
    const multi: Geometry = {
      type: 'MultiPolygon',
      coordinates: [donut.coordinates as never, [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]],
    };
    expect(pointInGeometry(25, 25, multi)).toBe(true);
    expect(pointInGeometry(15, 15, multi)).toBe(false);
    expect(pointInGeometry(1, 1, { type: 'LineString', coordinates: [[0, 0], [2, 2]] })).toBe(false);
    expect(pointInGeometry(1, 1, null)).toBe(false);
  });

  it('works with real Chilean coordinates (negative lng/lat)', () => {
    const valdivia: Geometry = {
      type: 'Polygon',
      coordinates: [[[-73.3, -39.9], [-73.2, -39.9], [-73.2, -39.8], [-73.3, -39.8], [-73.3, -39.9]]],
    };
    expect(pointInGeometry(-73.2387, -39.8507, valdivia)).toBe(true);
    expect(pointInGeometry(-73.1, -39.85, valdivia)).toBe(false);
  });
});

describe('mensajeFalla', () => {
  it('does not blame the agency for our own rate limit', () => {
    expect(mensajeFalla(429, 'MMA · SIMBIO_HUMEDALES')).toContain('Demasiadas consultas');
    expect(mensajeFalla(429, 'MMA · SIMBIO_HUMEDALES')).not.toContain('MMA');
    expect(mensajeFalla(502, 'MMA · SIMBIO_HUMEDALES')).toContain('No responde MMA');
  });
});

describe('buildConsultaPuntoPopup', () => {
  const coords = { latitud: '-39,85067°', longitud: '-73,23874°', utm: 'UTM 18S  E 650.927  N 5.586.259' };

  it('renders every section state, with coordinates on top', () => {
    const html = buildConsultaPuntoPopup(coords, [
      { id: 'a', titulo: 'Humedales · MMA', estado: 'cargando' },
      { id: 'b', titulo: 'Suelos', estado: 'listo', html: '<b>Clase VI</b>' },
      { id: 'c', titulo: 'Comuna', estado: 'vacio', mensaje: 'Fuera de los límites comunales.' },
      { id: 'd', titulo: 'CONAF', estado: 'error', mensaje: 'No responde CONAF.' },
    ]);
    expect(html.indexOf('UTM 18S')).toBeLessThan(html.indexOf('Humedales'));
    expect(html).toContain('Consultando…');
    expect(html).toContain('<b>Clase VI</b>');
    expect(html).toContain('Fuera de los límites comunales.');
    expect(html).toContain('No responde CONAF.');
  });

  it('escapes titles and messages (only `listo` html is trusted)', () => {
    const html = buildConsultaPuntoPopup(coords, [
      { id: 'x', titulo: XSS, estado: 'vacio', mensaje: XSS },
    ]);
    expect(html).not.toContain('<img');
  });

  it('escapes the remote-layer section builders', () => {
    expect(buildSuelosResult(XSS, XSS)).not.toContain('<img');
    expect(buildPropiedadRuralResult({ rol: XSS, comuna: XSS })).not.toContain('<img');
  });
});
