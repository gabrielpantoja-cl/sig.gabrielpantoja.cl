import { describe, expect, it } from 'vitest';
import { formatoGms, lecturaCursor, lonLatToUtm, zonaUtm } from './coordenadas';

describe('lonLatToUtm', () => {
  it('pone el meridiano central en E 500.000', () => {
    const [e] = lonLatToUtm(-69, -33, 19);
    expect(e).toBeCloseTo(500000, 3);
  });

  it('da la norte del paralelo 45° S según el arco meridiano WGS84', () => {
    // Arco meridiano a 45°: 4.984.944,378 m; × k0 0,9996 y falso norte 10^7.
    const [, n] = lonLatToUtm(-69, -45, 19);
    expect(n).toBeCloseTo(10000000 - 0.9996 * 4984944.378, 0);
  });

  it('es simétrico respecto del meridiano central', () => {
    const [eOeste] = lonLatToUtm(-70, -40, 19);
    const [eEste] = lonLatToUtm(-68, -40, 19);
    expect(eOeste + eEste).toBeCloseTo(1000000, 3);
  });
});

describe('zonaUtm', () => {
  it('ubica Chile continental en las zonas 18 y 19', () => {
    expect(zonaUtm(-73.24)).toBe(18); // Valdivia
    expect(zonaUtm(-70.65)).toBe(19); // Santiago
    expect(zonaUtm(-72)).toBe(19); // borde exacto: empieza la 19
  });
});

describe('formato', () => {
  it('escribe grados, minutos y segundos con hemisferio', () => {
    expect(formatoGms(-39.81421, 'lat')).toBe(`39°48'51,2" S`);
    expect(formatoGms(-73.25, 'lon')).toBe(`73°15'00,0" O`);
  });

  it('no deja 60 segundos al redondear', () => {
    expect(formatoGms(-33.9999999, 'lat')).toBe(`34°00'00,0" S`);
  });

  it('arma la lectura completa del cursor', () => {
    const l = lecturaCursor(-39.81421, -73.24589);
    expect(l.latitud).toBe('-39,81421°');
    expect(l.longitud).toBe('-73,24589°');
    expect(l.utm).toMatch(/^UTM 18S {2}E \d{3}\.\d{3} {2}N \d\.\d{3}\.\d{3}$/);
  });
});
