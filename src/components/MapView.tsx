'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { MapPoint } from '@/lib/types';
import type { GeoJsonObject } from 'geojson';

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

const PROTECT_CLASS_LABEL: Record<string, string> = {
  '1': 'Reserva Estricta',
  '2': 'Parque Nacional',
  '3': 'Monumento Natural',
  '4': 'Área de Manejo de Hábitat',
};

export default function MapView({
  points,
  showEcological = false,
}: {
  points: MapPoint[];
  showEcological?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const ecologicalRef = useRef<L.GeoJSON | null>(null);

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

  // Ecological layer: SNASPE protected areas (OSM/CONAF via GeoJSON)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (ecologicalRef.current) {
      map.removeLayer(ecologicalRef.current);
      ecologicalRef.current = null;
    }

    if (!showEcological) return;

    fetch('/data/snaspe.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: GeoJsonObject) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style: {
            color: 'hsl(153 60% 35%)',
            fillColor: 'hsl(153 60% 50%)',
            fillOpacity: 0.18,
            weight: 1.5,
            opacity: 0.7,
          },
          onEachFeature(feature, featureLayer) {
            const p = feature.properties ?? {};
            const label = PROTECT_CLASS_LABEL[p.protect_class ?? ''] ?? 'Área Protegida';
            featureLayer.bindPopup(
              `<div style="font-size:0.8rem;line-height:1.5">` +
                `<div style="font-weight:600;font-size:0.9rem">${esc(p.name ?? 'Área Protegida')}</div>` +
                `<div style="opacity:.6;margin-bottom:.3rem">${label}</div>` +
                `<div style="font-size:0.7rem;opacity:.5">Fuente: OSM · © CONAF SNASPE</div>` +
                `</div>`,
            );
          },
        }).addTo(mapRef.current);
        ecologicalRef.current = layer;
      })
      .catch(() => {});

    return () => {
      if (ecologicalRef.current && mapRef.current) {
        mapRef.current.removeLayer(ecologicalRef.current);
        ecologicalRef.current = null;
      }
    };
  }, [showEcological]);

  return <div ref={containerRef} className="h-full w-full" />;
}
