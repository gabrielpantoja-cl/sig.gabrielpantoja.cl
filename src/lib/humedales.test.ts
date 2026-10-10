import { describe, expect, it } from 'vitest';
import { canonicalHumedal, normalizedAlias, parseChileanNumber } from '@/lib/humedales-proxy';
import { humedalClassColor, HUMEDALES_CLASSES } from '@/lib/humedales';
import { buildHumedalesPopup } from '@/lib/map-popups';

const XSS = '<img src=x onerror=alert(1)>';

/** Respuesta real de `identify` sobre el humedal Angachilla (Valdivia), 2026-10-10. */
const INVENTARIO = {
  layerId: 0,
  attributes: {
    OBJECTID: '589821',
    COD_HUMEDA: 'HUR-14-65-P02',
    'Nombre Humedal': 'Humedal Angachilla',
    'Nombre Humedal Master': 'Humedal Angachilla',
    'ORDEN 1': 'CONTINENTALES',
    'ORDEN 2': 'PALUSTRES',
    'ORDEN 3': 'EMERGENTES',
    'ORDEN 4': 'PERMANENTES',
    'ORDEN 5': 'PERMANENTES',
    'Hectáreas, ha': '124,130663',
    'Hectáreas Límite Urbano': '110,16879',
    Shape: 'Polygon',
    'URL Ficha SIMBIO': 'Null',
    'Código Humedal Master': 'HUR-14-65',
  },
};

const URBANO = {
  layerId: 1,
  attributes: {
    'Código Humedal Urbano Declarado': 'HU-0050',
    'Nombre del humedal': 'Angachilla, Estero Catrico',
    Comuna: 'VALDIVIA',
    Provincia: 'VALDIVIA',
    'Región': 'REGIÓN DE LOS RÍOS',
    'Superficie (ha)': '126,089748',
    Proceso: 'De Oficio',
    'Resolución Exenta': 'RE N° 1337/ 2021',
    'Enlace Resolución Exenta': 'http://bcn.cl/2ud22',
    'Object ID': '21',
    'Enlace Expediente': 'https://sistemahumedales.mma.gob.cl/OficioHU/DetailsPublico/20',
    Shape: 'Polygon',
  },
};

describe('parseChileanNumber', () => {
  it('reads comma decimals, thousand dots and plain numbers', () => {
    expect(parseChileanNumber('124,130663')).toBeCloseTo(124.130663);
    expect(parseChileanNumber('1.234,5')).toBe(1234.5);
    expect(parseChileanNumber('124.13')).toBe(124.13);
    expect(parseChileanNumber(42)).toBe(42);
  });

  it('returns null for empty, "Null" and garbage', () => {
    expect(parseChileanNumber('')).toBeNull();
    expect(parseChileanNumber('Null')).toBeNull();
    expect(parseChileanNumber('abc')).toBeNull();
    expect(parseChileanNumber(undefined)).toBeNull();
  });
});

describe('canonicalHumedal', () => {
  it('maps inventory aliases to stable fields', () => {
    const result = canonicalHumedal(INVENTARIO);
    expect(result?.kind).toBe('inventario');
    if (result?.kind !== 'inventario') return;
    expect(result.attributes).toMatchObject({
      codigo: 'HUR-14-65-P02',
      nombre: 'Humedal Angachilla',
      orden1: 'CONTINENTALES',
      orden2: 'PALUSTRES',
      hectareas: expect.closeTo(124.13, 2),
      hectareasUrbanas: expect.closeTo(110.17, 2),
      urlFicha: null,
    });
  });

  it('maps declared urban wetland aliases (accented keys included)', () => {
    const result = canonicalHumedal(URBANO);
    expect(result?.kind).toBe('urbano');
    if (result?.kind !== 'urbano') return;
    expect(result.attributes).toMatchObject({
      codigo: 'HU-0050',
      region: 'REGIÓN DE LOS RÍOS',
      resolucion: 'RE N° 1337/ 2021',
      urlResolucion: 'http://bcn.cl/2ud22',
      hectareas: expect.closeTo(126.09, 2),
    });
  });

  it('drops fields it does not know and layers it does not serve', () => {
    const result = canonicalHumedal({ layerId: 0, attributes: { Propietario: 'Juan', 'Nombre Humedal': 'X' } });
    expect(Object.keys(result!.attributes)).not.toContain('Propietario');
    expect(JSON.stringify(result)).not.toContain('Juan');
    expect(canonicalHumedal({ layerId: 7, attributes: {} })).toBeNull();
  });

  it('normalizes aliases without accents or punctuation', () => {
    expect(normalizedAlias('Hectáreas, ha')).toBe('hectareas ha');
    expect(normalizedAlias('Resolución Exenta')).toBe('resolucion exenta');
  });
});

describe('humedalClassColor', () => {
  it('matches the upper-case ORDEN_1 that identify returns', () => {
    expect(humedalClassColor('CONTINENTALES')).toBe(HUMEDALES_CLASSES[0].color);
    expect(humedalClassColor('MARINOS Y COSTEROS')).toBe(HUMEDALES_CLASSES[2].color);
  });
});

describe('buildHumedalesPopup', () => {
  it('shows the declaration first with its resolution link', () => {
    const html = buildHumedalesPopup([canonicalHumedal(URBANO)!, canonicalHumedal(INVENTARIO)!]);
    expect(html.indexOf('Ley 21.202')).toBeLessThan(html.indexOf('Inventario Nacional'));
    expect(html).toContain('href="http://bcn.cl/2ud22"');
    expect(html).toContain('Humedal Angachilla');
  });

  it('escapes data and refuses non-http links', () => {
    const urbano = canonicalHumedal(URBANO)!;
    if (urbano.kind !== 'urbano') throw new Error('expected urbano');
    urbano.attributes.nombre = XSS;
    urbano.attributes.urlExpediente = 'javascript:alert(1)';
    const html = buildHumedalesPopup([urbano]);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
  });
});
