import L from 'leaflet';
import { tileSources, type TileSource } from '@/lib/tile-sources';

export type { TileSource };

/**
 * Tiles con respaldo al nivel padre.
 *
 * Esri World_Imagery declara z0–23 en todo el mundo, pero la ortoimagen real
 * se acaba antes según la zona: en el Chile rural suele llegar a z18 y en z19
 * el servidor responde 200 con un tile gris «Map data not yet available».
 * Como es un 200, Leaflet no puede saber que falta y el mapa se llena de
 * esos avisos al acercarse.
 *
 * Con `?blankTile=false` el mismo servidor devuelve 404 donde no hay imagen.
 * Esta capa aprovecha el 404: si un tile falla, pide su padre (z-1, z-2, …)
 * y muestra el cuadrante que le corresponde, ampliado. Se ve más blando,
 * pero la imagen persiste en vez de desaparecer. El export PNG
 * (`lib/map-export.ts`) usa las mismas fuentes, en el mismo orden.
 */

/**
 * `L.TileLayer` cuyos tiles son un `<div>` con un `<img>` dentro: si el tile
 * no existe (404), el `<img>` pasa al padre, escalado y desplazado para que
 * su cuadrante calce exacto. Solo sirve para proveedores que responden error
 * (no un tile de relleno) donde no hay datos.
 */
export class FallbackTileLayer extends L.TileLayer {
  /** URL de una fuente concreta, sin pasar por `_getZoomForUrl`. */
  sourceUrl(s: { x: number; y: number; z: number }): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;
    return L.Util.template(self._url as string, {
      ...this.options,
      r: '',
      s: self._getSubdomain(s),
      x: s.x,
      y: s.y,
      z: s.z,
    });
  }

  /** Fuentes de un tile en las coordenadas de URL (respeta `maxNativeZoom`). */
  sourcesFor(coords: L.Coords): TileSource[] {
    const rawSize = this.options.tileSize;
    const size = typeof rawSize === 'number' ? rawSize : 256;
    return tileSources(coords.x, coords.y, coords.z, size);
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const rawSize = this.options.tileSize;
    const size = typeof rawSize === 'number' ? rawSize : 256;
    // `coords.z` ya es el zoom de URL: GridLayer arma la grilla en
    // `_tileZoom`, que se topa en `maxNativeZoom`.
    const fuentes = this.sourcesFor(coords);
    const tile = document.createElement('div');
    tile.style.overflow = 'hidden';
    const img = document.createElement('img');
    img.alt = '';
    img.setAttribute('role', 'presentation');
    img.decoding = 'async';
    if (this.options.crossOrigin || this.options.crossOrigin === '') {
      img.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
    }
    img.style.position = 'absolute';
    img.style.maxWidth = 'none';
    tile.appendChild(img);

    let i = 0;
    const cargar = () => {
      const f = fuentes[i];
      const escala = size / f.cropSize;
      img.style.width = `${size * escala}px`;
      img.style.height = `${size * escala}px`;
      img.style.left = `${-f.cropX * escala}px`;
      img.style.top = `${-f.cropY * escala}px`;
      img.src = this.sourceUrl(f);
    };
    img.onload = () => done(undefined, tile);
    img.onerror = () => {
      i += 1;
      if (i < fuentes.length) cargar();
      else done(new Error('tile sin imagen'), tile);
    };
    cargar();
    return tile;
  }
}
