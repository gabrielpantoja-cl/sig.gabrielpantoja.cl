'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { GeocodeResult, MapPoint } from '@/lib/types';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';
import {
  URBAN_LIMIT_ATTRIBUTION,
  URBAN_LIMIT_COLOR,
  URBAN_LIMIT_STYLE,
  type UrbanLimitProps,
} from '@/lib/urban-limit';
import { kmlPropText, type KmlFeatureProps, type KmlLayer } from '@/lib/kml';
import {
  COMUNAS_ATTRIBUTION,
  COMUNAS_COLOR,
  COMUNAS_STYLE,
  comunaFillColor,
  type ComunaProps,
} from '@/lib/comunas';
import { cbrPinSvg } from '@/lib/cbr-points';
import {
  RED_VIAL_ATTRIBUTION,
  ROAD_CLASS_GROUPS,
  roadClassGroup,
  type RedVialProps,
} from '@/lib/red-vial';
import {
  SUELOS_ATTRIBUTION,
  SUELOS_EXPORT_LAYERS,
  SUELOS_EXPORT_URL,
  SUELOS_IDENTIFY_URL,
  SUELOS_MIN_ZOOM,
  SUELOS_OPACITY,
  suelosClassColor,
  TRANSPARENT_PIXEL,
} from '@/lib/suelos';

/**
 * Imperative Leaflet map with marker clustering.
 *
 * Renders the geolocated dataset (up to ~74k points) as native CircleMarkers
 * grouped with leaflet.markercluster. Building it imperatively (not as thousands
 * of React nodes) keeps mount fast and mobile-safe. Loaded with `ssr: false`
 * from the page, so Leaflet only ever runs in the browser.
 */

const MAP_CENTER: [number, number] = [-39.6, -72.6]; // centro-sur de Chile

// Un solo icono compartido por todos los puntos CBR: pin (gota) carmesí con
// halo blanco, de alto contraste con el mapa base. La punta (parte inferior)
// marca la coordenada, por eso iconAnchor apunta al [12, 32] del SVG 24×32.
const cbrPinIcon = L.divIcon({
  className: 'cbr-pin',
  html: cbrPinSvg(),
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -30],
});

const formatCLP = (value: number | null): string =>
  value == null
    ? 'Monto no informado'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(value);

const esc = (s: string | null): string =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Popup HTML for a single transaction. Leads with the predio/comuna and price,
 * then the CBR registry citation (Fojas N° / año), the conservador it belongs to
 * and the remaining public attributes (ROL, superficie, destino).
 */
function buildPopup(p: MapPoint): string {
  const cite = [
    p.fojas ? `Fojas ${esc(p.fojas)}` : null,
    p.numero != null ? `N° ${p.numero}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const inscripcion = cite ? `${cite} · ${p.anio}` : `Año ${p.anio}`;

  const rows: [string, string][] = [['Inscripción', inscripcion]];
  if (p.conservador) rows.push(['Conservador', `CBR ${esc(p.conservador)}`]);
  if (p.rol) rows.push(['ROL', esc(p.rol)]);
  if (p.superficie) rows.push(['Superficie de terreno', `${p.superficie.toLocaleString('es-CL')} m²`]);
  if (p.destino) rows.push(['Destino', esc(p.destino)]);

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="vertical-align:top">${v}</td>` +
        `</tr>`,
    )
    .join('');

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(p.predio || p.comuna)}</div>` +
    (p.predio
      ? `<div style="opacity:.6;margin-bottom:.35rem">${esc(p.comuna)}</div>`
      : `<div style="margin-bottom:.35rem"></div>`) +
    `<div style="font-weight:600;font-size:1rem;color:hsl(153 28% 30%);margin-bottom:.4rem">${formatCLP(p.monto)}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `</div>`
  );
}

const fmtHa = (ha: number | null): string =>
  ha == null ? '—' : `${ha.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ha`;

/**
 * Popup de un área protegida. Lidera con el nombre y la categoría legal
 * (coloreada según la designación), luego región y superficie, y enlaza a la
 * ficha oficial en SIMBIO cuando el dato la incluye.
 */
