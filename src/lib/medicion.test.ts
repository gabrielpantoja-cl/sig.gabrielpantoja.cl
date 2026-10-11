import { describe, expect, it } from 'vitest';
import {
  denominadorEscala,
  distanciaM,
  formatoDistancia,
  formatoEscala,
  formatoSuperficie,
  longitudM,
  redondearEscala,
  resumenMedicion,
  superficieM2,
} from '@/lib/medicion';

describe('escala numérica', () => {
  it('matches the 96 dpi convention at the equator', () => {
    // z0 en el ecuador: 156.543 m por píxel CSS → ~1:591.657.528 (tabla de ArcGIS/OSM).
    expect(denominadorEscala(0, 0) / 591_657_527.6).toBeCloseTo(1, 5);
  });

  it('shrinks with latitude (Valdivia, z15 ≈ 1:14.000)', () => {
    expect(formatoEscala(-39.81, 15)).toBe('1:14.000');
  });

  it('rounds to two significant figures', () => {
    expect(redondearEscala(23_456)).toBe(23_000);
    expect(redondearEscala(1_234_567)).toBe(1_200_000);
    expect(redondearEscala(87)).toBe(87);
    expect(redondearEscala(Number.NaN)).toBe(0);
    expect(redondearEscala(-5)).toBe(0);
  });
});

describe('distancias', () => {
  it('measures one degree of meridian (~111,2 km)', () => {
    expect(distanciaM({ lat: -40, lng: -73 }, { lat: -41, lng: -73 })).toBeCloseTo(111_195, -1);
  });

  it('sums a polyline and optionally closes it', () => {
    const tramo = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }];
    const abierto = longitudM(tramo);
    expect(abierto).toBeCloseTo(2 * 1111.95, 0);
    expect(longitudM(tramo, true)).toBeCloseTo(abierto + 1572.5, 0);
    expect(longitudM([])).toBe(0);
  });
});

describe('superficies', () => {
  it('measures a ~1 ha square near Valdivia within 0.5 %', () => {
    // 100 m × 100 m: 100 m de latitud = 0,000899°; de longitud a -39,8° se escala por cos(lat).
    const dLat = 100 / 111_195;
    const dLng = dLat / Math.cos((-39.8 * Math.PI) / 180);
    const cuadrado = [
      { lat: -39.8, lng: -73.2 },
      { lat: -39.8, lng: -73.2 + dLng },
      { lat: -39.8 + dLat, lng: -73.2 + dLng },
      { lat: -39.8 + dLat, lng: -73.2 },
    ];
    expect(superficieM2(cuadrado)).toBeGreaterThan(9950);
    expect(superficieM2(cuadrado)).toBeLessThan(10_050);
    // El sentido de giro no cambia la superficie.
    expect(superficieM2([...cuadrado].reverse())).toBeCloseTo(superficieM2(cuadrado), 6);
  });

  it('is zero below three vertices', () => {
    expect(superficieM2([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }])).toBe(0);
  });
});

describe('formato', () => {
  it('reads distances in Chilean format', () => {
    expect(formatoDistancia(12.44)).toBe('12,4 m');
    expect(formatoDistancia(845.2)).toBe('845 m');
    expect(formatoDistancia(3272)).toBe('3,27 km');
    expect(formatoDistancia(123_456)).toBe('123,5 km');
    expect(formatoDistancia(Number.NaN)).toBe('—');
  });

  it('reads surfaces the way deeds do', () => {
    expect(formatoSuperficie(8450.4)).toBe('8.450 m²');
    expect(formatoSuperficie(123_456)).toBe('12,35 ha (123.456 m²)');
    expect(formatoSuperficie(5_000_000)).toBe('500,0 ha');
    expect(formatoSuperficie(2_500_000_000)).toBe('2.500 km²');
    expect(formatoSuperficie(-1)).toBe('—');
  });

  it('summarises a measurement per mode', () => {
    const linea = [{ lat: -40, lng: -73 }, { lat: -41, lng: -73 }];
    expect(resumenMedicion('distancia', linea)).toBe('111,2 km');
    // Superficie con dos vértices todavía es solo un tramo.
    expect(resumenMedicion('superficie', linea)).toBe('111,2 km');
    const triangulo = [...linea, { lat: -40, lng: -72 }];
    expect(resumenMedicion('superficie', triangulo)).toMatch(/km² · perímetro .* km$/);
  });
});
