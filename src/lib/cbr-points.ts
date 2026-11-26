/**
 * Estilo de la capa principal: transacciones CBR.
 *
 * Los puntos se dibujan como marcadores tipo «pin» (gota) en rojo carmesí con
 * halo blanco. El verde de marca original se confundía con el mapa base de
 * OpenStreetMap —cuyos parques y bosques son verdes y el agua azul—, así que
 * se eligió un color de alto contraste contra verde/azul/gris. La forma de
 * gota, además, los distingue de las capas KML del usuario (círculos) y de las
 * capas temáticas (áreas protegidas y límite urbano ámbar), y su punta inferior
 * marca la coordenada exacta de la inscripción.
 */

export const CBR_POINT_COLOR = '#e11d48';

/**
 * Anillos de agrupación (`leaflet.markercluster`).
 *
 * El radio crece con una escala logarítmica acotada entre `2` y `25.000`
 * transacciones: el rango real va de clústeres de 2 a más de 50.000 puntos, y
 * una escala lineal dejaría casi todos los anillos del mismo tamaño. Estos
 * valores los comparten el `iconCreateFunction` del mapa en vivo
 * (`MapView.tsx`) y el compositor del PNG (`map-export.ts`): nunca duplicar
 * números en ninguno de los dos.
 */
export const CBR_CLUSTER_MIN_RADIUS = 9;
export const CBR_CLUSTER_MAX_RADIUS = 26;
export const CBR_CLUSTER_STROKE_WIDTH = 2;
export const CBR_CLUSTER_HALO_WIDTH = 1.5;
export const CBR_CLUSTER_FILL_OPACITY = 0.1;
/** Margen del SVG alrededor del anillo para que el halo nunca se recorte. */
export const CBR_CLUSTER_PADDING = 4;

const CBR_CLUSTER_MIN_COUNT = 2;
const CBR_CLUSTER_MAX_COUNT = 25_000;

/**
 * Radio del anillo para `count` transacciones agrupadas. Función pura y
 * monótona no decreciente: `count <= 2` (o un valor no finito, que solo puede
 * venir de una entrada corrupta) cae al mínimo; desde `25.000` se satura en el
 * máximo. `Math.round` evita subpíxeles y mantiene el `boxSize` par.
 */
export function cbrClusterRadius(count: number): number {
  if (!Number.isFinite(count) || count <= CBR_CLUSTER_MIN_COUNT) {
    return CBR_CLUSTER_MIN_RADIUS;
  }
  const t = Math.min(
    1,
    Math.max(
      0,
      (Math.log10(count) - Math.log10(CBR_CLUSTER_MIN_COUNT)) /
        (Math.log10(CBR_CLUSTER_MAX_COUNT) - Math.log10(CBR_CLUSTER_MIN_COUNT)),
    ),
  );
  return Math.round(
    CBR_CLUSTER_MIN_RADIUS + t * (CBR_CLUSTER_MAX_RADIUS - CBR_CLUSTER_MIN_RADIUS),
  );
}

/**
 * Anillo SVG de un clúster: halo blanco exterior, trazo carmesí y velo interior
 * mínimo, sin ningún texto numérico visible. El conteo vive solo en el
 * `title`/`aria-label` (formato `es-CL`), de modo que el mapa queda limpio pero
 * un lector de pantalla igual anuncia cuántas transacciones agrupa.
 *
 * `boxSize` es siempre par (`2 * (radio + padding)`), así el centro cae en un
 * píxel exacto y `iconAnchor` puede ser la mitad justa del contenedor.
 */
export function cbrClusterSvg(count: number): {
  html: string;
  boxSize: number;
  radius: number;
} {
  const radius = cbrClusterRadius(count);
  const boxSize = (radius + CBR_CLUSTER_PADDING) * 2;
  const center = boxSize / 2;

  const safeCount = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
  const label = `${safeCount.toLocaleString('es-CL')} ${
    safeCount === 1 ? 'transacción agrupada' : 'transacciones agrupadas'
  }`;

  const html =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${boxSize}" height="${boxSize}" ` +
    `viewBox="0 0 ${boxSize} ${boxSize}" role="img" aria-label="${label}">` +
    `<title>${label}</title>` +
    // Halo de contraste: mismo centro y radio, trazo más ancho y blanco
    // translúcido. Se pinta primero para que el anillo carmesí quede encima.
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" ` +
    `stroke="rgba(255,255,255,0.85)" ` +
    `stroke-width="${CBR_CLUSTER_STROKE_WIDTH + CBR_CLUSTER_HALO_WIDTH * 2}"/>` +
    `<circle cx="${center}" cy="${center}" r="${radius}" fill="${CBR_POINT_COLOR}" ` +
    `fill-opacity="${CBR_CLUSTER_FILL_OPACITY}" stroke="${CBR_POINT_COLOR}" ` +
    `stroke-width="${CBR_CLUSTER_STROKE_WIDTH}"/>` +
    `</svg>`;

  return { html, boxSize, radius };
}

/**
 * SVG de un pin (gota) con halo blanco y una leve sombra para despegarlo de
 * fondos recargados. Se comparte una única instancia entre los ~74k puntos.
 */
export const cbrPinSvg = (color: string = CBR_POINT_COLOR): string =>
  `<svg width="24" height="32" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" ` +
  `style="filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))">` +
  `<path d="M12 1.6C6.2 1.6 1.6 6.2 1.6 12c0 8 10.4 18.4 10.4 18.4S22.4 20 22.4 12C22.4 6.2 17.8 1.6 12 1.6z" ` +
  `fill="${color}" stroke="#fff" stroke-width="2"/>` +
  `<circle cx="12" cy="12" r="4" fill="#fff"/>` +
  `</svg>`;