function buildProtectedPopup(props: ProtectedAreaProps): string {
  const cat = props.designacion_ap ?? 'Área protegida';
  const color = categoryColor(props.designacion_ap);
  const rows: [string, string][] = [];
  if (props.region) rows.push(['Región', esc(props.region)]);
  rows.push(['Superficie', fmtHa(props.ha)]);
  if (props.cod_rnap) rows.push(['Código RNAP', esc(props.cod_rnap)]);

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="vertical-align:top">${v}</td>` +
        `</tr>`,
    )
    .join('');

  const ficha = props.url_fuente
    ? `<a href="${esc(props.url_fuente)}" target="_blank" rel="noopener noreferrer" ` +
      `style="color:hsl(153 28% 30%);font-size:0.72rem;text-decoration:underline">Ver ficha oficial →</a>`
    : '';

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.nombre_ap || cat)}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${color}">${esc(cat)}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.45rem">${ficha}</div>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">© MMA · Registro Nacional de Áreas Protegidas · CC0</div>` +
    `</div>`
  );
}

/**
 * Popup de un límite urbano (PRC). Lidera con el nombre del instrumento y la
 * comuna, luego el tipo, el administrador y la publicación en el Diario
 * Oficial que le da vigencia normativa.
 */
function buildUrbanLimitPopup(props: UrbanLimitProps): string {
  // La fuente MINVU trae strings vacíos o con espacios en vez de null.
  const val = (s: string | null): string => (s ?? '').trim();
  const title = val(props.NOM) || [val(props.INSTRUM) || 'Límite urbano', val(props.COM)].filter(Boolean).join(' — ');

  const publicacion = [
    val(props.T_DO) ? esc(val(props.T_DO)) : null,
    val(props.N_DO) ? `N° ${esc(val(props.N_DO))}` : null,
    val(props.P_DO) ? esc(val(props.P_DO)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const rows: [string, string][] = [];
  if (val(props.COM)) rows.push(['Comuna', esc(val(props.COM))]);
  if (val(props.INSTRUM)) rows.push(['Instrumento', esc(val(props.INSTRUM))]);
  if (val(props.ADMIN)) rows.push(['Administrador', esc(val(props.ADMIN))]);
  if (publicacion) rows.push(['Publicación D.O.', publicacion]);

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="vertical-align:top">${v}</td>` +
        `</tr>`,
    )
    .join('');

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(title)}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${URBAN_LIMIT_COLOR}">Límite urbano</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${URBAN_LIMIT_ATTRIBUTION}</div>` +
    `</div>`
  );
}

/**
 * Popup de una comuna (DPA 2023). Lidera con el nombre de la comuna, luego la
 * jerarquía administrativa (provincia, región), el código único territorial
 * (CUT) y la superficie oficial, cerrando con la cita a SUBDERE/geoportal.cl.
 */
function buildComunaPopup(props: ComunaProps): string {
  const rows: [string, string][] = [];
  if (props.PROVINCIA) rows.push(['Provincia', esc(props.PROVINCIA)]);
  if (props.REGION) rows.push(['Región', esc(props.REGION)]);
  if (props.CUT_COM) rows.push(['Código CUT', esc(props.CUT_COM)]);
  if (props.SUPERFICIE != null)
    rows.push([
      'Superficie',
      `${Number(props.SUPERFICIE).toLocaleString('es-CL', { maximumFractionDigits: 1 })} km²`,
    ]);

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="vertical-align:top">${v}</td>` +
        `</tr>`,
    )
    .join('');

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.COMUNA || 'Comuna')}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${COMUNAS_COLOR}">Límite comunal · DPA 2023</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${COMUNAS_ATTRIBUTION} · límites referenciales</div>` +
    `</div>`
  );
}

/**
 * Popup de un tramo de la Red Caminera (Dirección de Vialidad, MOP). Lidera
 * con la toponimia oficial del camino y el ROL de Vialidad (la razón de ser de
 * la capa: el nombre oficial suele diferir del de Google/OSM), luego la
 * clasificación funcional, la carpeta y si está concesionado, cerrando con la
 * cita a la fuente.
 */
