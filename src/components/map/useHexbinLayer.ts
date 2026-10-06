'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import type { FeatureCollection, Point } from 'geojson';
import {
  DESTINO_DEFAULT,
  HEXBINS_ATTRIBUTION,
  HEXBINS_URL,
  HEXBIN_MIN_N_DEFAULT,
  quantileBreaks,
  type HexbinMeta,
  type HexbinProps,
  type HexbinRampId,
  type HexbinStatus,
} from '@/lib/hexbins';
import { quantileScale, renderHeatSurface, type HeatSample } from '@/lib/heat-surface';
import { buildHexbinPopup } from '@/lib/map-popups';
import { TRANSPARENT_PIXEL } from '@/lib/suelos';

/** Una muestra de la superficie de calor, con su posición geográfica. */
export interface HexbinSample {
  lat: number;
  lng: number;
  props: HexbinProps;
}

/** Muestras de la superficie vigente: el popup busca la celda más cercana al clic. */
export interface HexbinSamples {
  samples: HexbinSample[];
  meta: HexbinMeta;
}

/**
 * Mapa de calor de valor — superficie continua interpolada por viewport.
 *
 * El servidor devuelve los centroides de una malla hexagonal con la MEDIANA
 * de $/m² por celda (`/api/hexbins`); aquí esas muestras se interpolan con un
 * kernel gaussiano (`lib/heat-surface.ts`) hacia un raster continuo que se
 * monta como `L.ImageOverlay`, igual que las capas remotas de suelos y CONAF.
 *
 * Por qué un raster y no polígonos: dibujar un hexágono por celda producía un
 * mosaico con huecos donde ninguna celda alcanzaba el umbral, y la retícula
 * se leía como un artefacto del método en vez de como el dato. La superficie
 * interpolada rellena el gradiente entre muestras y se desvanece donde no hay
 * respaldo, que es lo que se espera de un heatmap en un SIG.
 *
 * El raster se calcula sobre un bbox con 25 % de margen sobre el viewport
 * para que el borde de la pantalla no corte la interpolación; el overlay se
 * ancla a ese bbox ampliado.
 */
