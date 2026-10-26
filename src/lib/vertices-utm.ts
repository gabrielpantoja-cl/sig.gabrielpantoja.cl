/**
 * Vértices UTM pegados desde un plano, una escritura o una planilla → polígono
 * para la ficha del predio. Es la forma en que el perito TIENE el deslinde:
 * una tabla de vértices en UTM, no un KML.
 *
 * Acepta una línea por vértice con el formato que sale de Excel, AutoCAD o un
 * PDF copiado: `E N`, `E;N`, `E<tab>N`, `V1 732364,52 4947573,18`, con punto
 * de miles o coma decimal a la chilena. De cada línea toma los DOS ÚLTIMOS
 * números (así una etiqueta o un correlativo al inicio no estorba) y, si
 * vienen como N E, los da vuelta: en Chile la norte siempre pasa de 1.000.000
 * y la este nunca.
 *
 * Datum: se asume WGS84 / SIRGAS-Chile (iguales a escala de predio). Un plano
 * antiguo en PSAD56 o SAD69 queda desplazado unos 200-400 m: la interfaz lo
 * advierte; aquí no se adivina.
 */

import { utmToLonLat } from '@/lib/coordenadas';
import type { Punto } from '@/lib/medicion';

export type ZonaUtmChile = 18 | 19;

export type VerticesUtm =
  | { ok: true; puntos: Punto[]; descartadas: number }
  | { ok: false; error: string };

/** «732.364,52» · «732364.52» · «732364,52» · «4.947.573» → número. */
export function numeroChileno(raw: string): number | null {
  let s = raw.trim();
  if (!/^-?[\d.,]+$/.test(s)) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const ESTE_MIN = 100_000;
const ESTE_MAX = 900_000;
const NORTE_MIN = 3_500_000; // ~58,5° S
const NORTE_MAX = 8_100_000; // ~17,3° S

/** Números de una línea: separa por espacio, tab o `;`, y por coma solo si no hay otro separador. */
function numerosDeLinea(linea: string): number[] {
  const conSeparador = /[\s;]/.test(linea.trim());
  const tokens = conSeparador ? linea.split(/[\s;]+/) : linea.split(/,(?=\s*\d)/);
  const nums: number[] = [];
  for (const t of tokens) {
    const n = numeroChileno(t);
    if (n !== null) nums.push(n);
  }
  return nums;
}

export function parsearVerticesUtm(texto: string, zona: ZonaUtmChile): VerticesUtm {
  const puntos: Punto[] = [];
  let descartadas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue;
    const nums = numerosDeLinea(linea);
    if (nums.length < 2) {
      descartadas++;
      continue;
    }
    let [e, n] = nums.slice(-2);
    if (e > ESTE_MAX && n <= ESTE_MAX) [e, n] = [n, e];
    if (e < ESTE_MIN || e > ESTE_MAX || n < NORTE_MIN || n > NORTE_MAX) {
      return {
        ok: false,
        error: `«${linea.trim().slice(0, 40)}» no parece una coordenada UTM de Chile (este 100.000–900.000, norte 3.500.000–8.100.000).`,
      };
    }
    const [lng, lat] = utmToLonLat(e, n, zona);
    puntos.push({ lat, lng });
  }
  // Un anillo pegado con el primer vértice repetido al final: se quita el cierre.
  if (puntos.length > 3) {
    const [a, z] = [puntos[0], puntos[puntos.length - 1]];
    if (Math.abs(a.lat - z.lat) < 1e-9 && Math.abs(a.lng - z.lng) < 1e-9) puntos.pop();
  }
  if (puntos.length < 3) return { ok: false, error: 'Se necesitan al menos 3 vértices (una línea por vértice: este y norte).' };
  return { ok: true, puntos, descartadas };
}
