import { describe, expect, it } from 'vitest';
import {
  PALETA_EXPOSICION,
  PALETA_PENDIENTE,
  PALETA_SOMBREADO,
  SOMBREADO_PLANO,
  indiceExposicion,
  indicePendiente,
  indiceSombreado,
  anchoBaldosa,
  baldosaDe,
  clasePendiente,
  esRelieveModo,
  exposicionGrados,
  formatoExposicion,
  formatoPendiente,
  gradienteHorn,
  nivelPara,
  pendienteGrados,
  pendientePct,
  rgbaSombreado,
  sectorExposicion,
  sombreado,
} from '@/lib/relieve';

/** Plano inclinado z = ax + by muestreado en una ventana 3 × 3 (fila 0 = norte). */
function plano(a: number, b: number, celda = 30): number[] {
  const z: number[] = [];
  for (let fila = -1; fila <= 1; fila++) {
    for (let col = -1; col <= 1; col++) z.push(a * col * celda + b * -fila * celda);
  }
  return z;
}

describe('gradiente de Horn', () => {
  it('recovers the slope of a tilted plane exactly', () => {
    const g = gradienteHorn(plano(0.1, 0), 30, 30);
    expect(g.dzdx).toBeCloseTo(0.1, 10);
    expect(g.dzdy).toBeCloseTo(0, 10);
    expect(pendientePct(g)).toBeCloseTo(10, 8);
    expect(pendienteGrados(g)).toBeCloseTo(5.7106, 3);
  });

  it('uses each axis cell size (longitude shrinks with latitude)', () => {
    const z = plano(0.2, 0, 23);
    expect(gradienteHorn(z, 23, 30).dzdx).toBeCloseTo(0.2, 10);
  });

  it('gives 45° for a 100 % slope', () => {
    expect(pendienteGrados(gradienteHorn(plano(0, 1), 30, 30))).toBeCloseTo(45, 8);
  });
});

describe('exposición', () => {
  it('points downhill', () => {
    // Sube hacia el este → la ladera mira al oeste.
    expect(exposicionGrados(gradienteHorn(plano(0.3, 0), 30, 30))).toBeCloseTo(270, 6);
    // Sube hacia el sur → mira al norte (la ladera soleada en Chile).
    expect(exposicionGrados(gradienteHorn(plano(0, -0.3), 30, 30))).toBeCloseTo(0, 6);
    expect(exposicionGrados(gradienteHorn(plano(0, 0.3), 30, 30))).toBeCloseTo(180, 6);
    expect(exposicionGrados({ dzdx: 0, dzdy: 0 })).toBeNull();
  });

  it('bins azimuths into eight sectors', () => {
    expect(sectorExposicion(0).sigla).toBe('N');
    expect(sectorExposicion(359).sigla).toBe('N');
    expect(sectorExposicion(22).sigla).toBe('N');
    expect(sectorExposicion(23).sigla).toBe('NE');
    expect(sectorExposicion(225).sigla).toBe('SO');
    expect(sectorExposicion(-90).sigla).toBe('O');
  });

  it('reads flat ground as having no aspect', () => {
    expect(formatoExposicion(10, 0.5)).toMatch(/^Plano/);
    expect(formatoExposicion(10, 12)).toBe('N · 10° (ladera que mira al norte)');
  });
});

describe('clases de pendiente (SAG 2011)', () => {
  it('uses the half-open ranges of the pauta', () => {
    expect(clasePendiente(0.5).clase).toBe('A');
    expect(clasePendiente(1).clase).toBe('B');
    expect(clasePendiente(14.9).clase).toBe('E');
    expect(clasePendiente(30).clase).toBe('G');
    expect(clasePendiente(45).clase).toBe('H');
    expect(clasePendiente(60).clase).toBe('I');
    expect(clasePendiente(250).clase).toBe('I');
  });

  it('formats slope in % and degrees', () => {
    expect(formatoPendiente(4.24, 2.43)).toBe('4,2 % (2,4°)');
    expect(formatoPendiente(52.4, 27.65)).toBe('52 % (27,7°)');
  });
});

