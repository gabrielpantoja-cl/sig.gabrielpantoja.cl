import { describe, expect, it } from 'vitest';
import {
  alternarAnio,
  anioEnRango,
  aniosDisponibles,
  cambiarExtremo,
  etiquetaAnios,
  hayFiltroAnios,
  totalEnRango,
} from '@/lib/anios';

const facets = {
  Coyhaique: { '2012': 617, '2016': 1151, '2025': 1033 },
  Valdivia: { '2016': 3, '2025': 1103 },
  Rara: { '1994': 2 },
};

describe('aniosDisponibles', () => {
  it('uses the selected comuna only', () => {
    expect(aniosDisponibles(facets, 'Coyhaique').map((a) => a.anio)).toEqual([2012, 2016, 2025]);
  });

  it('sums every comuna for «todas», without filling gaps', () => {
    expect(aniosDisponibles(facets, 'todas')).toEqual([
      { anio: 1994, n: 2 },
      { anio: 2012, n: 617 },
      { anio: 2016, n: 1154 },
      { anio: 2025, n: 2136 },
    ]);
  });

  it('returns nothing for an unknown comuna or missing facets', () => {
    expect(aniosDisponibles(facets, 'Nada')).toEqual([]);
    expect(aniosDisponibles(undefined, 'todas')).toEqual([]);
  });
});

describe('cambiarExtremo', () => {
  it('drags the other end when the range would invert', () => {
    expect(cambiarExtremo({ desde: null, hasta: 2016 }, 'desde', 2020)).toEqual({ desde: 2020, hasta: 2020 });
    expect(cambiarExtremo({ desde: 2020, hasta: null }, 'hasta', 2016)).toEqual({ desde: 2016, hasta: 2016 });
  });

  it('clears one end without touching the other', () => {
    expect(cambiarExtremo({ desde: 2016, hasta: 2020 }, 'desde', null)).toEqual({ desde: null, hasta: 2020 });
  });
});

describe('alternarAnio', () => {
  it('selects a single year and toggles it off', () => {
    const r = alternarAnio({ desde: null, hasta: null }, 2016);
    expect(r).toEqual({ desde: 2016, hasta: 2016 });
    expect(alternarAnio(r, 2016)).toEqual({ desde: null, hasta: null });
  });

  it('replaces the range on a plain click and extends it with shift', () => {
    expect(alternarAnio({ desde: 2016, hasta: 2016 }, 2020)).toEqual({ desde: 2020, hasta: 2020 });
    expect(alternarAnio({ desde: 2016, hasta: 2016 }, 2020, true)).toEqual({ desde: 2016, hasta: 2020 });
    expect(alternarAnio({ desde: 2016, hasta: 2016 }, 2012, true)).toEqual({ desde: 2012, hasta: 2016 });
    expect(alternarAnio({ desde: null, hasta: null }, 2012, true)).toEqual({ desde: 2012, hasta: 2012 });
  });
});

describe('labels and totals', () => {
  it('describes the range', () => {
    expect(etiquetaAnios({ desde: 2016, hasta: 2016 })).toBe('2016');
    expect(etiquetaAnios({ desde: 2016, hasta: 2020 })).toBe('2016–2020');
    expect(etiquetaAnios({ desde: 2016, hasta: null })).toBe('desde 2016');
    expect(etiquetaAnios({ desde: null, hasta: 2020 })).toBe('hasta 2020');
    expect(etiquetaAnios({ desde: null, hasta: null })).toBe('');
    expect(hayFiltroAnios({ desde: null, hasta: null })).toBe(false);
    expect(hayFiltroAnios({ desde: null, hasta: 2020 })).toBe(true);
  });

  it('counts inside the range, open ends included', () => {
    const anios = aniosDisponibles(facets, 'Coyhaique');
    expect(totalEnRango(anios, { desde: 2016, hasta: null })).toBe(2184);
    expect(totalEnRango(anios, { desde: null, hasta: null })).toBe(2801);
    expect(anioEnRango({ desde: 2013, hasta: 2016 }, 2012)).toBe(false);
  });
});
