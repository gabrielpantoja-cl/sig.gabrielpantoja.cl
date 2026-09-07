import { COMUNAS_STYLE } from './comunas';
import { SUELOS_OPACITY } from './suelos';
import { VEGETACIONAL_OPACITY } from './vegetacional';
import { PROPIEDADES_RURALES_OPACITY } from './propiedades-rurales';

/** Opacidad absoluta; en vectores solo cambia el relleno, no el borde. */
export const DEFAULT_LAYER_OPACITY = {
  comunas: COMUNAS_STYLE.fillOpacity,
  suelos: SUELOS_OPACITY,
  bioclima: 0.6,
  vegetacional: VEGETACIONAL_OPACITY,
  propiedadesRurales: PROPIEDADES_RURALES_OPACITY,
  catastroFruticola: 0.32,
};

export type LayerOpacity = typeof DEFAULT_LAYER_OPACITY;
