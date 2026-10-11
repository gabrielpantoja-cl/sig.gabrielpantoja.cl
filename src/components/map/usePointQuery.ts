'use client';

import { useEffect, type RefObject } from 'react';
import L from 'leaflet';
import type { Feature, Geometry } from 'geojson';
import { lecturaCursor } from '@/lib/coordenadas';
import { mensajeFalla, pointInGeometry, type ConsultaSeccion } from '@/lib/consulta-punto';
import type { HexbinSamples } from '@/components/map/useHexbinLayer';
import {
  buildCatastroFruticolaPopup,
  buildComunaPopup,
  buildConsultaPuntoPopup,
  buildHexbinPopup,
  buildHumedalesPopup,
  buildPropiedadRuralResult,
  buildProtectedPopup,
  buildSuelosResult,
  buildUrbanLimitPopup,
  buildVegetacionalPopup,
} from '@/lib/map-popups';
import { HUMEDALES_IDENTIFY_URL, HUMEDALES_MIN_ZOOM, HUMEDALES_SERVICE_NAME, type HumedalIdentifyResult } from '@/lib/humedales';
import { SUELOS_IDENTIFY_URL, SUELOS_MIN_ZOOM, SUELOS_SERVICE_NAME } from '@/lib/suelos';
import { VEGETACIONAL_IDENTIFY_URL, VEGETACIONAL_MIN_ZOOM, VEGETACIONAL_SERVICE_NAME, type VegetacionalProps } from '@/lib/vegetacional';
import {
  PROPIEDADES_RURALES_IDENTIFY_URL,
  PROPIEDADES_RURALES_MIN_ZOOM,
  PROPIEDADES_RURALES_SERVICE_NAME,
} from '@/lib/propiedades-rurales';
import type { ProtectedAreaProps } from '@/lib/protected-areas';
import type { UrbanLimitProps } from '@/lib/urban-limit';
import type { ComunaProps } from '@/lib/comunas';
import type { CatastroFruticolaProps } from '@/lib/catastro-fruticola';

/** Qué capas consultables están encendidas. Se lee al momento del clic. */
export interface PointQueryFlags {
  humedales: boolean;
  suelos: boolean;
  vegetacional: boolean;
  propiedadesRurales: boolean;
  hexbins: boolean;
}

export interface PointQueryLayers {
  protectedRef: RefObject<L.GeoJSON | null>;
  urbanLimitRef: RefObject<L.GeoJSON | null>;
  comunasRef: RefObject<L.GeoJSON | null>;
  catastroFruticolaRef: RefObject<L.GeoJSON | null>;
  hexbinSamplesRef: RefObject<HexbinSamples | null>;
}

/** Máximo de coincidencias por capa estática (áreas protegidas se solapan). */
const MAX_MATCHES = 3;

/** Propiedades de los polígonos de una capa estática que contienen el punto. */
function containing<P>(layer: L.GeoJSON | null, latlng: L.LatLng): P[] {
  if (!layer) return [];
  const found: P[] = [];
  layer.eachLayer((item) => {
    if (found.length >= MAX_MATCHES) return;
    const feature = (item as L.Layer & { feature?: Feature<Geometry, P> }).feature;
    if (!feature) return;
    // Descarte barato por caja antes del ray casting (el catastro frutícola
    // tiene decenas de miles de polígonos).
    const bounds = (item as L.Polygon).getBounds?.();
    if (bounds && !bounds.contains(latlng)) return;
    if (pointInGeometry(latlng.lng, latlng.lat, feature.geometry)) found.push(feature.properties);
  });
  return found;
}

/**
 * Consulta integrada del punto («¿Qué hay aquí?»). Un único manejador de clic
 * reemplaza los que tenían suelos, CONAF, humedales, propiedades rurales y el
 * mapa de calor, más los popups de los polígonos estáticos (áreas protegidas,
 * límite urbano, comunas, catastro frutícola): antes cada uno abría su propio
 * popup, el último pisaba a los demás, y un clic dentro de una comuna anulaba
 * por completo la consulta de suelos o humedales.
 *
 * El popup se abre al instante con una sección «Consultando…» por cada capa
 * remota y se rehace a medida que responde cada servicio, en paralelo. Las
 * capas estáticas y el mapa de calor se resuelven en el navegador, sin red.
 *
 * Conservan su popup propio las capas donde el clic es deliberado sobre un
 * objeto: pines CBR, líneas (caminos, drenaje, transmisión) y KML. Si uno de
 * esos popups se abrió en el mismo clic, esta consulta no se dispara.
 */
