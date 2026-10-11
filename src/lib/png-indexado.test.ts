import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { pngIndexado } from '@/lib/png-indexado';

describe('pngIndexado', () => {
  it('round-trips through a standard decoder, alpha included', () => {
    const paleta = [
      [0, 0, 0, 0],
      [255, 0, 0, 255],
      [0, 128, 255, 110],
    ] as const;
    const indices = new Uint8Array([0, 1, 2, 1, 0, 2]);
    const png = PNG.sync.read(pngIndexado(3, 2, indices, paleta));
    expect(png.width).toBe(3);
    expect(png.height).toBe(2);
    const pixel = (i: number) => Array.from(png.data.subarray(i * 4, i * 4 + 4));
    expect(pixel(0)[3]).toBe(0);
    expect(pixel(1)).toEqual([255, 0, 0, 255]);
    expect(pixel(2)).toEqual([0, 128, 255, 110]);
    expect(pixel(5)).toEqual([0, 128, 255, 110]);
  });

  it('round-trips rows that pick the Sub and Up filters', () => {
    const paleta = Array.from({ length: 40 }, (_, i) => [i * 6, 0, 0, 255] as const);
    const ancho = 30;
    const alto = 4;
    // Fila 0: rampa (Sub gana); filas 1-3: repiten la anterior + 1 (Up gana).
    const indices = new Uint8Array(ancho * alto);
    for (let y = 0; y < alto; y++) for (let x = 0; x < ancho; x++) indices[y * ancho + x] = x + y;
    const png = PNG.sync.read(pngIndexado(ancho, alto, indices, paleta));
    for (let i = 0; i < indices.length; i++) expect(png.data[i * 4]).toBe(indices[i] * 6);
  });

  it('rejects inconsistent input', () => {
    expect(() => pngIndexado(2, 2, new Uint8Array(3), [[0, 0, 0, 0]])).toThrow(RangeError);
    expect(() => pngIndexado(1, 1, new Uint8Array(1), [])).toThrow(RangeError);
  });
});
