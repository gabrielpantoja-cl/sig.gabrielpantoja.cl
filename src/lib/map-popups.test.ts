import { describe, expect, it } from 'vitest';
import {
  buildKmlPopup,
  buildPopup,
  formatMontoInformado,
  buildProtectedPopup,
  buildRedVialPopup,
  esc,
  formatDateCL,
  safeHref,
  buildRelieveResult,
  buildConservadorPopup,
} from '@/lib/map-popups';
import type { Conservador } from '@/lib/types';
import type { MapPoint } from '@/lib/types';
import type { KmlLayer } from '@/lib/kml';
import type { ProtectedAreaProps } from '@/lib/protected-areas';
import type { RedVialProps } from '@/lib/red-vial';

const XSS = '<img src=x onerror=alert(1)>';

describe('esc', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
    expect(esc(null)).toBe('');
  });
});

describe('safeHref', () => {
  it('keeps http(s) links', () => {
    expect(safeHref('https://simbio.mma.gob.cl/ficha/1')).toBe('https://simbio.mma.gob.cl/ficha/1');
    expect(safeHref(' http://example.cl ')).toBe('http://example.cl/');
  });

  it('drops script, data and relative URLs', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHref('/relative')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});

describe('formatDateCL', () => {
  it('reformats a calendar date without timezone shifts', () => {
    expect(formatDateCL('2024-01-01')).toBe('01/01/2024');
    expect(formatDateCL('2024-01-01T00:00:00Z')).toBe('01/01/2024');
    expect(formatDateCL('01-01-2024')).toBe('');
    expect(formatDateCL(null)).toBe('');
  });
});

describe('formatMontoInformado', () => {
  it('shows pesos when monto is informed, with UF as secondary line', () => {
    const r = formatMontoInformado(18000000, 779.12);
    expect(r.principal).toMatch(/18\.000\.000/);
    expect(r.secundario).toBe('UF 779,12');
  });
  it('shows UF when only montoUf is informed, never pesos', () => {
    expect(formatMontoInformado(null, 2009.9502587)).toEqual({ principal: 'UF 2.009,95', secundario: null });
  });
  it('falls back to «Monto no informado»', () => {
    expect(formatMontoInformado(null, null).principal).toBe('Monto no informado');
    expect(formatMontoInformado(null, undefined).principal).toBe('Monto no informado');
  });
  it('transaction popup renders the UF amount', () => {
    const html = buildPopup({
      lat: -45.57, lng: -72.07, monto: null, montoUf: 779, anio: 2018, comuna: 'Coyhaique',
      predio: null, superficie: null, rol: null, destino: null, fechaEscritura: null,
      fechaInscripcion: null, fojas: null, numero: null, conservador: null,
    });
    expect(html).toContain('UF 779');
    expect(html).not.toContain('Monto no informado');
  });
});

describe('popups escape data values', () => {
  it('transaction popup', () => {
    const point = {
      lat: -39.8, lng: -73.2, monto: 1000, montoUf: null, anio: 2024, comuna: 'Valdivia', predio: XSS,
      superficie: 500, rol: XSS, destino: 'A', fechaEscritura: null, fechaInscripcion: null,
      fojas: XSS, numero: 12, conservador: XSS,
    } as MapPoint;
    const html = buildPopup(point);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('protected area popup drops a javascript: link', () => {
    const html = buildProtectedPopup({
      nombre_ap: XSS,
      designacion_ap: 'Parque Nacional',
      region: 'Los Ríos',
      ha: 10,
      cod_rnap: '1',
      url_fuente: 'javascript:alert(1)',
    } as ProtectedAreaProps);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Ver ficha oficial');
  });

  it('protected area popup links an https source', () => {
    const html = buildProtectedPopup({
      nombre_ap: 'Parque',
      designacion_ap: 'Parque Nacional',
      ha: 10,
      url_fuente: 'https://simbio.mma.gob.cl/x',
    } as ProtectedAreaProps);
    expect(html).toContain('href="https://simbio.mma.gob.cl/x"');
  });

  it('road popup', () => {
    const html = buildRedVialPopup({ NOMBRE_CAMINO: XSS, ROL: XSS, CLASIFICACION: XSS } as RedVialProps);
    expect(html).not.toContain('<img');
  });

  it('user KML popup strips embedded markup and escapes the rest', () => {
    const layer = {
      id: '1', name: 'capa', displayName: XSS, color: '#ff0000', visible: true, featureCount: 1,
      geojson: { type: 'FeatureCollection', features: [] },
    } satisfies KmlLayer;
    const html = buildKmlPopup(
      { name: XSS, description: '<script>alert(1)</script><b>texto</b>' },
      layer,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
  });
});

describe('buildRelieveResult', () => {
  it('shows elevation, slope class and aspect, with the DSM caveat', () => {
    const html = buildRelieveResult({ cota: 757.6, pendientePct: 44.77, pendienteGrados: 24.12, exposicion: 101 });
    expect(html).toContain('Clase G · Moderadamente escarpado (SAG)');
    expect(html).toContain('758 m s.n.m.');
    expect(html).toContain('45 % (24,1°)');
    expect(html).toContain('E · 101°');
    expect(html).toContain('Modelo de superficie');
    expect(html).not.toContain('Ley 20.283');
  });

  it('flags the 45 % native-forest threshold', () => {
    expect(buildRelieveResult({ cota: 300, pendientePct: 52, pendienteGrados: 27.5, exposicion: 0 }))
      .toContain('Ley 20.283');
  });
});

describe('buildConservadorPopup', () => {
  const office: Conservador = {
    id: 'cbr-14101', nombre: 'Valdivia', direccion: 'Independencia 455', comuna: 'Valdivia', region: 'Los Ríos',
    telefono: '+56 63 221 2345', email: 'contacto@cbrvaldivia.cl', sitioWeb: 'https://www.cbrvaldivia.cl',
    jurisdiccion: ['Valdivia', 'Corral'], jurisdiccion_cut: ['14101', '14102'], lat: -39.8142, lng: -73.2459,
  };

  it('escapes every data value', () => {
    const html = buildConservadorPopup({
      ...office, nombre: XSS, direccion: XSS, comuna: XSS, region: XSS, telefono: XSS,
      email: XSS, sitioWeb: XSS, jurisdiccion: [XSS, `"><script>alert(1)</script>`],
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('never links a script URL or an injected mailto', () => {
    const html = buildConservadorPopup({
      ...office, sitioWeb: 'javascript:alert(1)', email: 'x" onclick="alert(1)@a.cl',
    });
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="mailto:x');
    expect(html).not.toContain('onclick="');
  });

  it('shows contact, jurisdiction and the directions link', () => {
    const html = buildConservadorPopup(office);
    expect(html).toContain('Conservador de Bienes Raíces de Valdivia');
    expect(html).toContain('href="mailto:contacto@cbrvaldivia.cl"');
    expect(html).toContain('href="tel:+56632212345"');
    expect(buildConservadorPopup({ ...office, telefono: '632 213219, 632 213723' }))
      .toMatch(/href="tel:632213219"[^]*href="tel:632213723"/);
    expect(html).toContain('href="https://www.cbrvaldivia.cl/" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('Valdivia, Corral');
    expect(html).toContain('href="https://www.google.com/maps/dir/?api=1&amp;destination=-39.8142,-73.2459"');
  });

  it('omits empty fields and flags a jurisdiction without CUTs', () => {
    const html = buildConservadorPopup({
      ...office, direccion: null, telefono: null, email: null, sitioWeb: null, jurisdiccion_cut: [],
    });
    expect(html).not.toContain('Dirección');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('no se resalta en el mapa');
  });

  it('links a site stored without scheme as https', () => {
    expect(buildConservadorPopup({ ...office, sitioWeb: 'www.cbrvaldivia.cl' }))
      .toContain('href="https://www.cbrvaldivia.cl/"');
  });
});