function buildRedVialPopup(props: RedVialProps): string {
  const group = ROAD_CLASS_GROUPS[roadClassGroup(props.CLASIFICACION)];

  const rows: [string, string][] = [];
  if (props.CLASIFICACION) rows.push(['Clasificación', esc(props.CLASIFICACION)]);
  if (props.CARPETA) rows.push(['Carpeta', esc(props.CARPETA)]);
  if (props.CONCESIONADO) rows.push(['Concesionado', esc(props.CONCESIONADO)]);

  const body = rows
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
        `<td style="vertical-align:top">${v}</td>` +
        `</tr>`,
    )
    .join('');

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.NOMBRE_CAMINO || 'Camino sin nombre informado')}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${group.color}">` +
    `${props.ROL ? `ROL ${esc(props.ROL)}` : 'Red Vial MOP'}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${RED_VIAL_ATTRIBUTION} · trazado referencial</div>` +
    `</div>`
  );
}

/**
 * Popup de un feature dentro de una capa KML del usuario. Muestra el nombre
 * del Placemark y su descripción como texto plano: cualquier HTML embebido en
 * el KML (habitual en exportes de Google Earth) se descarta antes de escapar,
 * para no inyectar markup ajeno en la página.
 */
function buildKmlPopup(props: KmlFeatureProps, layer: KmlLayer): string {
  const stripTags = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const name = kmlPropText(props.name).trim();
  const description = stripTags(kmlPropText(props.description));

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:180px;max-width:260px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(name || layer.name)}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${layer.color}">Capa KML · ${esc(layer.name)}</div>` +
    (description ? `<div style="opacity:.75">${esc(description)}</div>` : '') +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">Archivo local del usuario · no publicado</div>` +
    `</div>`
  );
}

