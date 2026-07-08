'use client';

import { useCallback, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { MapPoint } from '@/lib/types';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';
import {
  URBAN_LIMIT_ATTRIBUTION,
  URBAN_LIMIT_COLOR,
  URBAN_LIMIT_STYLE,
  type UrbanLimitProps,
} from '@/lib/urban-limit';
import { kmlPropText, type KmlFeatureProps, type KmlLayer } from '@/lib/kml';
import { cbrPinSvg } from '@/lib/cbr-points';

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
  kmlLayers = [],
}: {
  points: MapPoint[];
  showProtected?: boolean;
  showUrbanLimit?: boolean;
  kmlLayers?: KmlLayer[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const protectedRef = useRef<L.GeoJSON | null>(null);
  const urbanLimitRef = useRef<L.GeoJSON | null>(null);
  const kmlRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const seenKmlIds = useRef<Set<string>>(new Set());

  // Con varias capas asíncronas compartiendo el overlayPane (preferCanvas), el
  // orden de apilado debe re-imponerse tras cada mutación de capa, sin
  // importar cuál fetch resuelva último: áreas protegidas al fondo, límite
  // urbano encima, luego las capas KML del usuario, y los puntos CBR siempre
  // al frente (clicables).
  const reorderOverlays = useCallback(() => {
    protectedRef.current?.bringToBack();
    urbanLimitRef.current?.bringToFront();
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
      kmlById.clear();
      seenIds.clear();
    };
  }, []);

  // Rebuild the cluster layer whenever the filtered points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      showCoverageOnHover: false,
      // animate:false evita el requestAnimFrame de transición de clusters, cuyo
      // callback diferido corría tras el desmontaje (StrictMode) sobre un mapa
      // ya destruido → «Cannot read properties of null (getMinZoom)». Además es
      // más liviano con ~74k puntos.
      animate: false,
    });

    for (const p of points) {
      const marker = L.marker([p.lat, p.lng], { icon: cbrPinIcon });
      marker.bindPopup(buildPopup(p));
      group.addLayer(marker);
    }

    map.addLayer(group);
    clusterRef.current = group;
    reorderOverlays();

    // Cleanup: quita el grupo mientras el mapa sigue vivo y suelta la ref. Sin
    // esto, el doble montaje de StrictMode deja clusterRef apuntando a un grupo
    // cuyo mapa ya fue destruido, y el removeLayer del siguiente ciclo llama a
    // getMinZoom() sobre un _map null (los marcadores divIcon recalculan la
    // grilla de zoom al removerse, a diferencia de los circleMarker de canvas).
    return () => {
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

  return <div ref={containerRef} className="h-full w-full" />;
}
