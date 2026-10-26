import { describe, expect, it } from 'vitest';
import { alternarDestino, destinosDisponibles, parseDestinos, serializeDestinos } from '@/lib/destinos';

describe('parseDestinos', () => {
  it('reads nothing from an empty or missing value', () => {
    expect(parseDestinos(null)).toEqual([]);
    expect(parseDestinos('')).toEqual([]);
  });

  it('keeps single uppercase letters, sorted and without repeats', () => {
    expect(parseDestinos('W, H,A,H')).toEqual(['A', 'H', 'W']);
  });

  it('drops anything that is not a SII code, one by one', () => {
    expect(parseDestinos("h,HH,1,H',W")).toEqual(['W']);
    expect(parseDestinos("H) OR 1=1 --")).toEqual([]);
  });

  it('caps the list at the size of the official table', () => {
    const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').join(',');
    expect(parseDestinos(all)).toHaveLength(20);
  });
});

describe('serializeDestinos / alternarDestino', () => {
  it('gives the same text for the same selection', () => {
    expect(serializeDestinos(['W', 'H'])).toBe('H,W');
    expect(serializeDestinos(['H', 'W', 'H'])).toBe('H,W');
  });

  it('toggles a code keeping the selection canonical', () => {
    expect(alternarDestino(['W'], 'A')).toEqual(['A', 'W']);
    expect(alternarDestino(['A', 'W'], 'A')).toEqual(['W']);
  });
});

describe('destinosDisponibles', () => {
  const porComuna = {
    Coyhaique: { W: 6716, H: 6465, A: 2066 },
    Valdivia: { H: 100, C: 5 },
  };

  it('lists the chosen comuna by frequency', () => {
    expect(destinosDisponibles(porComuna, 'Coyhaique').map((d) => d.code)).toEqual(['W', 'H', 'A']);
  });

  it('adds every comuna up for «todas»', () => {
    expect(destinosDisponibles(porComuna, 'todas')).toEqual([
      { code: 'W', n: 6716 },
      { code: 'H', n: 6565 },
      { code: 'A', n: 2066 },
      { code: 'C', n: 5 },
    ]);
  });

  it('answers empty for an unknown comuna or missing facets', () => {
    expect(destinosDisponibles(porComuna, 'Aysén')).toEqual([]);
    expect(destinosDisponibles(undefined, 'todas')).toEqual([]);
  });
});
