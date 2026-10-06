import { describe, expect, it } from 'vitest';
import {
  buildKmlPopup,
  buildPopup,
  buildProtectedPopup,
  buildRedVialPopup,
  esc,
  formatDateCL,
  safeHref,
} from '@/lib/map-popups';
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

describe('popups escape data values', () => {
  it('transaction popup', () => {
    const point = {
      lat: -39.8, lng: -73.2, monto: 1000, anio: 2024, comuna: 'Valdivia', predio: XSS,
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
