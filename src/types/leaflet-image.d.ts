/**
 * leaflet-image (v0.4.x) viene sin definiciones de tipos. Este ambient module
 * expone su default export como la función `(map, callback) => void` que la
 * librería define: rasteriza el mapa (tiles + capas vectoriales en canvas,
 * excluyendo divIcons y MarkerClusterGroup) a un HTMLCanvasElement vía
 * callback. Ver https://github.com/mapbox/leaflet-image para el contrato.
 */
declare module 'leaflet-image' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leafletImage: (map: any, callback: (err: Error | null, canvas: HTMLCanvasElement) => void) => void;
  export default leafletImage;
}
