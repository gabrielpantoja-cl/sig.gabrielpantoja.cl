/**
 * Escala numérica y medición: lógica pura de la herramienta «Medir» del mapa
 * (`src/components/map/useMeasureControl.ts`) y de la escala `1:N` (pantalla y
 * PNG). Separada del DOM para testearla.
 *
 * Geodesia: las distancias son de círculo máximo (haversine) y las superficies
 * se calculan sobre la esfera (fórmula de Chamberlain y Duquette, la misma de
 * Leaflet.draw), con el radio medio terrestre. Frente al elipsoide WGS84 el
 * error es < 0,5 %: suficiente para leer un predio en el mapa, nunca para
 * reemplazar la superficie del plano o del título, y la UI lo dice.
 */

/** Radio medio terrestre (IUGG), en metros. */
export const RADIO_TIERRA_M = 6_371_008.8;

/** Tamaño físico del píxel CSS: por definición 1/96 de pulgada (0,2646 mm). */
export const METROS_POR_PIXEL_CSS = 0.0254 / 96;

/** Circunferencia ecuatorial de Web Mercator, la que usa `L.Control.Scale`. */
const CIRCUNFERENCIA_M = 40_075_016.686;

export type Punto = { lat: number; lng: number };

export type ModoMedicion = 'distancia' | 'superficie';

const rad = (grados: number) => (grados * Math.PI) / 180;

/** Metros por píxel CSS en el terreno, a la latitud dada y con ese zoom. */
export function metrosPorPixel(lat: number, zoom: number): number {
  return (CIRCUNFERENCIA_M * Math.cos(rad(lat))) / 2 ** (zoom + 8);
}

/**
 * Denominador de la escala numérica en pantalla. Supone el píxel CSS de
 * 1/96 de pulgada (la convención de la web, la misma de ArcGIS): en un monitor
 * concreto la escala real difiere según su densidad, por eso la barra gráfica
 * sigue siendo la referencia y el número la acompaña, no la reemplaza.
 */
export function denominadorEscala(lat: number, zoom: number): number {
  return metrosPorPixel(lat, zoom) / METROS_POR_PIXEL_CSS;
}

/**
 * Redondea el denominador a dos cifras significativas (1:23.456 → 1:23.000):
 * más precisión sería falsa, la escala varía con la latitud dentro del mismo
 * encuadre.
 */
export function redondearEscala(denominador: number): number {
  if (!Number.isFinite(denominador) || denominador <= 0) return 0;
  const magnitud = 10 ** Math.max(0, Math.floor(Math.log10(denominador)) - 1);
  return Math.round(denominador / magnitud) * magnitud;
}

/** «1:25.000». Vacío si la entrada no tiene sentido. */
export function formatoEscala(lat: number, zoom: number): string {
  const n = redondearEscala(denominadorEscala(lat, zoom));
  return n > 0 ? `1:${n.toLocaleString('es-CL')}` : '';
}

/** Distancia de círculo máximo entre dos puntos, en metros. */
export function distanciaM(a: Punto, b: Punto): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Largo de una polilínea; con `cerrada`, suma el tramo de vuelta al inicio. */
export function longitudM(puntos: readonly Punto[], cerrada = false): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) total += distanciaM(puntos[i - 1], puntos[i]);
  if (cerrada && puntos.length > 2) total += distanciaM(puntos[puntos.length - 1], puntos[0]);
  return total;
}

/**
 * Superficie de un polígono simple sobre la esfera, en m². Da lo mismo el
 * sentido de giro. Menos de tres vértices es superficie cero.
 */
export function superficieM2(puntos: readonly Punto[]): number {
  if (puntos.length < 3) return 0;
  let suma = 0;
  for (let i = 0; i < puntos.length; i++) {
    const p1 = puntos[i];
    const p2 = puntos[(i + 1) % puntos.length];
    suma += rad(p2.lng - p1.lng) * (2 + Math.sin(rad(p1.lat)) + Math.sin(rad(p2.lat)));
  }
  return Math.abs((suma * RADIO_TIERRA_M ** 2) / 2);
}

const numero = (valor: number, decimales: number) =>
  valor.toLocaleString('es-CL', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** «845 m», «12,4 m», «3,27 km». */
export function formatoDistancia(metros: number): string {
  if (!Number.isFinite(metros) || metros < 0) return '—';
  if (metros < 100) return `${numero(metros, 1)} m`;
  if (metros < 1000) return `${numero(metros, 0)} m`;
  if (metros < 100_000) return `${numero(metros / 1000, 2)} km`;
  return `${numero(metros / 1000, 1)} km`;
}

/**
 * Superficie como la lee un tasador: m² para sitios, hectáreas para predios
 * (con los m² entre paréntesis hasta 100 ha, porque así vienen en las
 * escrituras) y km² solo para extensiones grandes.
 */
export function formatoSuperficie(m2: number): string {
  if (!Number.isFinite(m2) || m2 < 0) return '—';
  if (m2 < 10_000) return `${numero(m2, 0)} m²`;
  const ha = m2 / 10_000;
  if (ha < 100) return `${numero(ha, 2)} ha (${numero(m2, 0)} m²)`;
  if (ha < 100_000) return `${numero(ha, 1)} ha`;
  return `${numero(m2 / 1_000_000, 0)} km²`;
}

/** Texto del resultado de una medición, para la etiqueta en el mapa y el PNG. */
export function resumenMedicion(modo: ModoMedicion, puntos: readonly Punto[]): string {
  if (modo === 'distancia') return formatoDistancia(longitudM(puntos));
  if (puntos.length < 3) return formatoDistancia(longitudM(puntos));
  return `${formatoSuperficie(superficieM2(puntos))} · perímetro ${formatoDistancia(longitudM(puntos, true))}`;
}