export function usePointQuery({
  mapRef,
  flagsRef,
  layers,
  ndviModeRef,
}: {
  mapRef: RefObject<L.Map | null>;
  flagsRef: RefObject<PointQueryFlags>;
  layers: PointQueryLayers;
  ndviModeRef: RefObject<boolean>;
}): void {
  const { protectedRef, urbanLimitRef, comunasRef, catastroFruticolaRef, hexbinSamplesRef } = layers;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let controller: AbortController | null = null;
    let popupOpenedThisTurn = false;
    const onPopupOpen = () => {
      popupOpenedThisTurn = true;
      queueMicrotask(() => {
        popupOpenedThisTurn = false;
      });
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      if (popupOpenedThisTurn || ndviModeRef.current) return;
      const flags = flagsRef.current;
      const latlng = e.latlng;
      const zoom = map.getZoom();
      const secciones: ConsultaSeccion[] = [];
      const remotas: Array<() => Promise<void>> = [];

      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;

      const bounds = map.getBounds();
      const size = map.getSize();
      const identifyParams = new URLSearchParams({
        geometry: [latlng.lng, latlng.lat].join(','),
        mapExtent: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
        imageDisplay: [Math.max(1, Math.round(size.x)), Math.max(1, Math.round(size.y)), 96].join(','),
        tolerance: '2',
      }).toString();

      const set = (seccion: ConsultaSeccion) => {
        const i = secciones.findIndex((s) => s.id === seccion.id);
        if (i >= 0) secciones[i] = seccion;
      };

      /** Sección de una capa remota: identify vía el proxy same-origin. */
      const remota = <T,>(
        id: string,
        titulo: string,
        minZoom: number,
        url: string,
        servicio: string,
        resolver: (data: T) => ConsultaSeccion,
      ) => {
        if (zoom < minZoom) {
          secciones.push({ id, titulo, estado: 'vacio', mensaje: `Acerca el mapa (zoom ${minZoom} o más) para consultar esta capa.` });
          return;
        }
        secciones.push({ id, titulo, estado: 'cargando' });
        remotas.push(async () => {
          try {
            const response = await fetch(`${url}?${identifyParams}`, { signal: ctrl.signal });
            if (!response.ok) {
              set({ id, titulo, estado: 'error', mensaje: mensajeFalla(response.status, servicio) });
              return;
            }
            set(resolver((await response.json()) as T));
          } catch {
            if (ctrl.signal.aborted) return;
            set({ id, titulo, estado: 'error', mensaje: mensajeFalla(0, servicio) });
          }
        });
      };

      /** Sección de una capa estática: punto en polígono sobre lo ya cargado. */
      const estatica = <P,>(
        id: string,
        titulo: string,
        layer: L.GeoJSON | null,
        build: (props: P) => string,
        vacio: string,
      ) => {
        if (!layer) return;
        const found = containing<P>(layer, latlng);
        secciones.push(
          found.length
            ? { id, titulo, estado: 'listo', html: found.map(build).join('<div style="height:.4rem"></div>') }
            : { id, titulo, estado: 'vacio', mensaje: vacio },
        );
      };

      // Orden: lo ecológico y restrictivo primero, el contexto administrativo
      // y de mercado al final.
      if (flags.humedales) {
        remota<{ results?: HumedalIdentifyResult[] }>('humedales', 'Humedales · MMA', HUMEDALES_MIN_ZOOM,
          HUMEDALES_IDENTIFY_URL, HUMEDALES_SERVICE_NAME, (data) =>
            data.results?.length
              ? { id: 'humedales', titulo: 'Humedales · MMA', estado: 'listo', html: buildHumedalesPopup(data.results) }
              : { id: 'humedales', titulo: 'Humedales · MMA', estado: 'vacio', mensaje: 'Sin humedal inventariado ni humedal urbano declarado en este punto.' });
      }
      estatica<ProtectedAreaProps>('protegidas', 'Áreas protegidas · RNAP', protectedRef.current,
        buildProtectedPopup, 'Fuera de las áreas protegidas del RNAP.');
      if (flags.suelos) {
        remota<{ results?: { layerName?: string; soilClass?: string | null }[] }>('suelos', 'Suelos agrológicos · CIREN',
          SUELOS_MIN_ZOOM, SUELOS_IDENTIFY_URL, SUELOS_SERVICE_NAME, (data) => {
            const hit = data.results?.find((r) => r.soilClass);
            return hit?.soilClass
              ? { id: 'suelos', titulo: 'Suelos agrológicos · CIREN', estado: 'listo', html: buildSuelosResult(hit.soilClass, hit.layerName ?? '') }
              : { id: 'suelos', titulo: 'Suelos agrológicos · CIREN', estado: 'vacio', mensaje: 'Sin clase CIREN en este punto (fuera del área estudiada o sin clasificar).' };
          });
      }
      if (flags.vegetacional) {
        remota<{ results?: Array<{ layerName: string; attributes: VegetacionalProps }> }>('vegetacional',
          'Recursos vegetacionales · CONAF', VEGETACIONAL_MIN_ZOOM, VEGETACIONAL_IDENTIFY_URL, VEGETACIONAL_SERVICE_NAME, (data) => {
            const hit = data.results?.[0];
            return hit
              ? { id: 'vegetacional', titulo: 'Recursos vegetacionales · CONAF', estado: 'listo', html: buildVegetacionalPopup(hit.attributes, hit.layerName) }
              : { id: 'vegetacional', titulo: 'Recursos vegetacionales · CONAF', estado: 'vacio', mensaje: 'Sin polígono del catastro CONAF en este punto.' };
          });
      }
      estatica<CatastroFruticolaProps>('catastro', 'Catastro frutícola · CIREN', catastroFruticolaRef.current,
        buildCatastroFruticolaPopup, 'Sin huerto del catastro frutícola en este punto.');
      if (flags.propiedadesRurales) {
        remota<{ results?: Array<{ attributes?: { rol?: string | null; comuna?: string | null; codRegion?: string | null; quality?: string } }> }>(
          'rural', 'Propiedades rurales · CIREN', PROPIEDADES_RURALES_MIN_ZOOM, PROPIEDADES_RURALES_IDENTIFY_URL,
          PROPIEDADES_RURALES_SERVICE_NAME, (data) => {
            const hit = data.results?.[0]?.attributes;
            return hit
              ? { id: 'rural', titulo: 'Propiedades rurales · CIREN', estado: 'listo', html: buildPropiedadRuralResult(hit) }
              : { id: 'rural', titulo: 'Propiedades rurales · CIREN', estado: 'vacio', mensaje: 'Sin propiedad rural CIREN en este punto.' };
          });
      }
      estatica<UrbanLimitProps>('urbano', 'Límite urbano · PRC', urbanLimitRef.current,
        buildUrbanLimitPopup, 'Fuera de los límites urbanos (PRC) publicados por el MINVU.');
      estatica<ComunaProps>('comuna', 'Comuna · DPA', comunasRef.current, buildComunaPopup, 'Fuera de los límites comunales.');
      if (flags.hexbins) {
        const state = hexbinSamplesRef.current;
        let best: { props: Parameters<typeof buildHexbinPopup>[0]; d: number } | null = null;
        for (const sample of state?.samples ?? []) {
          const d = map.distance(latlng, L.latLng(sample.lat, sample.lng));
          if (!best || d < best.d) best = { props: sample.props, d };
        }
        secciones.push(
          state && best && best.d <= state.meta.edge_m * 1.5
            ? { id: 'calor', titulo: 'Mapa de calor de valor', estado: 'listo', html: buildHexbinPopup(best.props, state.meta) }
            : { id: 'calor', titulo: 'Mapa de calor de valor', estado: 'vacio', mensaje: 'Sin transacciones cerca de este punto con los filtros actuales.' },
        );
      }

      // Sin capas consultables encendidas el clic no abre nada (como antes).
      if (!secciones.length) return;

      const coords = lecturaCursor(latlng.lat, L.Util.wrapNum(latlng.lng, [-180, 180], true));
      // La barra de búsqueda y filtros flota sobre el borde superior del mapa:
      // el autopaneo deja margen para que el encabezado del popup (las
      // coordenadas) no quede debajo, y la altura se ajusta a la pantalla.
      const mapHeight = map.getSize().y;
      const popup = L.popup({
        maxWidth: 360,
        maxHeight: Math.max(200, Math.min(440, mapHeight - 170)),
        autoPanPaddingTopLeft: L.point(16, 120),
        autoPanPaddingBottomRight: L.point(16, 56),
        className: 'sig-consulta-punto',
      })
        .setLatLng(latlng)
        .setContent(buildConsultaPuntoPopup(coords, secciones))
        .openOn(map);
      const repaint = () => {
        if (ctrl.signal.aborted || !popup.isOpen()) return;
        popup.setContent(buildConsultaPuntoPopup(coords, secciones));
      };
      // Al cerrar el popup se cancelan las consultas que sigan en vuelo.
      popup.once('remove', () => ctrl.abort());
      for (const run of remotas) void run().then(repaint);
    };

    map.on('popupopen', onPopupOpen);
    map.on('click', onClick);
    return () => {
      controller?.abort();
      map.off('popupopen', onPopupOpen);
      map.off('click', onClick);
    };
  }, [mapRef, flagsRef, ndviModeRef, protectedRef, urbanLimitRef, comunasRef, catastroFruticolaRef, hexbinSamplesRef]);
}
