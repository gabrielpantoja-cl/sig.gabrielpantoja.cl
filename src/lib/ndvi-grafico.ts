/**
 * Geometría del gráfico de la serie NDVI, sin DOM ni React.
 *
 * La usan el panel (SVG, `NdviPanel.tsx`) y el export a PNG (canvas,
 * `map-export.ts`): calcular escalas, trazos y huecos en un solo lugar es lo
 * que garantiza que la lámina del informe muestre la misma curva que la
 * pantalla.
 *
 * Forma: eje X = mes del año (ene–dic), una línea por año superpuesta, para
 * que la fenología se compare año contra año. La banda P25–P75 se dibuja solo
 * para el año resaltado: cuatro bandas superpuestas no se leen.
 */

import type { NdviMes, NdviSerie } from '@/lib/ndvi';

export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Color por año, validado con el validador de paletas (4 series, adyacentes:
 * CVD ΔE ≥ 9,1 en claro y ≥ 8,4 en oscuro). El color sigue al AÑO y no a su
 * posición en la ventana (`año % 4`): cuando la ventana avance un mes, 2024 no
 * cambia de color. En claro, aqua y amarillo quedan bajo 3:1 de contraste; por
 * eso cada línea lleva etiqueta directa y el panel ofrece la vista de tabla.
 */
const COLORES_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const COLORES_OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500'];

export const colorDeAnio = (anio: number, tema: 'claro' | 'oscuro'): string =>
  (tema === 'claro' ? COLORES_CLARO : COLORES_OSCURO)[anio % 4];

export interface PuntoGrafico {
  x: number;
  y: number;
  mes: NdviMes;
}

export interface SerieGrafico {
  anio: number;
  /** Tramos continuos: un mes sin dato corta la línea, nunca se interpola. */
  tramos: PuntoGrafico[][];
  puntos: PuntoGrafico[];
  /** Polígono de la banda P25–P75, un polígono por tramo. */
  bandas: string[];
  etiqueta: { x: number; y: number } | null;
}

export interface LayoutGrafico {
  ancho: number;
  alto: number;
  area: { izq: number; der: number; arr: number; aba: number };
  yMin: number;
  yMax: number;
  ticksY: { valor: number; y: number }[];
  ticksX: { etiqueta: string; x: number }[];
  series: SerieGrafico[];
  xDeMes: (indiceMes: number) => number;
  yDeValor: (v: number) => number;
}

export function layoutGrafico(serie: NdviSerie, ancho: number, alto: number): LayoutGrafico {
  const area = { izq: 34, der: ancho - 44, arr: 10, aba: alto - 22 };
  const valores = serie.meses.flatMap((m) => (m.estado === 'ok' ? [m.p25!, m.p75!] : []));
  // Escala fija de 0 a 1 salvo que haya datos negativos (agua, suelo mojado):
  // una escala que se ajusta a cada lugar exagera diferencias de 0,02.
  const yMin = Math.min(0, Math.floor(Math.min(0, ...valores) * 10) / 10);
  const yMax = 1;
  const xDeMes = (i: number) => area.izq + ((area.der - area.izq) * (i + 0.5)) / 12;
  const yDeValor = (v: number) => area.aba - ((v - yMin) / (yMax - yMin)) * (area.aba - area.arr);

  const porAnio = new Map<number, NdviMes[]>();
  for (const m of serie.meses) {
    const anio = Number(m.mes.slice(0, 4));
    porAnio.set(anio, [...(porAnio.get(anio) ?? []), m]);
  }

  const series: SerieGrafico[] = [...porAnio.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([anio, meses]) => {
      const tramos: PuntoGrafico[][] = [];
      let actual: PuntoGrafico[] = [];
      for (let i = 0; i < 12; i++) {
        const mes = meses.find((m) => Number(m.mes.slice(5)) === i + 1);
        if (mes?.estado === 'ok') {
          actual.push({ x: xDeMes(i), y: yDeValor(mes.mediana!), mes });
        } else if (actual.length) {
          tramos.push(actual);
          actual = [];
        }
      }
      if (actual.length) tramos.push(actual);
      const puntos = tramos.flat();
      const bandas = tramos.map((t) => {
        const arriba = t.map((p) => `${p.x},${yDeValor(p.mes.p75!)}`);
        const abajo = [...t].reverse().map((p) => `${p.x},${yDeValor(p.mes.p25!)}`);
        return [...arriba, ...abajo].join(' ');
      });
      const ultimo = puntos[puntos.length - 1];
      return { anio, tramos, puntos, bandas, etiqueta: ultimo ? { x: ultimo.x + 7, y: ultimo.y } : null };
    });

  separarEtiquetas(series);

  const ticksY = [0, 0.25, 0.5, 0.75, 1]
    .concat(yMin < 0 ? [yMin] : [])
    .map((valor) => ({ valor, y: yDeValor(valor) }));
  const ticksX = MESES_CORTOS.map((etiqueta, i) => ({ etiqueta, x: xDeMes(i) }));

  return { ancho, alto, area, yMin, yMax, ticksY, ticksX, series, xDeMes, yDeValor };
}

/** Las etiquetas directas al final de cada línea se separan en vertical para
 *  no superponerse cuando dos años terminan con valores parecidos. */
function separarEtiquetas(series: SerieGrafico[]) {
  const conEtiqueta = series.filter((s) => s.etiqueta).sort((a, b) => a.etiqueta!.y - b.etiqueta!.y);
  const separacion = 11;
  for (let i = 1; i < conEtiqueta.length; i++) {
    const previa = conEtiqueta[i - 1].etiqueta!;
    const actual = conEtiqueta[i].etiqueta!;
    if (Math.abs(actual.x - previa.x) < 40 && actual.y - previa.y < separacion) actual.y = previa.y + separacion;
  }
}

/** Año resaltado por defecto: el último con al menos 6 meses de dato; si no, el
 *  último que tenga alguno. */
export function anioPorDefecto(serie: NdviSerie): number | null {
  const conteo = new Map<number, number>();
  for (const m of serie.meses) {
    if (m.estado !== 'ok') continue;
    const anio = Number(m.mes.slice(0, 4));
    conteo.set(anio, (conteo.get(anio) ?? 0) + 1);
  }
  const anios = [...conteo.keys()].sort((a, b) => b - a);
  return anios.find((a) => conteo.get(a)! >= 6) ?? anios[0] ?? null;
}