export function useHexbinLayer({
  mapRef,
  hexbinsRef,
  hexbinSamplesRef,
  showHexbins,
  hexbinDestino,
  hexbinMinN,
  hexbinFiltersQs,
  hexbinRamp,
  onHexbinStatusRef,
  ndviModeRef,
  reorderOverlays,
}: {
  mapRef: RefObject<L.Map | null>;
  hexbinsRef: RefObject<L.ImageOverlay | null>;
  hexbinSamplesRef: RefObject<HexbinSamples | null>;
  showHexbins: boolean;
  hexbinDestino: string | undefined;
  hexbinMinN: number | undefined;
  hexbinFiltersQs: string;
  hexbinRamp: HexbinRampId;
  onHexbinStatusRef: RefObject<((status: HexbinStatus) => void) | undefined>;
  ndviModeRef: RefObject<boolean>;
  reorderOverlays: () => void;
}): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (hexbinsRef.current) {
      map.removeLayer(hexbinsRef.current);
      hexbinsRef.current = null;
    }
    hexbinSamplesRef.current = null;

    if (!showHexbins) {
      onHexbinStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: 1,
      interactive: false,
      attribution: HEXBINS_ATTRIBUTION,
    }).addTo(map);
    hexbinsRef.current = overlay;

    let sequence = 0;
    let controller: AbortController | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      hexbinSamplesRef.current = null;
    };

    const refresh = async () => {
      const id = ++sequence;
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      onHexbinStatusRef.current?.({ kind: 'loading' });

      // Margen del 25 %: sin él la gaussiana se trunca justo en el borde de la
      // pantalla y la superficie aparece recortada en seco al panear.
      const padded = map.getBounds().pad(0.25);
      const round = (n: number): string => n.toFixed(3);
      const params = new URLSearchParams(hexbinFiltersQs);
      params.set(
        'bbox',
        [padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth()]
          .map(round)
          .join(','),
      );
      params.set('z', String(map.getZoom()));
      params.set('destino', hexbinDestino ?? DESTINO_DEFAULT);
      params.set('min_n', String(hexbinMinN ?? HEXBIN_MIN_N_DEFAULT));

      try {
        const response = await fetch(`${HEXBINS_URL}?${params}`, { signal: ctrl.signal });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as FeatureCollection<Point, HexbinProps> &
          HexbinMeta;
        if (id !== sequence || !mapRef.current) return;

        const meta: HexbinMeta = {
          edge_m: data.edge_m,
          destino: data.destino,
          min_n: data.min_n,
          cells: data.cells,
          points: data.points,
        };

        if (!data.features.length) {
          clear();
          onHexbinStatusRef.current?.({ kind: 'empty', meta });
          return;
        }

        const zoom = map.getZoom();
        const nw = map.project(padded.getNorthWest(), zoom);
        const se = map.project(padded.getSouthEast(), zoom);
        const width = Math.round(se.x - nw.x);
        const height = Math.round(se.y - nw.y);

        const samples: HeatSample[] = [];
        const located: HexbinSample[] = [];
        for (const feature of data.features) {
          const [lng, lat] = feature.geometry.coordinates;
          const projected = map.project(L.latLng(lat, lng), zoom);
          samples.push({
            x: projected.x - nw.x,
            y: projected.y - nw.y,
            value: feature.properties.mediana_ppm2,
            n: feature.properties.n,
          });
          located.push({ lat, lng, props: feature.properties });
        }

        // El radio del kernel se ata al espaciado real de la malla, no a un
        // número fijo de píxeles: así el grado de suavizado es el mismo a
        // cualquier zoom. En una malla hexagonal de arista `a` el paso
        // centro-a-centro es 1,5·a en x y 1,73·a en y (~1,6·a de media).
        //
        // El factor 1,45 se calibró contra Valdivia y Chillán: con 1,9 cada
        // píxel promediaba una docena de celdas y la ciudad se convertía en
        // tres manchas gigantes sin estructura de barrio; con 1,15 volvía el
        // moteado, porque la mediana de 2–3 ventas en una celda es ruidosa y
        // sin solape suficiente ese ruido se ve tal cual. 1,45 promedia ~6–8
        // celdas vecinas: filtra el ruido y conserva el gradiente de barrio.
        const metersPerPixel =
          (40075016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) /
          (256 * Math.pow(2, zoom));
        const spacingPx = (meta.edge_m * 1.6) / metersPerPixel;
        const radiusPx = Math.min(120, Math.max(14, spacingPx * 1.45));

        const values = data.features.map((f) => f.properties.mediana_ppm2);
        const scale = quantileScale(values);
        const canvas = renderHeatSurface({
          width,
          height,
          samples,
          radiusPx,
          ramp: hexbinRamp,
          scale,
        });
        if (id !== sequence || !mapRef.current || !canvas) {
          if (!canvas) clear();
          return;
        }

        overlay.setBounds(padded);
        overlay.setUrl(canvas.toDataURL('image/png'));
        hexbinSamplesRef.current = { samples: located, meta };
        reorderOverlays();
        onHexbinStatusRef.current?.({
          kind: 'ready',
          meta,
          breaks: quantileBreaks(values),
          scale,
          ramp: hexbinRamp,
        });
      } catch (err) {
        if (ctrl.signal.aborted || (err as Error)?.name === 'AbortError') return;
        clear();
        onHexbinStatusRef.current?.({ kind: 'error' });
      }
    };

    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 250);
    };

    // La superficie es un raster sin geometría clicable, así que la consulta
    // puntual se resuelve contra las muestras: se abre el popup de la celda más
    // cercana al clic, dentro de un radio de una celda y media. Fuera de eso el
    // clic pertenece a otra capa (o al mapa) y no se intercepta.
    const onClick = (event: L.LeafletMouseEvent) => {
      // Con la herramienta NDVI armada el clic pertenece a la consulta, no al
      // mapa de calor.
      if (ndviModeRef.current) return;
      const state = hexbinSamplesRef.current;
      if (!state || !state.samples.length) return;
      let best: HexbinSample | null = null;
      let bestDistance = Infinity;
      for (const sample of state.samples) {
        const distance = map.distance(event.latlng, L.latLng(sample.lat, sample.lng));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = sample;
        }
      }
      if (!best || bestDistance > state.meta.edge_m * 1.5) return;
      L.popup({ maxWidth: 300 })
        .setLatLng(event.latlng)
        .setContent(buildHexbinPopup(best.props, state.meta))
        .openOn(map);
    };

    void refresh();
    map.on('moveend', scheduleRefresh);
    map.on('click', onClick);
    return () => {
      if (debounce) clearTimeout(debounce);
      controller?.abort();
      // Invalida cualquier respuesta en vuelo que ya no tenga dónde pintarse.
      sequence++;
      map.off('moveend', scheduleRefresh);
      map.off('click', onClick);
      hexbinSamplesRef.current = null;
      if (map.hasLayer(overlay)) map.removeLayer(overlay);
      if (hexbinsRef.current === overlay) hexbinsRef.current = null;
    };
  }, [
    showHexbins,
    hexbinDestino,
    hexbinMinN,
    hexbinFiltersQs,
    hexbinRamp,
    reorderOverlays,
    hexbinSamplesRef,
    hexbinsRef,
    mapRef,
    ndviModeRef,
    onHexbinStatusRef,
  ]);
}
