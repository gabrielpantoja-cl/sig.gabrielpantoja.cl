import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  DEFAULT_LAYERS,
  parsePermalink,
  parseView,
  serializePermalink,
  type PermalinkDefaults,
  type PermalinkState,
} from '@/lib/permalink';

const DEFAULTS: PermalinkDefaults = { basemap: 'neutro', bioclima: 'precipitation', destino: 'H', minN: 2 };

const initial: PermalinkState = {
  view: null,
  layers: DEFAULT_LAYERS,
  basemap: 'neutro',
  bioclima: 'precipitation',
  destino: 'H',
  minN: 2,
  filters: DEFAULT_FILTERS,
};

describe('serializePermalink', () => {
  it('writes nothing for the default view, so a fresh SIG stays at "/"', () => {
    expect(serializePermalink(initial, DEFAULTS)).toBe('');
  });

  it('writes view, layers, basemap and filters with readable commas', () => {
    const qs = serializePermalink(
      {
        ...initial,
        view: { lat: -39.850671234, lng: -73.238741234, zoom: 15 },
        layers: ['humedales', 'puntos'],
        basemap: 'satelital',
        filters: { ...DEFAULT_FILTERS, comuna: 'Valdivia', anioMin: 2022 },
      },
      DEFAULTS,
    );
    expect(qs).toBe('v=-39.85067,-73.23874,15&capas=puntos,humedales&fondo=satelital&comuna=Valdivia&anio_min=2022');
  });

  it('rounds the centre to fewer decimals at regional zoom', () => {
    expect(serializePermalink({ ...initial, view: { lat: -39.851234, lng: -73.239876, zoom: 8 } }, DEFAULTS))
      .toBe('v=-39.851,-73.240,8');
  });

  it('records CBR points switched off as an explicit layer list', () => {
    expect(serializePermalink({ ...initial, layers: ['suelos'] }, DEFAULTS)).toBe('capas=suelos');
    expect(serializePermalink({ ...initial, layers: [] }, DEFAULTS)).toBe('capas=');
  });

  it('only writes heat-map and bioclima options when those layers are on', () => {
    const off = serializePermalink({ ...initial, destino: 'A', bioclima: 'temperature' }, DEFAULTS);
    expect(off).toBe('');
    const on = serializePermalink(
      { ...initial, layers: ['puntos', 'mapa_calor', 'bioclima'], destino: 'A', minN: 5, bioclima: 'temperature' },
      DEFAULTS,
    );
    expect(on).toBe('capas=puntos,mapa_calor,bioclima&bioclima=temperatura&destino=A&min_n=5');
  });
});

describe('parsePermalink', () => {
  it('reads what serializePermalink wrote (round trip)', () => {
    const state: PermalinkState = {
      view: { lat: -39.85067, lng: -73.23874, zoom: 15 },
      layers: ['puntos', 'mapa_calor', 'humedales'],
      basemap: 'topografico',
      bioclima: 'precipitation',
      destino: 'W',
      minN: 4,
      filters: {
        ...DEFAULT_FILTERS,
        comuna: 'Río Bueno',
        anioMin: 2020,
        fechaDesde: '2023-01-01',
        montoMin: '1000000',
        rol: '123-45',
      },
    };
    expect(parsePermalink(serializePermalink(state, DEFAULTS), DEFAULTS)).toEqual(state);
  });

  it('falls back to defaults with no query', () => {
    expect(parsePermalink('', DEFAULTS)).toEqual({ ...initial, basemap: null });
  });

  it('ignores unknown layers and invalid values field by field', () => {
    const state = parsePermalink(
      '?capas=humedales,borrar_todo&fondo=google&destino=hh&min_n=999&anio_min=abc' +
        '&fecha_desde=2023-13&monto_min=1e9&sup_max=-5&bioclima=nieve',
      DEFAULTS,
    );
    expect(state.layers).toEqual(['humedales']);
    expect(state.basemap).toBeNull();
    expect(state.destino).toBe('H');
    expect(state.minN).toBe(2);
    expect(state.bioclima).toBe('precipitation');
    expect(state.filters).toEqual(DEFAULT_FILTERS);
  });

  it('treats a list of only unknown layers as a broken link, but `capas=` as all off', () => {
    expect(parsePermalink('?capas=<script>', DEFAULTS).layers).toEqual(DEFAULT_LAYERS);
    expect(parsePermalink('?capas=', DEFAULTS).layers).toEqual([]);
  });

  it('drops over-long free text instead of passing it to the API', () => {
    expect(parsePermalink(`?predio=${'x'.repeat(200)}`, DEFAULTS).filters.predio).toBe('');
  });
});

describe('parseView', () => {
  it('accepts a sane centre and zoom', () => {
    expect(parseView('-39.85,-73.24,14.6')).toEqual({ lat: -39.85, lng: -73.24, zoom: 15 });
  });

  it('rejects malformed or out-of-range views', () => {
    expect(parseView('-39.85,-73.24')).toBeNull();
    expect(parseView('-95,-73,10')).toBeNull();
    expect(parseView('-39,-200,10')).toBeNull();
    expect(parseView('-39,-73,40')).toBeNull();
    expect(parseView('a,b,c')).toBeNull();
    expect(parseView(null)).toBeNull();
  });
});
