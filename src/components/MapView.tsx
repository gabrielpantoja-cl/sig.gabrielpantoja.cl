'use client';

import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { GeocodeResult, MapPoint } from '@/lib/types';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { downloadCanvas, exportFilename, exportMapToPng, type LayerMetadataEntry } from '@/lib/map-export';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';
import {
  URBAN_LIMIT_ATTRIBUTION,
  URBAN_LIMIT_COLOR,
  URBAN_LIMIT_STYLE,
  type UrbanLimitProps,
} from '@/lib/urban-limit';
import { kmlDisplayName, kmlPropText, type KmlFeatureProps, type KmlLayer } from '@/lib/kml';
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
  DRENAJE_TYPE_GROUPS,
  RED_DRENAJE_ATTRIBUTION,
  drenajeType,
  type RedDrenajeProps,
} from '@/lib/red-drenaje';
import {
  CATASTRO_FRUTICOLA_ATTRIBUTION,
  VINTAGE_HINT,
  VINTAGE_LABEL,
  especieColor,
  regionLabel,
  speciesList,
  type CatastroFruticolaProps,
} from '@/lib/catastro-fruticola';
import {
  SUELOS_ATTRIBUTION,
  SUELOS_EXPORT_URL,
  SUELOS_IDENTIFY_URL,
  SUELOS_MIN_ZOOM,
  SUELOS_OPACITY,
  SUELOS_SERVICE_NAME,
  suelosClassColor,
  TRANSPARENT_PIXEL,
  type SuelosOperation,
  type SuelosProxyErrorBody,
  type SuelosStatus,
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

/**
 * Fecha de la escritura en formato chileno DD/MM/YYYY. Acepta el ISO 8601
 * (YYYY-MM-DD) que entrega el API o un `Date` ya parseado. Devuelve string
 * vacío si el dato es null/undefined (el popup ya omite la fila en ese caso).
 */
const formatDateCL = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
};

const esc = (s: string | null): string =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

async function suelosFailureDetails(
  response: Response,
  fallbackOperation: SuelosOperation,
): Promise<{ service: string; operation: SuelosOperation }> {
  try {
    const body = (await response.json()) as SuelosProxyErrorBody;
    const operation = body.error?.operation === 'identify' || body.error?.operation === 'export'
      ? body.error.operation
      : fallbackOperation;
    return {
      service: body.error?.service === SUELOS_SERVICE_NAME
        ? body.error.service
        : SUELOS_SERVICE_NAME,
      operation,
    };
  } catch {
    return { service: SUELOS_SERVICE_NAME, operation: fallbackOperation };
  }
}

function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Invalid soils image'));
    image.src = url;
  });
}

/**
 * Popup HTML for a single transaction. Leads with the predio/comuna and price,
 * then the CBR registry citation (Fojas N° / año), the conservador it belongs to
 * and the remaining public attributes (ROL, superficie, fecha de escritura).
 * El código de destino SII se omite a propósito: aporta poco al perito fuera
 * del informe catastral y compite con la fecha de la escritura, que es la
 * pieza temporal clave para el cruce de inscripciones.
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
  const fechaEsc = formatDateCL(p.fechaEscritura);
  if (fechaEsc) rows.push(['Fecha de escritura', fechaEsc]);

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
 * Popup de un cauce de la Red de Drenaje (DGA, MOP). Lidera con el nombre
 * oficial del cauce (la razón de ser de la capa: los topónimos hidrográficos
 * suelen diferir entre SIGs), luego el tipo (Río/Estero) coloreado y la
 * jerarquía BNA (cuenca → subcuenca → subsubcuenca) que permite encadenar
 * con las capas de cuencas cuando se integren, cerrando con la cita a la DGA.
 */
function buildRedDrenajePopup(props: RedDrenajeProps): string {
  const group = DRENAJE_TYPE_GROUPS[drenajeType(props)];

  const rows: [string, string][] = [];
  if (props.COD_CUEN) rows.push(['Cuenca BNA', esc(props.COD_CUEN)]);
  if (props.COD_SUBC) rows.push(['Subcuenca', esc(props.COD_SUBC)]);
  if (props.COD_SSUBC) rows.push(['Subsubcuenca', esc(props.COD_SSUBC)]);
  if (props.NOM_REG) rows.push(['Región', esc(props.NOM_REG)]);

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
    `<div style="font-size:0.8rem;line-height:1.45;min-width:200px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.NOMBRE || 'Cauce sin nombre informado')}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${group.color}">` +
    `${group.label}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${RED_DRENAJE_ATTRIBUTION} · trazado referencial</div>` +
    `</div>`
  );
}