export default function MapView({
  points,
  showProtected = false,
  showUrbanLimit = false,
  showComunas = false,
  showRedVial = false,
  showSuelos = false,
  kmlLayers = [],
  focus = null,
  onRenderProgress,
  onRenderComplete,
}: {
  points: MapPoint[];
  showProtected?: boolean;
  showUrbanLimit?: boolean;
  showComunas?: boolean;
  showRedVial?: boolean;
  showSuelos?: boolean;
  kmlLayers?: KmlLayer[];
  /** Resultado del geocoder: el mapa vuela ahí y deja un marcador pulsante. */
  focus?: GeocodeResult | null;
  /** Avance del render de marcadores (procesados, total) — alimenta el loader. */
  onRenderProgress?: (processed: number, total: number) => void;
  /** Los marcadores ya están pintados en pantalla — el loader puede cerrar. */
  onRenderComplete?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const protectedRef = useRef<L.GeoJSON | null>(null);
  const urbanLimitRef = useRef<L.GeoJSON | null>(null);
  const comunasRef = useRef<L.GeoJSON | null>(null);
  const redVialRef = useRef<L.GeoJSON | null>(null);
  const suelosRef = useRef<L.ImageOverlay | null>(null);
  const kmlRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const seenKmlIds = useRef<Set<string>>(new Set());

  // Callbacks de progreso en refs: el efecto del clúster no debe re-ejecutarse
  // (y reconstruir 85k marcadores) porque el padre re-creó una función.
  const onRenderProgressRef = useRef(onRenderProgress);
  const onRenderCompleteRef = useRef(onRenderComplete);
  useEffect(() => {
    onRenderProgressRef.current = onRenderProgress;
    onRenderCompleteRef.current = onRenderComplete;
  }, [onRenderProgress, onRenderComplete]);

  // Con varias capas asíncronas compartiendo el overlayPane (preferCanvas), el
  // orden de apilado debe re-imponerse tras cada mutación de capa, sin
  // importar cuál fetch resuelva último: áreas protegidas al fondo, límite
  // urbano encima, luego las capas KML del usuario, y los puntos CBR siempre
  // al frente (clicables).
  const reorderOverlays = useCallback(() => {
    // Comunas al fondo de todo (contexto), luego áreas protegidas.
    protectedRef.current?.bringToBack();
    comunasRef.current?.bringToBack();
    urbanLimitRef.current?.bringToFront();
    // Red caminera sobre los polígonos (líneas finas, deben quedar visibles).
    redVialRef.current?.bringToFront();
    for (const layer of kmlRef.current.values()) layer.bringToFront();
    clusterRef.current?.bringToFront();
  }, []);

  // Initialize the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: MAP_CENTER,
      zoom: 7,
      preferCanvas: true,
      scrollWheelZoom: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    mapRef.current = map;
    const kmlById = kmlRef.current;
    const seenIds = seenKmlIds.current;
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      protectedRef.current = null;
      urbanLimitRef.current = null;
      comunasRef.current = null;
      redVialRef.current = null;
      suelosRef.current = null;
      kmlById.clear();
      seenIds.clear();
    };
  }, []);

  // Rebuild the cluster layer whenever the filtered points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // markercluster no expone cómo cancelar el procesamiento por chunks de
    // addLayers (su setTimeout interno se re-agenda solo). Si el efecto se
    // limpia a mitad de carga (StrictMode, cambio de filtros), ese timer sigue
    // corriendo con this._map ya null y revienta en _addLayer (getMinZoom).
    // `cancelled` silencia el progreso y el no-op de _addLayer (en el cleanup)
    // vuelve inofensivas las iteraciones restantes.
    let cancelled = false;

    const group = L.markerClusterGroup({
      chunkedLoading: true,
      chunkInterval: 120,
      chunkDelay: 20,
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      // animate:false evita el requestAnimFrame de transición de clusters, cuyo
      // callback diferido corría tras el desmontaje (StrictMode) sobre un mapa
      // ya destruido → «Cannot read properties of null (getMinZoom)». Además es
      // más liviano con ~74k puntos.
      animate: false,
      chunkProgress(processed: number, total: number) {
        if (cancelled) return;
        onRenderProgressRef.current?.(processed, total);
        if (processed >= total) {
          // Doble rAF: garantiza que los clusters ya se pintaron en pantalla
          // antes de avisar (el loader cierra exactamente con el mapa listo).
          requestAnimationFrame(() =>
            requestAnimationFrame(() => onRenderCompleteRef.current?.()),
          );
        }
      },
    });

    const markers = points.map((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: cbrPinIcon });
      marker.bindPopup(buildPopup(p));
      return marker;
    });

    // El grupo debe estar en el mapa ANTES de addLayers: solo así markercluster
    // procesa por chunks (sin congelar el hilo principal ~3,5 s con 85k puntos)
    // y emite chunkProgress.
    map.addLayer(group);
    if (markers.length > 0) {
      group.addLayers(markers);
    } else {
      onRenderCompleteRef.current?.();
    }
    clusterRef.current = group;
    reorderOverlays();

    // Cleanup: quita el grupo mientras el mapa sigue vivo y suelta la ref. Sin
    // esto, el doble montaje de StrictMode deja clusterRef apuntando a un grupo
    // cuyo mapa ya fue destruido, y el removeLayer del siguiente ciclo llama a
    // getMinZoom() sobre un _map null (los marcadores divIcon recalculan la
    // grilla de zoom al removerse, a diferencia de los circleMarker de canvas).
    return () => {
      cancelled = true;
      // Neutraliza los chunks pendientes del grupo saliente: sin mapa,
      // _addLayer dereferencia this._map.getMinZoom() y lanza TypeError.
      (group as unknown as { _addLayer: () => void })._addLayer = () => {};
      if (clusterRef.current) {
        map.removeLayer(clusterRef.current);
        clusterRef.current = null;
      }
    };
  }, [points, reorderOverlays]);

  // Protected areas layer — official MMA / Registro Nacional de Áreas
  // Protegidas (RNAP), CC0. Styled per legal category, generated by
  // scripts/build-protected-areas.mjs.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (protectedRef.current) {
      map.removeLayer(protectedRef.current);
      protectedRef.current = null;
    }

    if (!showProtected) return;

    fetch('/data/areas-protegidas.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, ProtectedAreaProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style(feature?: Feature<Geometry, ProtectedAreaProps>) {
            const color = categoryColor(feature?.properties?.designacion_ap);
            return {
              color,
              fillColor: color,
              fillOpacity: 0.2,
              weight: 1.2,
              opacity: 0.85,
              smoothFactor: 0.5,
            };
          },
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildProtectedPopup(feature.properties), { maxWidth: 280 });
          },
        }).addTo(mapRef.current);
        protectedRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (protectedRef.current && mapRef.current) {
        mapRef.current.removeLayer(protectedRef.current);
        protectedRef.current = null;
      }
    };
  }, [showProtected, reorderOverlays]);

  // Límite urbano — polígonos de Planes Reguladores Comunales del MINVU,
  // generado por scripts/build-urban-limit.mjs. Un solo estilo (ámbar) para
  // distinguir suelo urbano normado del resto (rural).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (urbanLimitRef.current) {
      map.removeLayer(urbanLimitRef.current);
      urbanLimitRef.current = null;
    }

    if (!showUrbanLimit) return;

    fetch('/data/limite-urbano.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, UrbanLimitProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style: URBAN_LIMIT_STYLE,
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildUrbanLimitPopup(feature.properties), { maxWidth: 280 });
          },
        }).addTo(mapRef.current);
        urbanLimitRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (urbanLimitRef.current && mapRef.current) {
        mapRef.current.removeLayer(urbanLimitRef.current);
        urbanLimitRef.current = null;
      }
    };
  }, [showUrbanLimit, reorderOverlays]);

  // Límites comunales — División Político-Administrativa 2023 (SUBDERE,
  // geoportal.cl), generado por scripts/build-comunas.mjs. Capa de contexto:
  // línea discontinua gris pizarra al fondo del apilado, clicable para
  // consultar comuna/provincia/región/CUT.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (comunasRef.current) {
      map.removeLayer(comunasRef.current);
      comunasRef.current = null;
    }

    if (!showComunas) return;

    fetch('/data/limites-comunales.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, ComunaProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          // Relleno pastel translúcido distinto por comuna (mapa político),
          // manteniendo el borde pizarra discontinuo de límite administrativo.
          style(feature?: Feature<Geometry, ComunaProps>) {
            return {
              ...COMUNAS_STYLE,
              fillColor: comunaFillColor(feature?.properties?.CUT_COM),
            };
          },
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildComunaPopup(feature.properties), { maxWidth: 280 });
          },
        }).addTo(mapRef.current);
        comunasRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (comunasRef.current && mapRef.current) {
        mapRef.current.removeLayer(comunasRef.current);
        comunasRef.current = null;
      }
    };
  }, [showComunas, reorderOverlays]);

  // Red caminera — Red Vial Nacional de la Dirección de Vialidad (MOP,
  // mapas.mop.cl), generado por scripts/build-red-vial.mjs. Líneas violeta con
  // jerarquía por clasificación funcional; tooltip al pasar el mouse con la
  // toponimia oficial y el ROL (que suelen diferir de Google/OSM), popup con
  // el detalle completo del tramo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (redVialRef.current) {
      map.removeLayer(redVialRef.current);
      redVialRef.current = null;
    }

    if (!showRedVial) return;

    fetch('/data/red-vial.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, RedVialProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style(feature?: Feature<Geometry, RedVialProps>) {
            const group = ROAD_CLASS_GROUPS[roadClassGroup(feature?.properties?.CLASIFICACION)];
            return {
              color: group.color,
              weight: group.weight,
              opacity: 0.85,
              smoothFactor: 1,
            };
          },
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildRedVialPopup(feature.properties), { maxWidth: 300 });
            const name = feature.properties.NOMBRE_CAMINO;
            const rol = feature.properties.ROL;
            if (name || rol) {
              featureLayer.bindTooltip(
                `${esc(name ?? '')}${name && rol ? ' · ' : ''}${rol ? `ROL ${esc(rol)}` : ''}`,
                { sticky: true, direction: 'top', opacity: 0.92 },
              );
            }
          },
        }).addTo(mapRef.current);
        redVialRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (redVialRef.current && mapRef.current) {
        mapRef.current.removeLayer(redVialRef.current);
        redVialRef.current = null;
      }
    };
  }, [showRedVial, reorderOverlays]);

  // Suelos agrológicos (CIREN) — capa dinámica remota: el dataset completo
  // supera los 500 MB, así que el servidor de CIREN renderiza la imagen con
  // su simbología oficial y aquí solo se descarga UN PNG por viewport
  // (export del MapServer sobre un L.ImageOverlay refrescado en moveend; el
  // WMS teselado tumbaba el servidor con ~40 GetMap simultáneos). La imagen
  // se pre-carga y recién entonces reemplaza a la anterior (sin parpadeo), y
  // un contador de secuencia descarta respuestas fuera de orden. Al hacer
  // clic se consulta la clase vía identify; si el clic abrió el popup de otra
  // capa (comuna, camino, pin), se aborta para no pisarlo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (suelosRef.current) {
      map.removeLayer(suelosRef.current);
      suelosRef.current = null;
    }

    if (!showSuelos) return;

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: SUELOS_OPACITY,
      attribution: 'CIREN · Estudios Agrológicos',
      interactive: false,
    }).addTo(map);
    suelosRef.current = overlay;

    let seq = 0;
    const refresh = () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++seq;
      // A escala nacional el export obliga al servidor a rasterizar las 12
      // regiones completas: tarda minutos y degrada el servicio para todas
      // las consultas siguientes. Bajo el zoom mínimo no se pide nada.
      if (map.getZoom() < SUELOS_MIN_ZOOM) {
        overlay.setUrl(TRANSPARENT_PIXEL);
        overlay.setBounds(bounds);
        return;
      }
      const params = new URLSearchParams({
        bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        bboxSR: '4326',
        imageSR: '3857', // misma proyección que el mapa: el PNG calza sin deformarse
        size: `${size.x},${size.y}`,
        layers: SUELOS_EXPORT_LAYERS,
        format: 'png32',
        transparent: 'true',
        f: 'image',
      });
      const url = `${SUELOS_EXPORT_URL}?${params}`;
      const img = new Image();
      img.onload = () => {
        if (id !== seq || !suelosRef.current) return;
        suelosRef.current.setUrl(url);
        suelosRef.current.setBounds(bounds);
      };
      img.src = url;
    };

    map.on('moveend', refresh);
    refresh();

    let otherPopupOpened = false;
    const onPopupOpen = () => {
      otherPopupOpened = true;
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      otherPopupOpened = false;
      // Bajo el zoom mínimo la capa no está visible: no consultar identify.
      if (map.getZoom() < SUELOS_MIN_ZOOM) return;
      const { lat, lng } = e.latlng;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        geometryType: 'esriGeometryPoint',
        sr: '4326',
        layers: 'all',
        tolerance: '2',
        mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        imageDisplay: `${size.x},${size.y},96`,
        returnGeometry: 'false',
        f: 'json',
      });

      fetch(`${SUELOS_IDENTIFY_URL}?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((data: { results?: { layerName?: string; attributes?: Record<string, string> }[] }) => {
          // El popup de un vector (comuna, camino, pin) llega primero: no pisarlo.
          if (otherPopupOpened || !mapRef.current || !suelosRef.current) return;
          const result = data.results?.[0];
          // El identify devuelve los atributos bajo el ALIAS del campo (texto
          // largo, con encoding inestable), no bajo su nombre (`textcaus`):
          // se busca entre los valores el que sea una clase válida.
          const clase = Object.values(result?.attributes ?? {})
            .map((v) => String(v).trim())
            .find((v) => /^(I|II|III|IV|V|VI|VII|VIII|N\.C\.)$/.test(v));
          const region = result?.layerName ?? '';
          const body = clase
            ? `<div style="font-weight:600;font-size:0.92rem">Capacidad de uso: Clase ${esc(clase)}</div>` +
              `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
              `font-size:0.68rem;font-weight:600;color:#1e293b;background:${suelosClassColor(clase)};` +
              `border:1px solid rgba(0,0,0,.15)">Suelos agrológicos CIREN</div>` +
              (region ? `<div style="opacity:.7">${esc(region)}</div>` : '')
            : `<div style="font-weight:600;font-size:0.92rem">Sin clase de suelo en este punto</div>` +
              `<div style="opacity:.7;margin-top:.2rem">Fuera del área estudiada por CIREN (12 regiones, Atacama a Aysén)</div>`;
          L.popup({ maxWidth: 280 })
            .setLatLng(e.latlng)
            .setContent(
              `<div style="font-size:0.8rem;line-height:1.45;min-width:200px">${body}` +
                `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${SUELOS_ATTRIBUTION}</div></div>`,
            )
            .openOn(mapRef.current);
        })
        .catch(() => {});
    };

    map.on('popupopen', onPopupOpen);
    map.on('click', onClick);

    return () => {
      seq++; // invalida cualquier export en vuelo
      map.off('moveend', refresh);
      map.off('popupopen', onPopupOpen);
      map.off('click', onClick);
      if (suelosRef.current && mapRef.current) {
        mapRef.current.removeLayer(suelosRef.current);
        suelosRef.current = null;
      }
    };
  }, [showSuelos]);

  // Capas KML del usuario — ya parseadas a GeoJSON en el navegador (lib/kml).
  // Se sincronizan por id: se quitan las eliminadas u ocultas, se agregan las
  // visibles que falten, y al aparecer una capa nueva el mapa vuela a su
  // extensión para confirmar visualmente la carga.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wanted = new Map(kmlLayers.filter((k) => k.visible).map((k) => [k.id, k]));

    for (const [id, layer] of kmlRef.current) {
      if (!wanted.has(id)) {
        map.removeLayer(layer);
        kmlRef.current.delete(id);
      }
    }

    let added: L.GeoJSON | null = null;
    for (const [id, kml] of wanted) {
      if (kmlRef.current.has(id)) continue;
      const layer = L.geoJSON(kml.geojson, {
        style: {
          color: kml.color,
          fillColor: kml.color,
          fillOpacity: 0.15,
          weight: 2,
          opacity: 0.9,
        },
        pointToLayer(_feature, latlng) {
          return L.circleMarker(latlng, {
            radius: 6,
            color: kml.color,
            fillColor: kml.color,
            fillOpacity: 0.75,
            weight: 1.5,
          });
        },
        onEachFeature(feature, featureLayer) {
          featureLayer.bindPopup(buildKmlPopup(feature.properties, kml), { maxWidth: 280 });
        },
      }).addTo(map);
      kmlRef.current.set(id, layer);
      if (!seenKmlIds.current.has(id)) {
        seenKmlIds.current.add(id);
        added = layer;
      }
    }

    if (added) {
      const bounds = added.getBounds();
      if (bounds.isValid()) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    reorderOverlays();
  }, [kmlLayers, reorderOverlays]);

  // Resultado del geocoder: vuela a la zona (bbox si existe, si no zoom 15) y
  // deja un marcador pulsante con el nombre del lugar. El marcador anterior se
  // quita al elegir otro resultado (cleanup del efecto).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;

    const icon = L.divIcon({
      className: 'geo-focus',
      html: '<span class="geo-focus-ring"></span><span class="geo-focus-dot"></span>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    const marker = L.marker([focus.lat, focus.lng], { icon, zIndexOffset: 1000 });
    marker.bindPopup(
      `<div style="font-size:0.8rem;line-height:1.4;max-width:240px">${esc(focus.label)}</div>`,
    );
    marker.addTo(map);

    if (focus.bbox) {
      const [south, north, west, east] = focus.bbox;
      map.flyToBounds(L.latLngBounds([south, west], [north, east]), {
        maxZoom: 16,
        padding: [40, 40],
        duration: 1.4,
      });
    } else {
      map.flyTo([focus.lat, focus.lng], 15, { duration: 1.4 });
    }

    return () => {
      map.removeLayer(marker);
    };
  }, [focus]);

  return <div ref={containerRef} className="h-full w-full" />;
}
