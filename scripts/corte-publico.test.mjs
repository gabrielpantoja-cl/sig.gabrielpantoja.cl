import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonizarFila,
  hoja,
  raizMerkle,
  pruebaInclusion,
  verificarInclusion,
} from './corte-publico.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest();
const hex = (b) => b.toString('hex');

const COLS = ['id', 'monto', 'comuna'];
const fila = (id, monto, comuna) => ({ id, monto, comuna });

describe('canonicalización', () => {
  it('es determinista', () => {
    const f = fila('a1', 1000, 'Valdivia');
    expect(canonizarFila(f, COLS)).toBe(canonizarFila({ ...f }, COLS));
  });

  it('distingue NULL de cadena vacía', () => {
    expect(canonizarFila(fila('a', null, 'x'), COLS))
      .not.toBe(canonizarFila(fila('a', '', 'x'), COLS));
  });

  it('distingue 0 de NULL', () => {
    expect(canonizarFila(fila('a', 0, 'x'), COLS))
      .not.toBe(canonizarFila(fila('a', null, 'x'), COLS));
  });

  it('normaliza -0 a 0: el signo no debe cambiar la raíz', () => {
    expect(canonizarFila(fila('a', -0, 'x'), COLS))
      .toBe(canonizarFila(fila('a', 0, 'x'), COLS));
  });

  it('escapa el separador para que el contenido no finja un límite de campo', () => {
    // Sin escape, estas dos filas distintas colapsarían a la misma cadena y la
    // raíz dejaría de ser inyectiva.
    const a = canonizarFila({ id: 'x', monto: null, comuna: 'uno\tdos' }, COLS);
    const b = canonizarFila({ id: 'x', monto: 'uno', comuna: 'dos' }, COLS);
    expect(a).not.toBe(b);
  });

  it('rechaza numéricos no finitos en vez de emitir "NaN"', () => {
    expect(() => canonizarFila(fila('a', NaN, 'x'), COLS)).toThrow();
    expect(() => canonizarFila(fila('a', Infinity, 'x'), COLS)).toThrow();
  });

  it('el orden de columnas es parte del contrato', () => {
    const f = fila('a', 1, 'b');
    expect(canonizarFila(f, ['id', 'monto'])).not.toBe(canonizarFila(f, ['monto', 'id']));
  });
});

describe('raíz de Merkle', () => {
  it('una hoja: la raíz es la hoja', () => {
    const h = hoja(fila('a', 1, 'x'), COLS);
    expect(hex(raizMerkle([h]))).toBe(hex(h));
  });

  it('dos hojas: SHA-256 de la concatenación', () => {
    const a = hoja(fila('a', 1, 'x'), COLS);
    const b = hoja(fila('b', 2, 'y'), COLS);
    expect(hex(raizMerkle([a, b]))).toBe(hex(sha256(Buffer.concat([a, b]))));
  });

  it('nivel impar: duplica el último nodo', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((k, i) => hoja(fila(k, i, k), COLS));
    const esperado = sha256(Buffer.concat([
      sha256(Buffer.concat([a, b])),
      sha256(Buffer.concat([c, c])),
    ]));
    expect(hex(raizMerkle([a, b, c]))).toBe(hex(esperado));
  });

  it('cambiar una sola fila cambia la raíz', () => {
    const base = [1, 2, 3, 4, 5].map((n) => hoja(fila(`id${n}`, n * 100, 'Valdivia'), COLS));
    const tocado = [...base];
    tocado[2] = hoja(fila('id3', 999999, 'Valdivia'), COLS); // monto alterado
    expect(hex(raizMerkle(base))).not.toBe(hex(raizMerkle(tocado)));
  });

  it('reordenar las filas cambia la raíz: el orden es parte del corte', () => {
    const [a, b] = [hoja(fila('a', 1, 'x'), COLS), hoja(fila('b', 2, 'y'), COLS)];
    expect(hex(raizMerkle([a, b]))).not.toBe(hex(raizMerkle([b, a])));
  });

  it('es estable: la misma entrada da la misma raíz', () => {
    const hs = Array.from({ length: 37 }, (_, i) => hoja(fila(`id${i}`, i, 'c'), COLS));
    expect(hex(raizMerkle(hs))).toBe(hex(raizMerkle(hs.slice())));
  });
});

describe('prueba de inclusión', () => {
  // Varios tamaños, incluidos impares, que es donde falla la duplicación.
  for (const n of [1, 2, 3, 5, 8, 17, 100]) {
    it(`verifica todas las hojas con n=${n}`, () => {
      const hs = Array.from({ length: n }, (_, i) =>
        hoja(fila(`id${i}`, i * 1000, 'Valdivia'), COLS));
      const raiz = hex(raizMerkle(hs));
      for (let i = 0; i < n; i++) {
        const ruta = pruebaInclusion(hs, i);
        expect(verificarInclusion(hex(hs[i]), ruta, raiz)).toBe(true);
      }
    });
  }

  it('rechaza una hoja que no pertenece al árbol', () => {
    const hs = Array.from({ length: 10 }, (_, i) => hoja(fila(`id${i}`, i, 'c'), COLS));
    const raiz = hex(raizMerkle(hs));
    const intrusa = hex(hoja(fila('falsa', 42, 'c'), COLS));
    expect(verificarInclusion(intrusa, pruebaInclusion(hs, 3), raiz)).toBe(false);
  });

  it('rechaza una ruta alterada', () => {
    const hs = Array.from({ length: 10 }, (_, i) => hoja(fila(`id${i}`, i, 'c'), COLS));
    const raiz = hex(raizMerkle(hs));
    const ruta = pruebaInclusion(hs, 4);
    ruta[0].hash = hex(Buffer.alloc(32, 1));
    expect(verificarInclusion(hex(hs[4]), ruta, raiz)).toBe(false);
  });

  it('la prueba crece con log2(n): ~18 hermanos para cientos de miles de filas', () => {
    const hs = Array.from({ length: 200_000 }, (_, i) => Buffer.alloc(32, i % 256));
    expect(pruebaInclusion(hs, 50_000).length).toBe(18);
  });
});
