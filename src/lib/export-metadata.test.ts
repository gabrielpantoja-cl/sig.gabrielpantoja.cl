import { describe, expect, it } from 'vitest';
import { buildExportMetadata, type BuildMetadataInput } from '@/lib/export-metadata';
import type { KmlLayer } from '@/lib/kml';

const base: BuildMetadataInput = {
  showBioclima: false,
  bioclimaVariable: 'precipitation',
  showPoints: false,
  showProtected: false,
  showUrbanLimit: false,
  showComunas: false,
  showRedVial: false,
  showRedDrenaje: false,
  showLineasTransmision: false,
  showSuelos: false,
  showCatastroFruticola: false,
  showVegetacional: false,
  showPropiedadesRurales: false,
  showNdviVisual: false,
  showHexbins: false,
  hexbinStatus: { kind: 'idle' },
  comuna: 'todas',
  anioFrom: null,
  fechaDesde: '',
  fechaHasta: '',
  montoMin: '',
  montoMax: '',
  supMin: '',
  supMax: '',
  predio: '',
  rol: '',
  stats: null,
  kmlLayers: [],
};

const kml = (over: Partial<KmlLayer>): KmlLayer => ({
  id: 'k',
  name: 'archivo',
  displayName: '',
  color: '#123456',
  visible: true,
  featureCount: 3,
  geojson: { type: 'FeatureCollection', features: [] },
  ...over,
});

describe('buildExportMetadata', () => {
  it('is empty when nothing is shown', () => {
    expect(buildExportMetadata(base)).toEqual([]);
  });

  it('lists the CBR count and every applied filter', () => {
    const [cbr] = buildExportMetadata({
      ...base,
      showPoints: true,
      comuna: 'Valdivia',
      anioFrom: 2020,
      montoMin: '10000000',
      supMax: '5000',
      rol: ' 123-4 ',
      stats: { count: 1234 } as BuildMetadataInput['stats'],
    });
    expect(cbr.title).toBe('Transacciones CBR');
    expect(cbr.details).toContain('1.234 inscripciones');
    expect(cbr.details).toContain('Comuna: Valdivia');
    expect(cbr.details).toContain('Año desde (fecha disponible): 2020');
    expect(cbr.details).toMatch(/Monto: ≥ \$\s?10\.000\.000 – sin máximo/);
    expect(cbr.details).toContain('Superficie terreno ≤ 5.000 m²');
    expect(cbr.details).toContain('ROL SII contiene: «123-4»');
  });

  it('ignores monto filters that are not positive numbers', () => {
    const [cbr] = buildExportMetadata({ ...base, showPoints: true, montoMin: 'abc', montoMax: '0' });
    expect(cbr.details).not.toContain('Monto');
  });

  it('declares the heat map resolution and threshold actually drawn', () => {
    const [heat] = buildExportMetadata({
      ...base,
      showHexbins: true,
      hexbinStatus: {
        kind: 'ready',
        meta: { edge_m: 250, destino: 'H', min_n: 3, cells: 120, points: 900 },
        breaks: [],
        scale: [],
        ramp: 'plasma',
      },
    });
    expect(heat.details).toContain('Hexágonos de 250 m de arista · mínimo 3 transacciones por celda');
    expect(heat.details).toContain('Superficie interpolada');
    expect(heat.details).not.toContain('seis clases');
  });

  it('says so when the heat map had no cells', () => {
    const [heat] = buildExportMetadata({ ...base, showHexbins: true });
    expect(heat.details).toContain('Sin celdas suficientes');
  });

  it('adds only visible KML layers, under their display name', () => {
    const entries = buildExportMetadata({
      ...base,
      kmlLayers: [kml({ displayName: 'Predio 12' }), kml({ id: 'h', visible: false })],
    });
    expect(entries.map((e) => e.title)).toEqual(['KML: Predio 12']);
  });

  it('keeps the transmission-line disclaimer about easements', () => {
    const [lineas] = buildExportMetadata({ ...base, showLineasTransmision: true });
    expect(lineas.details).toContain('no representan servidumbres');
  });
});
