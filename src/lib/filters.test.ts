import { describe, expect, it } from 'vitest';
import { buildFilters } from '@/lib/filters';

const build = (query: string) => buildFilters(new URLSearchParams(query));

describe('buildFilters', () => {
  it('always requires coordinates and binds nothing without filters', () => {
    expect(build('')).toEqual({ where: 'lat IS NOT NULL AND lng IS NOT NULL', params: [] });
  });

  it('ignores comuna=todas and binds any other comuna', () => {
    expect(build('comuna=todas').params).toEqual([]);
    const { where, params } = build('comuna=Valdivia');
    expect(where).toContain('comuna = $1');
    expect(params).toEqual(['Valdivia']);
  });

  it('numbers placeholders in order across every filter', () => {
    const { where, params } = build(
      'comuna=Valdivia&anio_min=2020&anio_max=2024&monto_min=1000&sup_max=5000&rol=123',
    );
    expect(params).toEqual(['Valdivia', 2020, 2024, 1000, 5000, '%123%']);
    for (let i = 1; i <= params.length; i++) expect(where).toContain(`$${i}`);
    expect(where).not.toContain('$7');
  });

  it('drops numbers that do not parse', () => {
    expect(build('monto_min=abc&sup_min=&anio_max=NaN').params).toEqual([]);
  });

  it('accepts only real calendar dates', () => {
    expect(build('fecha_desde=2024-02-29').params).toEqual(['2024-02-29']);
    expect(build('fecha_desde=2023-02-29').params).toEqual([]);
    expect(build('fecha_hasta=2024-13-01').params).toEqual([]);
    expect(build("fecha_hasta=2024-01-01'; DROP TABLE x").params).toEqual([]);
  });

  it('never interpolates user text into the SQL', () => {
    const { where } = build("predio=x' OR 1=1 --&comuna=a'b");
    expect(where).not.toContain("'");
  });

  it('matches predio and rol literally: % _ and \\ are escaped', () => {
    expect(build('rol=_').params).toEqual(['%\\_%']);
    expect(build('predio=50%25').params).toEqual(['%50\\%%']);
    expect(build('predio=a%5Cb').params).toEqual(['%a\\\\b%']);
  });

  it('trims text filters, skips blank ones and caps them at 100 chars', () => {
    expect(build('predio=%20%20&rol=').params).toEqual([]);
    expect(build('predio=%20Fundo%20').params).toEqual(['%Fundo%']);
    const [pattern] = build(`predio=${'x'.repeat(500)}`).params as string[];
    expect(pattern).toHaveLength(102);
  });
});
