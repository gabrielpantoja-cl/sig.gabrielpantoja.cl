import type { FeatureCollection, Geometry } from 'geojson';

/**
 * Caché en memoria de GeoJSON estáticos que más de una capa necesita. Hoy solo
 * los límites comunales (2,8 MB): los usa su propia capa y la jurisdicción de
 * los Conservadores, que debe funcionar con «Límites comunales» apagada sin
 * descargar ni parsear el archivo dos veces. NO pasar por aquí capas grandes de
 * un solo uso (catastro frutícola, 30 MB): quedarían retenidas toda la sesión.
 *
 * La promesa es compartida, así que no lleva `AbortSignal`: quien deja de
 * necesitar el dato descarta el resultado en vez de cancelar la descarga de
 * otro. Un fallo se olvida para que el siguiente intento reintente.
 */
const cache = new Map<string, Promise<FeatureCollection<Geometry, unknown>>>();

export function loadGeoJsonCached<P>(url: string): Promise<FeatureCollection<Geometry, P>> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${url}: ${response.status}`))))
      .catch((error: unknown) => {
        cache.delete(url);
        throw error;
      });
    cache.set(url, pending);
  }
  return pending as Promise<FeatureCollection<Geometry, P>>;
}
