import { describe, expect, it } from 'vitest';
import { comparablesACsv, fichaAGeoJson } from '@/lib/ficha-export';
import type { Comparable, FichaPredio, PoligonoGeoJson } from '@/lib/analisis-predio';

const geometry: PoligonoGeoJson = {
  type: 'Polygon',
  coordinates: [[[-72.08, -45.58], [-72.05, -45.58], [-72.05, -45.56], [-72.08, -45.58]]],
};

const comparable = (over: Partial<Comparable> = {}): Comparable => ({
  lat: -45.57, lng: -72.06, monto: 50_000_000, montoUf: 1300, anio: 2022, comuna: 'Coyhaique',
  predio: 'Lote 3; sector "El Claro"', superficie: 5000, rol: '261-101', destino: 'A',
  fechaEscritura: '2022-03-01', fechaInscripcion: '2022-04-11', fojas: '123', numero: 45,
  conservador: 'Coyhaique', distanciaM: 812.6, ...over,
});

const ficha = (puntos: Comparable[]): FichaPredio => ({
  superficieHa: 189.31234,
  perimetroM: 5579.94,
  centroide: { lat: -45.57, lng: -72.06 },
  comunas: { estado: 'ok', datos: [{ cut: '11101', comuna: 'Coyhaique', provincia: 'Coyhaique', region: 'Aysén', ha: 189.3, pct: 100 }] },
  limiteUrbano: { estado: 'sin-capa' },
  areasProtegidas: { estado: 'ok', datos: { areas: [], masCercana: { nombre: 'RN Coyhaique', designacion: 'Reserva Nacional', distanciaM: 2345.6 } } },
  comparables: {
    estado: 'ok',
    datos: { radioM: 5000, porDestino: [], puntos, total: puntos.length },
  },
  fuentes: [{ capa: 'comunas', fuente: 'SUBDERE DPA 2023', licencia: null, descargado: '2026-10-26', cargado: null }],
});

describe('fichaAGeoJson', () => {
  it('puts the parcel first with the summary and the comparables as points', () => {
    const fc = fichaAGeoJson(geometry, ficha([comparable()]), 'Polígono dibujado', new Date('2026-10-26T12:00:00Z'));
    expect(fc.features).toHaveLength(2);
    const [predio, punto] = fc.features;
    expect(predio.geometry).toBe(geometry);
    expect(predio.properties).toMatchObject({
      tipo: 'predio',
      origen: 'Polígono dibujado',
      generado: '2026-10-26T12:00:00.000Z',
      superficie_ha: 189.3123,
      comunas: 'Coyhaique',
      urbano_pct: null,
      area_protegida_mas_cercana_m: 2346,
      comparables_total: 1,
    });
    expect(punto.geometry).toEqual({ type: 'Point', coordinates: [-72.06, -45.57] });
    expect(punto.properties).toMatchObject({ tipo: 'comparable', rol: '261-101', distancia_m: 813 });
    expect(punto.properties).not.toHaveProperty('lat');
  });
});

describe('comparablesACsv', () => {
  it('writes a BOM, semicolons, Chilean decimals and quoted text', () => {
    const csv = comparablesACsv(ficha([comparable()]));
    expect(csv.startsWith('﻿distancia_m;destino;')).toBe(true);
    const [, fila] = csv.trim().split('\r\n');
    expect(fila).toContain('"Lote 3; sector ""El Claro"""');
    expect(fila).toContain(';10000;'); // $/m² = 50.000.000 / 5.000
    expect(fila).toContain('-45,57');
  });

  it('neutralises spreadsheet formulas in text fields', () => {
    const csv = comparablesACsv(ficha([comparable({ predio: '=HYPERLINK("x")' })]));
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('leaves $/m² empty without amount or surface, and is just a header with no comparables', () => {
    expect(comparablesACsv(ficha([comparable({ monto: null })])).split('\r\n')[1]).toMatch(/;;Coyhaique;/);
    expect(comparablesACsv(ficha([])).trim().split('\r\n')).toHaveLength(1);
  });
});
