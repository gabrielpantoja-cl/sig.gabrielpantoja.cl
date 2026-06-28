'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { MapPoint } from '@/lib/types';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';

/**
 * Imperative Leaflet map with marker clustering.
 *
 * Renders the geolocated dataset (up to ~74k points) as native CircleMarkers
 * grouped with leaflet.markercluster. Building it imperatively (not as thousands
 * of React nodes) keeps mount fast and mobile-safe. Loaded with `ssr: false`
 * from the page, so Leaflet only ever runs in the browser.
 */

const MAP_CENTER: [number, number] = [-39.6, -72.6]; // centro-sur de Chile

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
  if (p.superficie) rows.push(['Superficie', `${p.superficie.toLocaleString('es-CL')} m²`]);
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

export default function MapView({
  points,
  showProtected = false,
}: {
  points: MapPoint[];
  showProtected?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const protectedRef = useRef<L.GeoJSON | null>(null);

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
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
    };
  }, []);

  // Rebuild the cluster layer whenever the filtered points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }

    const group = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      showCoverageOnHover: false,
    });

    for (const p of points) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 5,
        color: 'hsl(153 28% 23%)',
        fillColor: 'hsl(153 28% 35%)',
        fillOpacity: 0.7,
        weight: 1,
      });
      marker.bindPopup(buildPopup(p));
      group.addLayer(marker);
    }

    map.addLayer(group);
    clusterRef.current = group;
  }, [points]);

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
        layer.bringToBack(); // keep CBR transaction markers clickable on top
        protectedRef.current = layer;
      })
      .catch(() => {});

    return () => {
      if (protectedRef.current && mapRef.current) {
        mapRef.current.removeLayer(protectedRef.current);
        protectedRef.current = null;
      }
    };
  }, [showProtected]);

  return <div ref={containerRef} className="h-full w-full" />;
}
