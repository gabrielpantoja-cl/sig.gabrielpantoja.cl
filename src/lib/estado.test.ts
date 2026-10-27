import { describe, expect, it } from 'vitest';
import {
  barrasPorAnio,
  barrasPorRegion,
  escalaPorZoom,
  fechaChile,
  historialDiario,
  normalizarGrilla,
  radioCelda,
  resumirEstado,
  type Verificacion,
} from '@/lib/estado';

const AHORA = Date.parse('2026-10-26T15:00:00Z');

function fila(verificado_en: string, ok: boolean): Verificacion {
  return {
    verificado_en,
    ok,
    respaldo_fecha: null,
    referenciales: ok ? 100 : null,
    conservadores: null,
    comunas: null,
    ultimo_ingreso: null,
    anio_min: null,
    anio_max: null,
    por_anio: null,
    por_region: null,
  };
}

describe('resumirEstado', () => {
  it('sin filas es sin-datos', () => {
    expect(resumirEstado(null, AHORA).nivel).toBe('sin-datos');
    expect(resumirEstado([], AHORA).nivel).toBe('sin-datos');
  });

  it('una verificación exitosa reciente está al día', () => {
    const r = resumirEstado([fila('2026-10-26T07:30:00Z', true)], AHORA);
    expect(r.nivel).toBe('al-dia');
    expect(r.ultimaOk?.referenciales).toBe(100);
  });

  it('una falla reciente es falla, pero conserva la última exitosa', () => {
    const r = resumirEstado(
      [fila('2026-10-25T07:30:00Z', true), fila('2026-10-26T07:30:00Z', false)],
      AHORA,
    );
    expect(r.nivel).toBe('falla');
    expect(r.ultimaOk?.verificado_en).toBe('2026-10-25T07:30:00Z');
  });

  it('más de 30 h sin verificar es atrasado aunque la última fuera ok', () => {
    expect(resumirEstado([fila('2026-10-25T07:00:00Z', true)], AHORA).nivel).toBe('atrasado');
  });
});

describe('historialDiario', () => {
  it('usa la fecha de Chile, marca días sin registro y prefiere ok', () => {
    const h = historialDiario(
      [
        fila('2026-10-26T07:30:00Z', false),
        fila('2026-10-26T09:00:00Z', true),
        fila('2026-10-24T07:30:00Z', false),
      ],
      AHORA,
      3,
    );
    expect(h).toEqual([
      { fecha: '2026-10-24', estado: 'falla' },
      { fecha: '2026-10-25', estado: 'sin-registro' },
      { fecha: '2026-10-26', estado: 'ok' },
    ]);
  });

  it('02:00 UTC todavía es el día anterior en Chile', () => {
    expect(fechaChile(Date.parse('2026-10-26T02:00:00Z'))).toBe('2026-10-25');
  });
});

describe('barras', () => {
  it('agrupa los años antiguos en una sola barra', () => {
    expect(barrasPorAnio({ '2024': 5, '1994': 1, '2025': 7, '2010': 2 }, 2)).toEqual([
      { etiqueta: 'Antes de 2024', valor: 3 },
      { etiqueta: '2024', valor: 5 },
      { etiqueta: '2025', valor: 7 },
    ]);
  });

  it('no agrupa si hay pocos años', () => {
    expect(barrasPorAnio({ '2025': 7 }, 5)).toEqual([{ etiqueta: '2025', valor: 7 }]);
    expect(barrasPorAnio(null, 5)).toEqual([]);
  });

  it('ordena regiones de mayor a menor', () => {
    expect(barrasPorRegion({ Maule: 2, Aysén: 9, Ñuble: 2 }).map((b) => b.etiqueta)).toEqual([
      'Aysén',
      'Maule',
      'Ñuble',
    ]);
  });
});

describe('grilla del respaldo', () => {
  it('convierte [lat, lng, n] y descarta celdas inválidas', () => {
    expect(
      normalizarGrilla({
        total: 12,
        celdas: [
          [-45.5, -72.1, 10],
          ['-39.8', '-73.2', '2'],
          [-45.5, -72.1],
          [-95, -72, 3],
          [-33.4, -70.6, 0],
          'x',
        ],
      }),
    ).toEqual({
      total: 12,
      celdas: [
        { lat: -45.5, lng: -72.1, n: 10 },
        { lat: -39.8, lng: -73.2, n: 2 },
      ],
    });
  });

  it('una forma inesperada es null', () => {
    expect(normalizarGrilla(null)).toBeNull();
    expect(normalizarGrilla({ total: '5', celdas: [] })).toBeNull();
    expect(normalizarGrilla({ total: 5 })).toBeNull();
  });

  it('el radio crece con la raíz del conteo y respeta los topes', () => {
    expect(radioCelda(100, 100)).toBe(11);
    expect(radioCelda(25, 100)).toBeCloseTo(6.5);
    expect(radioCelda(0, 100)).toBe(2);
    expect(radioCelda(500, 100)).toBe(11);
    expect(radioCelda(5, 0)).toBe(2);
  });

  it('el radio se achica al alejar, con piso', () => {
    expect(escalaPorZoom(7)).toBe(1);
    expect(escalaPorZoom(10)).toBe(1);
    expect(escalaPorZoom(5)).toBe(0.5);
    expect(escalaPorZoom(1)).toBe(0.3);
  });
});
