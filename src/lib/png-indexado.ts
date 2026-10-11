import { deflateSync } from 'node:zlib';

/**
 * PNG de color indexado (tipo 3, 8 bits) con transparencia por entrada de
 * paleta (`tRNS`). `pngjs` solo escribe RGB/RGBA, y para capas con pocos
 * colores (clases de pendiente, sectores de exposición, niveles de sombreado)
 * un PNG indexado pesa del orden de 4–8 veces menos: un byte por píxel en vez
 * de cuatro, y bytes repetidos que deflate comprime mucho mejor.
 *
 * Mínimo de la especificación: IHDR, PLTE, tRNS, IDAT, IEND, con filtro None,
 * Sub o Up elegido por fila.
 */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo: string, datos: Uint8Array): Buffer {
  const salida = Buffer.alloc(12 + datos.length);
  salida.writeUInt32BE(datos.length, 0);
  salida.write(tipo, 4, 'ascii');
  salida.set(datos, 8);
  salida.writeUInt32BE(crc32(salida.subarray(4, 8 + datos.length)), 8 + datos.length);
  return salida;
}

export type ColorPaleta = readonly [number, number, number, number];

/**
 * @param indices un byte por píxel, fila a fila desde arriba.
 * @param paleta hasta 256 colores RGBA; el índice 0 suele ser el transparente.
 */
export function pngIndexado(
  ancho: number,
  alto: number,
  indices: Uint8Array,
  paleta: readonly ColorPaleta[],
): Buffer {
  if (paleta.length === 0 || paleta.length > 256) throw new RangeError('La paleta debe tener entre 1 y 256 colores');
  if (indices.length !== ancho * alto) throw new RangeError('El número de índices no coincide con el tamaño');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por índice
  ihdr[9] = 3; // color indexado
  // 10-12: compresión, filtro, entrelazado = 0

  const plte = new Uint8Array(paleta.length * 3);
  const trns = new Uint8Array(paleta.length);
  paleta.forEach(([r, g, b, a], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
    trns[i] = a;
  });

  // Filtro por fila con la heurística de la especificación (menor suma de
  // valores absolutos entre None, Sub y Up): en el sombreado, cuyos índices
  // cambian de a poco, Up/Sub dejan casi todo en cero y deflate lo aprovecha.
  const crudo = Buffer.alloc((ancho + 1) * alto);
  const candidatos = [new Uint8Array(ancho), new Uint8Array(ancho), new Uint8Array(ancho)];
  for (let fila = 0; fila < alto; fila++) {
    const actual = indices.subarray(fila * ancho, (fila + 1) * ancho);
    const previa = fila > 0 ? indices.subarray((fila - 1) * ancho, fila * ancho) : null;
    const costos = [0, 0, 0];
    for (let x = 0; x < ancho; x++) {
      const v = actual[x];
      const sub = (v - (x > 0 ? actual[x - 1] : 0)) & 0xff;
      const up = (v - (previa ? previa[x] : 0)) & 0xff;
      candidatos[0][x] = v;
      candidatos[1][x] = sub;
      candidatos[2][x] = up;
      costos[0] += v < 128 ? v : 256 - v;
      costos[1] += sub < 128 ? sub : 256 - sub;
      costos[2] += up < 128 ? up : 256 - up;
    }
    const mejor = costos.indexOf(Math.min(...costos));
    crudo[fila * (ancho + 1)] = mejor; // 0 None, 1 Sub, 2 Up
    crudo.set(candidatos[mejor], fila * (ancho + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque('IHDR', ihdr),
    bloque('PLTE', plte),
    bloque('tRNS', trns),
    bloque('IDAT', deflateSync(crudo, { level: 9 })),
    bloque('IEND', new Uint8Array(0)),
  ]);
}