describe('sombreado', () => {
  it('is neutral and transparent on flat ground', () => {
    const v = sombreado({ dzdx: 0, dzdy: 0 });
    expect(v).toBeCloseTo(SOMBREADO_PLANO, 10);
    expect(rgbaSombreado(v)[3]).toBe(0);
  });

  it('lights slopes facing the northwest and darkens the opposite ones', () => {
    // Ladera que mira al NO: sube hacia el SE (dzdx > 0, dzdy < 0).
    const alSol = sombreado({ dzdx: 0.5, dzdy: -0.5 });
    const enSombra = sombreado({ dzdx: -0.5, dzdy: 0.5 });
    expect(alSol).toBeGreaterThan(SOMBREADO_PLANO);
    expect(enSombra).toBeLessThan(SOMBREADO_PLANO);
    expect(rgbaSombreado(enSombra)[0]).toBeLessThan(50);
    expect(rgbaSombreado(alSol)[0]).toBeGreaterThan(200);
  });

  it('exaggeration deepens shadows without changing the flat value', () => {
    const g = { dzdx: -0.1, dzdy: 0.1 };
    expect(sombreado(g, 2)).toBeLessThan(sombreado(g, 1));
    expect(sombreado({ dzdx: 0, dzdy: 0 }, 3)).toBeCloseTo(SOMBREADO_PLANO, 10);
  });
});

describe('baldosas Copernicus', () => {
  it('names a tile by its south-west corner', () => {
    expect(baldosaDe(-39.83, -73.24)).toEqual({
      nombre: 'Copernicus_DSM_COG_10_S40_00_W074_00_DEM', latSur: -40, lngOeste: -74,
    });
    expect(baldosaDe(-33.45, -70.66).nombre).toBe('Copernicus_DSM_COG_10_S34_00_W071_00_DEM');
  });

  it('narrows longitude spacing beyond 50° (Aysén sur, Magallanes)', () => {
    expect(anchoBaldosa(-40)).toBe(3600);
    expect(anchoBaldosa(-50)).toBe(3600); // cubre -50..-49
    expect(anchoBaldosa(-51)).toBe(2400); // cubre -51..-50
    expect(anchoBaldosa(-54)).toBe(2400);
  });

  it('picks the coarsest pyramid level not coarser than the output pixel', () => {
    expect(nivelPara(10)).toBe(0);
    expect(nivelPara(40)).toBe(0);
    expect(nivelPara(62)).toBe(1);
    expect(nivelPara(130)).toBe(2);
    expect(nivelPara(5000)).toBe(3);
  });
});

describe('modos', () => {
  it('validates mode names from URLs', () => {
    expect(esRelieveModo('pendiente')).toBe(true);
    expect(esRelieveModo('<script>')).toBe(false);
    expect(esRelieveModo(undefined)).toBe(false);
  });
});

describe('paletas indexadas', () => {
  it('keep every index inside its palette', () => {
    for (let v = 0; v <= 1; v += 0.01) {
      const i = indiceSombreado(v);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(PALETA_SOMBREADO.length);
    }
    for (const pct of [0, 0.5, 4, 29.9, 45, 60, 300]) {
      expect(indicePendiente(pct)).toBeLessThan(PALETA_PENDIENTE.length);
    }
    for (const az of [0, 44, 180, 359.9]) {
      for (const pct of [0, 3, 5, 8, 50]) expect(indiceExposicion(az, pct)).toBeLessThan(PALETA_EXPOSICION.length);
    }
  });

  it('maps flat ground to the transparent entry and slopes to their class colour', () => {
    expect(indiceSombreado(SOMBREADO_PLANO)).toBe(0);
    expect(PALETA_PENDIENTE[indicePendiente(50)]).toEqual([215, 48, 39, 255]);
    expect(PALETA_EXPOSICION[indiceExposicion(10, 0.5)][3]).toBe(80);
  });

  it('fades aspect on gentle slopes', () => {
    const alfa = (pct: number) => PALETA_EXPOSICION[indiceExposicion(90, pct)][3];
    expect(alfa(3)).toBeLessThan(alfa(5));
    expect(alfa(5)).toBeLessThan(alfa(20));
    expect(alfa(20)).toBe(255);
  });
});
