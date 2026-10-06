import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractKmlFromKmz } from './kml';

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