/**
 * Popup de un productor frutícola (CIREN-ODEPA, IDE Minagri). Lidera con el
 * ROL del predio (el mismo campo con el que el perito busca una transacción
 * CBR: el pivote más útil de la capa), luego las especies declaradas, la
 * comuna y el año del catastro regional que levantó el dato. Sin PII: el
 * nombre del productor que CIREN vende como atributo en el producto
 * empaquetado NO está en esta capa.
 *
 * El año se rotula "Levantamiento CIREN <año> · Región de X" con una nota al
 * pie de la fila, porque el rótulo anterior ("Catastro CIREN: Año 2024") se
 * leía como año de plantación del huerto. No lo es: CIREN no publica ningún
 * atributo temporal por predio — el año sale del nombre del sublayer regional
 * y es idéntico para toda la región (ver src/lib/catastro-fruticola.ts).
 */
function buildCatastroFruticolaPopup(props: CatastroFruticolaProps): string {
  const especies = speciesList(props);
  const principal = (props.especie_01 ?? '').trim() || 'Productor frutícola';
  const color = especieColor(props.especie_01);

  const region = regionLabel(props.regidere);

  const rows: [string, string][] = [];
  if (props.desccomu) rows.push(['Comuna', esc(props.desccomu)]);
  if (especies) rows.push(['Especies declaradas', esc(especies)]);
  if (props.vintage != null) {
    rows.push([
      VINTAGE_LABEL,
      `<span style="font-weight:600">${props.vintage}</span>` +
        (region ? ` · ${esc(region)}` : ''),
    ]);
  }

  // La nota del año va en una fila propia a ancho completo (colspan): dentro de
  // la columna de valores quedaría en una tira de ~90 px y se leería peor que
  // la ambigüedad que viene a resolver.
  const vintageNote =
    props.vintage != null
      ? `<tr><td colspan="2" style="padding-top:.3rem;font-size:0.66rem;line-height:1.35;opacity:.6">` +
        `${esc(VINTAGE_HINT)}</td></tr>`
      : '';

  const body =
    rows
      .map(
        ([k, v]) =>
          `<tr>` +
          `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${k}</td>` +
          `<td style="vertical-align:top">${v}</td>` +
          `</tr>`,
      )
      .join('') + vintageNote;

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:210px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.rolpredi || principal)}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${color}">` +
    `${esc(principal)}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${CATASTRO_FRUTICOLA_ATTRIBUTION}</div>` +
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

  // Usamos el alias editable del perito en el badge de la capa para
  // que el reconocimento visual del feature sea consistente con el panel
  // lateral y con el cajetín del export PNG.
  const layerLabel = kmlDisplayName(layer);
  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:180px;max-width:260px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(name || layerLabel)}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${layer.color}">Capa KML · ${esc(layerLabel)}</div>` +
    (description ? `<div style="opacity:.75">${esc(description)}</div>` : '') +
    `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">Archivo local del usuario · no publicado</div>` +
    `</div>`
  );
}

