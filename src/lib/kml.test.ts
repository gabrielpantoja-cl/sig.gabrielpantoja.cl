import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  extractKmlFromKmz,
  hslToHex,
  kmlFeatureColor,
  kmlFeatureStyle,
  kmlFileStyle,
  restoreKmlLayer,
} from './kml';

const KML = '<?xml version="1.0"?><kml><Document><name>Predio</name></Document></kml>';

describe('extractKmlFromKmz', () => {
  it('prefiere doc.kml en la raíz', () => {
    const kmz = zipSync({
      'a.kml': strToU8('<kml>otro</kml>'),
      'doc.kml': strToU8(KML),
      'files/icon.png': new Uint8Array([1, 2, 3]),
    });
    expect(extractKmlFromKmz(kmz, 'x.kmz')).toBe(KML);
  });

  it('sin doc.kml toma el .kml menos profundo y respeta UTF-8', () => {
    const kmz = zipSync({
      'sub/dentro.kml': strToU8('<kml>profundo</kml>'),
      'Ñuñoa.KML': strToU8('<kml>Ñuñoa</kml>'),
    });
    expect(extractKmlFromKmz(kmz, 'x.kmz')).toBe('<kml>Ñuñoa</kml>');
  });

  it('ignora la basura __MACOSX', () => {
    const kmz = zipSync({
      '__MACOSX/._doc.kml': strToU8('basura'),
      'capa/doc2.kml': strToU8(KML),
    });
    expect(extractKmlFromKmz(kmz, 'x.kmz')).toBe(KML);
  });

  it('falla con mensaje claro si no hay .kml', () => {
    const kmz = zipSync({ 'icon.png': new Uint8Array([1]) });
    expect(() => extractKmlFromKmz(kmz, 'x.kmz')).toThrow(/no contiene ningún archivo \.kml/);
  });

  it('falla con mensaje claro si no es un ZIP', () => {
    expect(() => extractKmlFromKmz(strToU8(KML), 'x.kmz')).toThrow(/no es un KMZ válido/);
  });
});

describe('kmlFeatureColor', () => {
  const base = { color: '#123456', colorSeed: 40 };

  it('en modo único devuelve el color de la capa', () => {
    expect(kmlFeatureColor({ ...base, colorMode: 'unico' }, 7)).toBe('#123456');
  });

  it('en modo por entidad da colores #rrggbb distintos a entidades consecutivas', () => {
    const layer = { ...base, colorMode: 'por-entidad' as const };
    const colors = Array.from({ length: 12 }, (_, i) => kmlFeatureColor(layer, i));
    for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set(colors).size).toBe(12);
  });

  it('otra semilla cambia la combinación', () => {
    const a = kmlFeatureColor({ ...base, colorMode: 'por-entidad' }, 0);
    const b = kmlFeatureColor({ ...base, colorMode: 'por-entidad', colorSeed: 200 }, 0);
    expect(a).not.toBe(b);
  });
});

describe('hslToHex', () => {
  it('convierte los primarios', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });
});

describe('restoreKmlLayer', () => {
  const feature = {
    type: 'Feature',
    properties: { name: 'Lote 1' },
    geometry: { type: 'Point', coordinates: [-73.2, -39.8] },
  };

  it('completa los campos de versiones anteriores y marca la capa como restaurada', () => {
    const layer = restoreKmlLayer({
      id: 'a',
      name: 'predio',
      color: '#7c3aed',
      visible: true,
      geojson: { type: 'FeatureCollection', features: [feature] },
    });
    expect(layer).toMatchObject({
      id: 'a',
      displayName: 'predio',
      colorMode: 'unico',
      colorSeed: 0,
      restaurada: true,
      featureCount: 1,
    });
  });

  it('reemplaza un color que no es #rrggbb', () => {
    const layer = restoreKmlLayer({
      id: 'a',
      name: 'p',
      color: 'red;background:url(x)',
      geojson: { type: 'FeatureCollection', features: [feature] },
    });
    expect(layer?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('descarta registros sin geometrías o con otra forma', () => {
    expect(restoreKmlLayer(null)).toBeNull();
    expect(restoreKmlLayer({ id: 'a', name: 'p' })).toBeNull();
    expect(
      restoreKmlLayer({
        id: 'a',
        name: 'p',
        geojson: { type: 'FeatureCollection', features: [{ ...feature, geometry: null }] },
      }),
    ).toBeNull();
  });
});

describe('kmlFileStyle / kmlFeatureStyle (colores de Google Earth)', () => {
  it('usa fill/stroke que togeojson ya convirtió desde aabbggrr', () => {
    const style = kmlFeatureStyle(
      { color: '#123456', colorMode: 'archivo', colorSeed: 0 },
      { fill: '#FF0000', 'fill-opacity': 0.25, stroke: '#0f0', 'stroke-width': 3 },
      0,
    );
    expect(style).toEqual({
      color: '#00ff00',
      fillColor: '#ff0000',
      opacity: 0.9,
      fillOpacity: 0.25,
      weight: 3,
    });
  });

  it('respeta un relleno apagado (fill 0) y acota el grosor', () => {
    const s = kmlFileStyle({ stroke: '#abcdef', 'fill-opacity': 0, 'stroke-width': 99 });
    expect(s.fillOpacity).toBe(0);
    expect(s.strokeWidth).toBe(8);
  });

  it('descarta colores que no son hex y cae al color de la capa', () => {
    const style = kmlFeatureStyle(
      { color: '#123456', colorMode: 'archivo', colorSeed: 0 },
      { stroke: 'red;background:url(x)', fill: 'url(x)' },
      0,
    );
    expect(style.color).toBe('#123456');
    expect(style.fillColor).toBe('#123456');
  });

  it('en otros modos ignora el estilo del archivo', () => {
    const style = kmlFeatureStyle(
      { color: '#123456', colorMode: 'unico', colorSeed: 0 },
      { fill: '#ff0000' },
      0,
    );
    expect(style.fillColor).toBe('#123456');
  });

  it('restaurar detecta el estilo y no deja modo archivo sin estilo', () => {
    const base = {
      id: 'a',
      name: 'p',
      color: '#7c3aed',
      colorMode: 'archivo',
    };
    const geom = { type: 'Point', coordinates: [-73, -39] };
    const con = restoreKmlLayer({
      ...base,
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { fill: '#ff0000' }, geometry: geom }] },
    });
    expect(con).toMatchObject({ tieneEstilo: true, colorMode: 'archivo' });
    const sin = restoreKmlLayer({
      ...base,
      geojson: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geom }] },
    });
    expect(sin).toMatchObject({ tieneEstilo: false, colorMode: 'unico' });
  });
});
