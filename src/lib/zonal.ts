/**
 * Estadística zonal del relieve sobre el polígono del predio: qué fracción
 * del predio cae en cada clase de pendiente SAG, cuánto supera los umbrales
 * legales de 30 y 45 %, y el rango de cotas. Lo pesado (leer el DEM) vive en
 * `relieve-raster.ts`; aquí está la geometría y la aritmética, puras y con
 * tests.
 *
 * El recorte del polígono es por BARRIDO DE FILAS (scanline): por cada fila del
 * DEM se calculan los cruces de los bordes con su latitud y se toman las celdas
 * cuyo centro cae entre cruces pares e impares. Cuesta O(filas × aristas), no
 * O(celdas × vértices) como un punto-en-polígono por celda, que con un predio
 * de miles de hectáreas y un KML de miles de vértices no termina a tiempo.
 * Pares/impares respeta los huecos y las partes de un MultiPolygon.
 */

import { PENDIENTE_CLASES } from '@/lib/relieve';
import type { Posicion } from '@/lib/analisis-predio';

/** Longitudes donde los bordes cruzan la latitud `lat`, ordenadas. */
export function crucesFila(anillos: readonly Posicion[][], lat: number): number[] {
  const cruces: number[] = [];
  for (const anillo of anillos) {
    for (let k = 0; k + 1 < anillo.length; k++) {
      const [x1, y1] = anillo[k];
      const [x2, y2] = anillo[k + 1];
      // Semiabierto [y1, y2): un vértice exactamente en la fila cuenta una vez.
      if ((y1 <= lat && lat < y2) || (y2 <= lat && lat < y1)) {
        cruces.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
  }
  return cruces.sort((a, b) => a - b);
}

export interface ClaseZonal {
  clase: string;
  nombre: string;
  rango: string;
  pct: number;
}

export interface RelieveZonal {
  /** Lado de la celda del DEM usada, en metros (30 m nativo o un nivel más grueso). */
  resolucionM: number;
  celdas: number;
  cotaMin: number;
  cotaMax: number;
  cotaMedia: number;
  pendienteMedia: number;
  pendienteMediana: number;
  pctSobre30: number;
  pctSobre45: number;
  clases: ClaseZonal[];
}

/** Resume pendientes (%) y cotas (m) de las celdas dentro del predio. `null` si no hay celdas. */
export function resumirRelieve(pendientes: ArrayLike<number>, cotas: ArrayLike<number>, resolucionM: number): RelieveZonal | null {
  const n = pendientes.length;
  if (n === 0) return null;
  const conteo = new Array<number>(PENDIENTE_CLASES.length).fill(0);
  let suma = 0;
  let sobre30 = 0;
  let sobre45 = 0;
  for (let k = 0; k < n; k++) {
    const p = pendientes[k];
    suma += p;
    if (p >= 30) sobre30++;
    if (p >= 45) sobre45++;
    const idx = PENDIENTE_CLASES.findIndex((c) => p < c.hasta);
    conteo[idx === -1 ? PENDIENTE_CLASES.length - 1 : idx]++;
  }
  const ordenadas = Float64Array.from(pendientes).sort();
  const mitad = Math.floor(n / 2);
  const mediana = n % 2 ? ordenadas[mitad] : (ordenadas[mitad - 1] + ordenadas[mitad]) / 2;

  let cotaMin = Infinity;
  let cotaMax = -Infinity;
  let sumaCota = 0;
  for (let k = 0; k < cotas.length; k++) {
    const z = cotas[k];
    if (z < cotaMin) cotaMin = z;
    if (z > cotaMax) cotaMax = z;
    sumaCota += z;
  }

  return {
    resolucionM,
    celdas: n,
    cotaMin,
    cotaMax,
    cotaMedia: sumaCota / cotas.length,
    pendienteMedia: suma / n,
    pendienteMediana: mediana,
    pctSobre30: (sobre30 / n) * 100,
    pctSobre45: (sobre45 / n) * 100,
    clases: PENDIENTE_CLASES.map((c, k) => ({ clase: c.clase, nombre: c.nombre, rango: c.rango, pct: (conteo[k] / n) * 100 }))
      .filter((c) => c.pct > 0),
  };
}