export default function MapView({
  points,
  showPoints = true,
  showProtected = false,
  showUrbanLimit = false,
  showComunas = false,
  showRedVial = false,
  showRedDrenaje = false,
  showSuelos = false,
  showCatastroFruticola = false,
  kmlLayers = [],
  focus = null,
  onRenderProgress,
  onRenderComplete,
  onSuelosStatus,
  mapExportRef,
}: {
  points: MapPoint[];
  /** Capa principal (~74k transacciones CBR). Apagarla deja el mapa limpio para
   * componer una vista sin transacciones (p.ej. antes de exportar a PNG). */
  showPoints?: boolean;
  showProtected?: boolean;
  showUrbanLimit?: boolean;
  showComunas?: boolean;
  showRedVial?: boolean;
  showRedDrenaje?: boolean;
  showSuelos?: boolean;
  showCatastroFruticola?: boolean;
  kmlLayers?: KmlLayer[];
  /** Resultado del geocoder: el mapa vuela ahí y deja un marcador pulsante. */
  focus?: GeocodeResult | null;
  /** Avance del render de marcadores (procesados, total) — alimenta el loader. */
  onRenderProgress?: (processed: number, total: number) => void;
  /** Los marcadores ya están pintados en pantalla — el loader puede cerrar. */
  onRenderComplete?: () => void;
  /** Disponibilidad operacional de la capa remota de suelos para el panel UI. */
  onSuelosStatus?: (status: SuelosStatus) => void;
  /** Handle al que MapView publica el método imperativo de export. La página
   *  padre (page.tsx) lo conecta al botón "Exportar PNG" de LayersControl:
   *  cuando el usuario lo pulsa, `mapExportRef.current()` rasteriza y descarga
   *  la vista actual. Se re-bindea en cada cambio de flags para que la closure
   *  capture los toggles vigentes al momento del click. */
  mapExportRef?: MutableRefObject<
    ((args?: { metadata?: LayerMetadataEntry[] }) => Promise<void>) | null
  >;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const protectedRef = useRef<L.GeoJSON | null>(null);
  const urbanLimitRef = useRef<L.GeoJSON | null>(null);
  const comunasRef = useRef<L.GeoJSON | null>(null);
  const redVialRef = useRef<L.GeoJSON | null>(null);
  const redDrenajeRef = useRef<L.GeoJSON | null>(null);
  const suelosRef = useRef<L.ImageOverlay | null>(null);
  const catastroFruticolaRef = useRef<L.GeoJSON | null>(null);
  const kmlRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const seenKmlIds = useRef<Set<string>>(new Set());

  // Callbacks de progreso en refs: el efecto del clúster no debe re-ejecutarse
  // (y reconstruir 85k marcadores) porque el padre re-creó una función.
  const onRenderProgressRef = useRef(onRenderProgress);
  const onRenderCompleteRef = useRef(onRenderComplete);
  const onSuelosStatusRef = useRef(onSuelosStatus);
  useEffect(() => {
    onRenderProgressRef.current = onRenderProgress;
    onRenderCompleteRef.current = onRenderComplete;
    onSuelosStatusRef.current = onSuelosStatus;
  }, [onRenderProgress, onRenderComplete, onSuelosStatus]);

  // Publica el método de export en el ref entregado por la página. La closure
  // se re-bindea en cada cambio de flags para que la captura refleje siempre
  // el estado vigente de las capas (incluyendo el toggle recién hecho de CBR
  // para componer una vista limpia). El guard `if (exporting)` en page.tsx
  // evita re-entradas mientras una descarga está en curso.
  //
  // El caller puede pasar `{ metadata: LayerMetadataEntry[] }` para inyectar
  // un cajetín de trazabilidad legal en el PNG (filtros aplicados, fuentes de
  // las capas activas). Lo construye page.tsx al momento del click (con los
  // filtros vigentes) y lo entrega por args — esto evita reconstruir el useEffect
  // con cada keystroke en los campos de filtro.
  useEffect(() => {
    if (!mapExportRef) return;
    mapExportRef.current = async (args) => {
      const map = mapRef.current;
      if (!map) return;
      const canvas = await exportMapToPng(map, {
        showPoints,
        showProtected,
        showUrbanLimit,
        showComunas,
        showRedVial,
        showRedDrenaje,
        showSuelos,
        showCatastroFruticola,
        cluster: clusterRef.current,
        metadata: args?.metadata,
      });
      downloadCanvas(canvas, exportFilename());
    };
    return () => {
      mapExportRef.current = null;
    };
  }, [
    mapExportRef,
    showPoints,
    showProtected,
    showUrbanLimit,
    showComunas,
    showRedVial,
    showRedDrenaje,
    showSuelos,
    showCatastroFruticola,
  ]);

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
    // Catastro frutícola sobre los polígonos administrativos (los huertos
    // son el dato sustantivo de la capa: deben quedar visibles).
    catastroFruticolaRef.current?.bringToFront();
    // Red caminera sobre los polígonos (líneas finas, deben quedar visibles).
    redVialRef.current?.bringToFront();
    // Red de drenaje (ríos + esteros) sobre los polígonos; debajo de la red
    // caminera porque la vial suele tener jerarquía de trazo más visible.
    redDrenajeRef.current?.bringToFront();
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
      redDrenajeRef.current = null;
      suelosRef.current = null;
      catastroFruticolaRef.current = null;
      kmlById.clear();
      seenIds.clear();
    };
  }, []);

  // Mount/unmount the already-built cluster layer based on visibility. El efecto
  // de build de abajo siempre construye y puebla el cluster (para que el
  // pipeline de progreso del render siga alimentando al RetroLoader aunque la
  // capa esté oculta al boot), y asigna clusterRef; éste sólo añade o quita el
  // cluster del mapa cuando showPoints cambia. Los ~74k marcadores se conservan
  // entre toggles: nada se reconstruye.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;
    if (showPoints && !map.hasLayer(cluster)) {
      map.addLayer(cluster);
      reorderOverlays();
    } else if (!showPoints && map.hasLayer(cluster)) {
      map.removeLayer(cluster);
    }
  }, [showPoints, reorderOverlays]);

  // Rebuild the cluster layer whenever the filtered points change. La visibilidad
  // (showPoints) la maneja el efecto de arriba — éste sólo reconstruye los
  // marcadores y decide si el grupo recién construido se adjunta al mapa según
  // el valor de showPoints vigente al momento del build.
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
        // markercluster llama a chunkProgress(0, 0, …) cuando addLayers[]
        // recibe un array vacío (p.ej. el primer mount de StrictMode mientras
        // /api/points aún no resolvió). `processed >= total` se cumple para
        // (0, 0) y disparaba el cierre del loader sin markers en pantalla.
        // Gateamos con total > 0 (equivalente a processed > 0) para exigir
        // que realmente hubo algo que procesar.
        if (processed >= total && total > 0) {
          // markercluster ejecuta el callback de chunkProgress *antes* de las
          // llamadas síncronas que anexan los clusters al map pane
          // (_refreshClustersIcons + _recursivelyAddChildrenToMap). Un doble
          // rAF aquí (~32 ms) compensa en CPUs rápidas pero puede quedarse
          // corto cuando el hilo principal está recién saliendo del decode
          // JSON y todavía hay layout pendiente para ~65+ íconos recién
          // creados: el loader cierra y el mapa sigue en blanco.
          //
          // Diferimos a una microtask (corre al final del tick actual, justo
          // después del sync DOM work que el markercluster aún tiene por
          // hacer) y luego encadenamos dos rAFs para garantizar paint. Si la
          // cleanup del efecto marcó `cancelled`, los callbacks descartan.
          queueMicrotask(() => {
            if (cancelled) return;
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (cancelled) return;
                onRenderCompleteRef.current?.();
              }),
            );
          });
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
    // y emite chunkProgress. Si la capa está oculta al construir, igual
    // construimos el grupo y dejamos clusterRef apuntando a él — el efecto de
    // visibilidad arriba lo añadirá al mapa en el primer toggle a true.
    if (showPoints) map.addLayer(group);
    if (markers.length > 0) {
      group.addLayers(markers);
    }
    // Importante: cuando `points` aún es [] (primer mount antes de que el
    // fetch de /api/points resuelva, o el doble mount de StrictMode) NO
    // disparamos onRenderComplete: el loader debe esperar a los markers
    // reales. El catch del fetch en page.tsx cierra el loader si la red
    // falla; si los datos son legítimamente vacíos, el boot ya terminó y
    // handleRenderComplete es un no-op por booting.current=false.
    clusterRef.current = group;
    reorderOverlays();

    // Cleanup: si esta corrida todavía es la "viva" y el grupo está en el mapa
    // (visible), lo quitamos. La ref se libera para que el próximo ciclo
    // (filtros nuevos o toggle) asigne una nueva. Sin esto, el doble montaje
    // de StrictMode deja clusterRef apuntando a un grupo cuyo mapa ya fue
    // destruido, y el removeLayer del siguiente ciclo llama a getMinZoom()
    // sobre un _map null (los marcadores divIcon recalculan la grilla de zoom
    // al removerse, a diferencia de los circleMarker de canvas).
    return () => {
      cancelled = true;
      // Neutraliza los chunks pendientes del grupo saliente: sin mapa,
      // _addLayer dereferencia this._map.getMinZoom() y lanza TypeError.
      (group as unknown as { _addLayer: () => void })._addLayer = () => {};
      if (clusterRef.current === group) {
        if (mapRef.current?.hasLayer(group)) {
          mapRef.current.removeLayer(group);
        }
        clusterRef.current = null;
      }
    };
    // showPoints se lee solo para decidir si se añade el grupo al mapa;
    // la visibilidad la gobierna el efecto de toggle de arriba, y NO queremos
    // reconstruir 74k markers cada vez que se apaga la capa para componer una
    // vista limpia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Red de drenaje — ríos y esteros de la DGA (Banco Nacional de Aguas, MOP),
  // generado por scripts/build-red-drenaje.mjs. ~35k polylines nacionales con
  // el nombre oficial DGA (suele diferir del de Google/OSM), código de cuenca
  // BNA y jerarquía visual por tipo (ríos = línea más oscura y gruesa;
  // esteros = línea más clara y fina). El campo `tipo` del GeoJSON fue
  // inyectado por el ETL para distinguir origen sin parsear el TIPO textual.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (redDrenajeRef.current) {
      map.removeLayer(redDrenajeRef.current);
      redDrenajeRef.current = null;
    }

    if (!showRedDrenaje) return;

    fetch('/data/red-drenaje.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, RedDrenajeProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style(feature?: Feature<Geometry, RedDrenajeProps>) {
            const group = DRENAJE_TYPE_GROUPS[drenajeType(feature?.properties)];
            return {
              color: group.color,
              weight: group.weight,
              opacity: 0.85,
              smoothFactor: 1,
            };
          },
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildRedDrenajePopup(feature.properties), { maxWidth: 280 });
            const name = feature.properties.NOMBRE;
            if (name) {
              featureLayer.bindTooltip(esc(name), {
                sticky: true,
                direction: 'top',
                opacity: 0.92,
              });
            }
          },
        }).addTo(mapRef.current);
        redDrenajeRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (redDrenajeRef.current && mapRef.current) {
        mapRef.current.removeLayer(redDrenajeRef.current);
        redDrenajeRef.current = null;
      }
    };
  }, [showRedDrenaje, reorderOverlays]);

  // Catastro Frutícola (CIREN-ODEPA, IDE Minagri) — polígonos de productores
  // frutícolas por región. ETL estático (scripts/build-catastro-fruticola.mjs):
  // los 14 sublayers del grupo PRODUCTORES FRUTÍCOLAS se concatenan y
  // simplifican en una sola pasada de mapshaper. Color por especie
  // predominante (especie_01), con relleno translúcido y borde del mismo
  // tono. Es la única capa que puede tener >100k features: igual que las
  // áreas protegidas, se monta sobre L.geoJSON (canvas renderer del mapa) y
  // se estiliza por feature — la simplificación al 1,5 % ya rebajó la
  // geometría al nivel manejable del navegador.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (catastroFruticolaRef.current) {
      map.removeLayer(catastroFruticolaRef.current);
      catastroFruticolaRef.current = null;
    }

    if (!showCatastroFruticola) return;

    fetch('/data/catastro-fruticola.geojson')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((geojson: FeatureCollection<Geometry, CatastroFruticolaProps>) => {
        if (!mapRef.current) return;
        const layer = L.geoJSON(geojson, {
          style(feature?: Feature<Geometry, CatastroFruticolaProps>) {
            const color = especieColor(feature?.properties?.especie_01);
            return {
              color,
              fillColor: color,
              fillOpacity: 0.32,
              weight: 0.8,
              opacity: 0.85,
              smoothFactor: 0.6,
            };
          },
          onEachFeature(feature, featureLayer) {
            featureLayer.bindPopup(buildCatastroFruticolaPopup(feature.properties), { maxWidth: 280 });
          },
        }).addTo(mapRef.current);
        catastroFruticolaRef.current = layer;
        reorderOverlays();
      })
      .catch(() => {});

    return () => {
      if (catastroFruticolaRef.current && mapRef.current) {
        mapRef.current.removeLayer(catastroFruticolaRef.current);
        catastroFruticolaRef.current = null;
      }
    };
  }, [showCatastroFruticola, reorderOverlays]);

  // Suelos agrológicos (CIREN) — capa dinámica remota: el dataset completo
  // supera los 500 MB, así que el servidor de CIREN renderiza la imagen con
  // su simbología oficial y aquí solo se descarga UN PNG por viewport
  // (export del MapServer sobre un L.ImageOverlay refrescado en moveend; el
  // WMS teselado tumbaba el servidor con ~40 GetMap simultáneos). La imagen
  // se pre-carga y recién entonces reemplaza a la anterior (sin parpadeo), y
  // un contador de secuencia descarta respuestas fuera de orden. Al hacer
  // clic se consulta la clase vía identify; ambas operaciones pasan por el
  // proxy same-origin del SIG, que valida CIREN y devuelve errores seguros con
  // el identificador exacto del servicio. Si el clic abrió el popup de otra
  // capa (comuna, camino, pin), se aborta para no pisarlo.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (suelosRef.current) {
      map.removeLayer(suelosRef.current);
      suelosRef.current = null;
    }

    if (!showSuelos) {
      onSuelosStatusRef.current?.({ kind: 'idle' });
      return;
    }

    const overlay = L.imageOverlay(TRANSPARENT_PIXEL, map.getBounds(), {
      opacity: SUELOS_OPACITY,
      attribution: 'CIREN · Estudios Agrológicos',
      interactive: false,
    }).addTo(map);
    suelosRef.current = overlay;

    let exportSequence = 0;
    let exportController: AbortController | null = null;
    let identifySequence = 0;
    let identifyController: AbortController | null = null;
    let activeBlobUrl: string | null = null;

    const clearRaster = (bounds: L.LatLngBounds) => {
      overlay.setUrl(TRANSPARENT_PIXEL);
      overlay.setBounds(bounds);
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
    };

    const refresh = async () => {
      const bounds = map.getBounds();
      const size = map.getSize();
      const id = ++exportSequence;
      exportController?.abort();
      exportController = null;
      // A escala nacional el export obliga al servidor a rasterizar las 12
      // regiones completas: tarda minutos y degrada el servicio para todas
      // las consultas siguientes. Bajo el zoom mínimo no se pide nada.
      if (map.getZoom() < SUELOS_MIN_ZOOM) {
        clearRaster(bounds);
        onSuelosStatusRef.current?.({ kind: 'zoom-required', minZoom: SUELOS_MIN_ZOOM });
        return;
      }
      clearRaster(bounds);
      onSuelosStatusRef.current?.({ kind: 'loading' });
      const controller = new AbortController();
      exportController = controller;
      const params = new URLSearchParams({
        bbox: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        size: `${size.x},${size.y}`,
      });
      const url = `${SUELOS_EXPORT_URL}?${params}`;
      let candidateBlobUrl: string | null = null;
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'export');
          if (id === exportSequence && !controller.signal.aborted) {
            onSuelosStatusRef.current?.({ kind: 'error', ...failure });
          }
          return;
        }
        const blob = await response.blob();
        if (blob.type !== 'image/png') throw new Error('Invalid soils response');
        candidateBlobUrl = URL.createObjectURL(blob);
        await waitForImage(candidateBlobUrl);
        if (id !== exportSequence || controller.signal.aborted || !suelosRef.current) {
          URL.revokeObjectURL(candidateBlobUrl);
          return;
        }
        suelosRef.current.setUrl(candidateBlobUrl);
        suelosRef.current.setBounds(bounds);
        activeBlobUrl = candidateBlobUrl;
        candidateBlobUrl = null;
        onSuelosStatusRef.current?.({ kind: 'ready' });
      } catch (error) {
        if (candidateBlobUrl) URL.revokeObjectURL(candidateBlobUrl);
        if (controller.signal.aborted || id !== exportSequence) return;
        console.error('No se pudo cargar la cobertura de suelos CIREN.', error);
        onSuelosStatusRef.current?.({
          kind: 'error',
          service: SUELOS_SERVICE_NAME,
          operation: 'export',
        });
      }
    };

    const onMoveEnd = () => void refresh();
    map.on('moveend', onMoveEnd);
    void refresh();

    let popupGeneration = 0;
    let popupOpenedThisTurn = false;
    const onPopupOpen = () => {
      popupGeneration++;
      popupOpenedThisTurn = true;
      queueMicrotask(() => {
        popupOpenedThisTurn = false;
      });
    };

    const onClick = async (e: L.LeafletMouseEvent) => {
      // Un feature vectorial puede abrir su popup durante el mismo evento. No
      // disparamos identify en ese caso ni reemplazamos popups abiertos después.
      if (popupOpenedThisTurn) return;
      const expectedPopupGeneration = popupGeneration;
      // Bajo el zoom mínimo la capa no está visible: no consultar identify.
      if (map.getZoom() < SUELOS_MIN_ZOOM) return;
      const id = ++identifySequence;
      identifyController?.abort();
      const controller = new AbortController();
      identifyController = controller;
      const { lat, lng } = e.latlng;
      const bounds = map.getBounds();
      const size = map.getSize();
      const params = new URLSearchParams({
        geometry: `${lng},${lat}`,
        tolerance: '2',
        mapExtent: `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`,
        imageDisplay: `${size.x},${size.y},96`,
      });
      try {
        const response = await fetch(`${SUELOS_IDENTIFY_URL}?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          const failure = await suelosFailureDetails(response, 'identify');
          if (
            id !== identifySequence || controller.signal.aborted ||
            popupGeneration !== expectedPopupGeneration ||
            !mapRef.current || !suelosRef.current
          ) return;
          L.popup({ maxWidth: 300 })
            .setLatLng(e.latlng)
            .setContent(
              `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(failure.service)} ` +
              `(operación ${esc(failure.operation)}). Intenta nuevamente en unos segundos.</div>` +
              `</div>`,
            )
            .openOn(mapRef.current);
          return;
        }
        const data = (await response.json()) as {
          results?: { layerName?: string; soilClass?: string | null }[];
        };
        if (
          id !== identifySequence || controller.signal.aborted ||
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        const result = data.results?.find((item) => item.soilClass) ?? data.results?.[0];
        const clase = result?.soilClass ?? null;
        const region = result?.layerName ?? '';
        const body = clase
          ? `<div style="font-weight:600;font-size:0.92rem">Capacidad de uso: Clase ${esc(clase)}</div>` +
            `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
            `font-size:0.68rem;font-weight:600;color:#1e293b;background:${suelosClassColor(clase)};` +
            `border:1px solid rgba(0,0,0,.15)">Suelos agrológicos CIREN</div>` +
            (region ? `<div style="opacity:.7">${esc(region)}</div>` : '')
          : `<div style="font-weight:600;font-size:0.92rem">Sin clase CIREN registrada en este punto</div>` +
            `<div style="opacity:.7;margin-top:.2rem">El servicio respondió correctamente, pero el punto puede estar fuera del área estudiada o no tener clasificación disponible.</div>`;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">${body}` +
              `<div style="margin-top:.35rem;font-size:0.62rem;opacity:.5">${SUELOS_ATTRIBUTION}</div></div>`,
          )
          .openOn(mapRef.current);
      } catch (error) {
        if (controller.signal.aborted || id !== identifySequence) return;
        console.error('No se pudo consultar la clase de suelo CIREN.', error);
        if (
          popupGeneration !== expectedPopupGeneration ||
          !mapRef.current || !suelosRef.current
        ) return;
        L.popup({ maxWidth: 300 })
          .setLatLng(e.latlng)
          .setContent(
            `<div style="font-size:0.8rem;line-height:1.45;min-width:220px">` +
              `<div style="font-weight:600;font-size:0.92rem;color:#b91c1c">No se pudo consultar el suelo</div>` +
              `<div style="margin-top:.25rem;opacity:.75">El servicio no respondió: ${esc(SUELOS_SERVICE_NAME)} ` +
              `(operación identify). Intenta nuevamente en unos segundos.</div></div>`,
          )
          .openOn(mapRef.current);
      }
    };

    map.on('popupopen', onPopupOpen);
    map.on('click', onClick);

    return () => {
      exportSequence++;
      identifySequence++;
      exportController?.abort();
      identifyController?.abort();
      if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
      map.off('moveend', onMoveEnd);
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
