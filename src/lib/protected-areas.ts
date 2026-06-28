/**
 * Categorías legales de áreas protegidas de Chile (campo `designacion_ap` del
 * Registro Nacional de Áreas Protegidas, MMA) y su color en el mapa.
 *
 * Las 12 designaciones provienen del dato oficial CC0. La paleta agrupa por
 * naturaleza: conservación terrestre del Estado en verdes, ambientes marinos en
 * azules, y conservación privada/comunitaria en un tono distinto.
 */
export const CATEGORY_COLORS: Record<string, string> = {
  'Parque Nacional': '#1b7837',
  'Reserva Nacional': '#4daf4a',
  'Reserva Forestal': '#74c476',
  'Monumento Natural': '#b2182b',
  'Santuario de la Naturaleza': '#762a83',
  'Reserva de la Biófera': '#e08214',
  'Bien Nacional Protegido': '#8c6d31',
  'Paisaje de Conservación': '#01665e',
  'Conservación Privada y Comunitaria': '#d6604d',
  'Área Marina Costera Protegida': '#2166ac',
  'Reserva Marina': '#4393c3',
  'Parque Marino': '#053061',
};

export const DEFAULT_CATEGORY_COLOR = '#666666';

export function categoryColor(designacion: string | null | undefined): string {
  return (designacion && CATEGORY_COLORS[designacion]) || DEFAULT_CATEGORY_COLOR;
}

/** Propiedades de cada feature en areas-protegidas.geojson */
export interface ProtectedAreaProps {
  cod_rnap: string | null;
  nombre_ap: string | null;
  region: string | null;
  designacion_ap: string | null;
  ha: number | null;
  url_fuente: string | null;
}
