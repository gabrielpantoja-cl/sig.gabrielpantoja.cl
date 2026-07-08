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
