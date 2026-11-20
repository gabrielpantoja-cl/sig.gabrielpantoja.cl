/**
 * Catálogo STAC de Sentinel-2 L2A (solo servidor) para la capa NDVI Visual.
 *
 * Fuente: catálogo STAC de Element 84 (`sentinel-2-l2a`); los assets son COG
 * en el bucket público `sentinel-cogs` y `ndvi-raster.ts` los lee por HTTP
 * range request con `geotiff`.
 *
 * Las máscaras de abajo vienen de fallos medidos en la costa valdiviana: la
 * SCL sola deja pasar nube fina y, con sol bajo de invierno, la corrección
 * atmosférica deja el rojo en DN 1-5 en laderas en sombra y el NDVI satura
 * en ~1. Reflectancia = DN × 1e-4, siempre: los COG ya traen restado el offset
 * BOA aunque `raster:bands` siga declarando `offset: -0.1`.
 */

import 'server-only';

const STAC_SEARCH = 'https://earth-search.aws.element84.com/v1/search';

/** 0 nodata · 1 saturado · 2 área oscura/sombra topográfica · 3 sombra de nube ·
 *  7 no clasificado · 8/9 nube · 10 cirro · 11 nieve. La 7 es donde Sen2Cor deja
 *  la nube fina de baja probabilidad: en un pino adulto sumó 3.468 píxeles con
 *  NDVI 0,42 en una escena del 63 % nublada. */
export const SCL_INVALIDAS = new Set([0, 1, 2, 3, 7, 8, 9, 10, 11]);
/** Rojo por debajo de esto es el piso del sensor tras la corrección atmosférica
 *  en sombra, no una medición: con rojo ≈ 0 el NDVI satura en 1. */
export const ROJO_DN_MINIMO = 20;
export interface StacAsset {
  href: string;
  'proj:transform': number[];
  'proj:shape': number[];
}

export interface StacItem {
  id: string;
  properties: Record<string, unknown> & { datetime: string };
  assets: Record<string, StacAsset>;
  /** Caja WGS84 de la escena; `ndvi-raster.ts` la usa como prefiltro barato
   *  antes de proyectar píxel a píxel. */
  bbox?: [number, number, number, number];
}

async function buscarEscenas(
  espacial: Record<string, unknown>,
  desde: string,
  hasta: string,
  signal: AbortSignal,
): Promise<StacItem[]> {
  // Al catálogo se le manda un punto o una caja, nunca la geometría del
  // usuario: un anillo con aristas coincidentes lo rechaza con 400
  // («Cannot determine orientation»), y las escenas miden 110 km de lado, así
  // que la caja selecciona exactamente las mismas.
  const base = {
    collections: ['sentinel-2-l2a'],
    ...espacial,
    datetime: `${desde}T00:00:00Z/${hasta}T23:59:59Z`,
    // Por encima de 90 % de nubes en la cuadrícula no queda área útil en la
    // práctica, y el filtro recorta ~35 % del JSON que hay que paginar.
    query: { 'eo:cloud_cover': { lt: 90 } },
    limit: 100,
  };
  const items: StacItem[] = [];
  let url = STAC_SEARCH;
  let body: Record<string, unknown> = base;
  for (let pagina = 0; pagina < 10; pagina++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`Catálogo STAC respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      features: StacItem[];
      links?: { rel: string; href: string; body?: Record<string, unknown> }[];
    };
    items.push(...json.features);
    const next = json.links?.find((l) => l.rel === 'next');
    if (!next) break;
    url = next.href;
    body = { ...base, ...(next.body ?? {}) };
  }
  return items;
}

/** Escenas que intersectan una caja [oeste, sur, este, norte] en la ventana de
 *  fechas dada. La usa `ndvi-raster.ts` (NDVI Visual) para componer el PNG por
 *  viewport. */
export async function buscarEscenasPorCaja(
  bbox: readonly [number, number, number, number],
  desde: string,
  hasta: string,
  signal: AbortSignal,
): Promise<StacItem[]> {
  return buscarEscenas({ bbox: [...bbox] }, desde, hasta, signal);
}
