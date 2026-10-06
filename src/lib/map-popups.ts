import type { MapPoint } from '@/lib/types';
import { categoryColor, type ProtectedAreaProps } from '@/lib/protected-areas';
import { URBAN_LIMIT_ATTRIBUTION, URBAN_LIMIT_COLOR, type UrbanLimitProps } from '@/lib/urban-limit';
import { kmlDisplayName, kmlPropText, type KmlFeatureProps, type KmlLayer } from '@/lib/kml';
import { COMUNAS_ATTRIBUTION, COMUNAS_COLOR, type ComunaProps } from '@/lib/comunas';
import { RED_VIAL_ATTRIBUTION, ROAD_CLASS_GROUPS, roadClassGroup, type RedVialProps } from '@/lib/red-vial';
import {
  DRENAJE_TYPE_GROUPS,
  RED_DRENAJE_ATTRIBUTION,
  drenajeType,
  type RedDrenajeProps,
} from '@/lib/red-drenaje';
import {
  LINEAS_TRANSMISION_ATTRIBUTION,
  LINEAS_TRANSMISION_DISCLAIMER,
  TENSION_GROUPS,
  tensionGroup,
  type LineaTransmisionProps,
} from '@/lib/lineas-transmision';
import {
  CATASTRO_FRUTICOLA_ATTRIBUTION,
  VINTAGE_HINT,
  VINTAGE_LABEL,
  especieColor,
  regionLabel,
  speciesList,
  type CatastroFruticolaProps,
} from '@/lib/catastro-fruticola';
import { VEGETACIONAL_ATTRIBUTION, speciesPairs, type VegetacionalProps } from '@/lib/vegetacional';
import { destinoLabel, hexEdgeLabel, type HexbinMeta, type HexbinProps } from '@/lib/hexbins';

/**
 * HTML de los popups del mapa. Leaflet inyecta el string tal cual con
 * `innerHTML`, así que TODO valor que venga de datos (Neon, GeoJSON oficiales,
 * KML del usuario, servicios ArcGIS) pasa por `esc()` antes de entrar, y las
 * URLs además por `safeHref()`. Son funciones puras: se testean sin Leaflet
 * (`map-popups.test.ts`).
 */

export const formatCLP = (value: number | null): string =>
  value == null
    ? 'Monto no informado'
    : new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
      }).format(value);

/**
 * Formatea una fecha calendario ISO sin crear un `Date`, para no desplazarla
 * por zona horaria.
 */
export const formatDateCL = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
};

export const esc = (s: string | null): string =>
  (s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * Solo enlaces http(s). `esc()` evita romper el atributo, pero no impide un
 * `javascript:` o `data:` que el navegador ejecutaría al hacer clic.
 */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Filas etiqueta/valor del cuerpo de un popup. Los valores ya vienen escapados. */
function popupRows(rows: [string, string][]): string {
  return rows
    .map(
      ([key, value]) =>
        `<tr>` +
        `<td style="opacity:.55;padding:1px 8px 1px 0;white-space:nowrap;vertical-align:top">${key}</td>` +
        `<td style="vertical-align:top">${value}</td>` +
        `</tr>`,
    )
    .join('');
}

/**
 * Popup HTML for a single transaction. Leads with the predio/comuna and price,
 * then the CBR registry citation, its two independent legal dates when known,
 * the conservador it belongs to and the remaining public attributes.
 * El código de destino SII se omite a propósito: aporta poco al perito fuera
 * del informe catastral y compite con la fecha de la escritura, que es la
 * pieza temporal clave para el cruce de inscripciones.
 */
export function buildPopup(p: MapPoint): string {
  const cite = [
    p.fojas ? `Fojas ${esc(p.fojas)}` : null,
    p.numero != null ? `N° ${p.numero}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const inscripcion = cite
    ? [cite, p.anio != null ? `Año ${p.anio}` : null].filter(Boolean).join(' · ')
    : p.anio != null
      ? `Año ${p.anio}`
      : null;

  const rows: [string, string][] = [];
  if (inscripcion) rows.push(['Inscripción', inscripcion]);
  if (p.conservador) rows.push(['Conservador', `CBR ${esc(p.conservador)}`]);
  if (p.rol) rows.push(['ROL', esc(p.rol)]);
  if (p.superficie) rows.push(['Superficie de terreno', `${p.superficie.toLocaleString('es-CL')} m²`]);
  const fechaIns = formatDateCL(p.fechaInscripcion);
  if (fechaIns) rows.push(['Fecha de inscripción', fechaIns]);
  const fechaEsc = formatDateCL(p.fechaEscritura);
  if (fechaEsc) rows.push(['Fecha de escritura', fechaEsc]);

  const body = popupRows(rows);

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
export function buildProtectedPopup(props: ProtectedAreaProps): string {
  const cat = props.designacion_ap ?? 'Área protegida';
  const color = categoryColor(props.designacion_ap);
  const rows: [string, string][] = [];
  if (props.region) rows.push(['Región', esc(props.region)]);
  rows.push(['Superficie', fmtHa(props.ha)]);
  if (props.cod_rnap) rows.push(['Código RNAP', esc(props.cod_rnap)]);

  const body = popupRows(rows);

  const href = safeHref(props.url_fuente);
  const ficha = href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" ` +
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
export function buildUrbanLimitPopup(props: UrbanLimitProps): string {
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

  const body = popupRows(rows);

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
export function buildComunaPopup(props: ComunaProps): string {
  const rows: [string, string][] = [];
  if (props.PROVINCIA) rows.push(['Provincia', esc(props.PROVINCIA)]);
  if (props.REGION) rows.push(['Región', esc(props.REGION)]);
  if (props.CUT_COM) rows.push(['Código CUT', esc(props.CUT_COM)]);
  if (props.SUPERFICIE != null)
    rows.push([
      'Superficie',
      `${Number(props.SUPERFICIE).toLocaleString('es-CL', { maximumFractionDigits: 1 })} km²`,
    ]);

  const body = popupRows(rows);

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
export function buildRedVialPopup(props: RedVialProps): string {
  const group = ROAD_CLASS_GROUPS[roadClassGroup(props.CLASIFICACION)];

  const rows: [string, string][] = [];
  if (props.CLASIFICACION) rows.push(['Clasificación', esc(props.CLASIFICACION)]);
  if (props.CARPETA) rows.push(['Carpeta', esc(props.CARPETA)]);
  if (props.CONCESIONADO) rows.push(['Concesionado', esc(props.CONCESIONADO)]);

  const body = popupRows(rows);

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
export function buildRedDrenajePopup(props: RedDrenajeProps): string {
  const group = DRENAJE_TYPE_GROUPS[drenajeType(props)];

  const rows: [string, string][] = [];
  if (props.COD_CUEN) rows.push(['Cuenca BNA', esc(props.COD_CUEN)]);
  if (props.COD_SUBC) rows.push(['Subcuenca', esc(props.COD_SUBC)]);
  if (props.COD_SSUBC) rows.push(['Subsubcuenca', esc(props.COD_SSUBC)]);
  if (props.NOM_REG) rows.push(['Región', esc(props.NOM_REG)]);

  const body = popupRows(rows);

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

/** Popup de un tramo eléctrico oficial. La geometría representa el eje
 * cartográfico de la línea, nunca la faja jurídica de una servidumbre. */
export function buildLineaTransmisionPopup(props: LineaTransmisionProps): string {
  const group = TENSION_GROUPS[tensionGroup(props.TENSION_KV)];
  const rows: [string, string][] = [];
  if (props.NOMBRE && props.NOMBRE !== props.TRAMO) rows.push(['Línea', esc(props.NOMBRE)]);
  if (props.CIRCUITO) rows.push(['Circuito', esc(props.CIRCUITO)]);
  if (props.TENSION_KV != null) {
    rows.push(['Tensión nominal', `${Number(props.TENSION_KV).toLocaleString('es-CL')} kV`]);
  }
  if (props.ESTADO) rows.push(['Estado', esc(props.ESTADO)]);
  if (props.PROPIEDAD) rows.push(['Propietario de la línea', esc(props.PROPIEDAD)]);
  if (props.LONG_KM != null) {
    rows.push(['Longitud informada', `${Number(props.LONG_KM).toLocaleString('es-CL', { maximumFractionDigits: 1 })} km`]);
  }
  const operacion = formatDateCL(props.F_OPERACIO);
  if (operacion) rows.push(['Entrada en operación', operacion]);
  if (props.SIST_ELECT) rows.push(['Sistema eléctrico', esc(props.SIST_ELECT)]);
  if (props.RCA && !/^S\/?I$/i.test(props.RCA.trim())) rows.push(['RCA', esc(props.RCA)]);
  const actualizacion = formatDateCL(props.FECH_ACT);
  if (actualizacion) rows.push(['Actualización de la fuente', actualizacion]);

  const body = popupRows(rows);

  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:230px">` +
    `<div style="font-weight:600;font-size:0.92rem">${esc(props.TRAMO || props.NOMBRE || 'Tramo sin nombre informado')}</div>` +
    `<div style="display:inline-block;margin:.2rem 0 .45rem;padding:1px 7px;border-radius:9px;` +
    `font-size:0.68rem;font-weight:600;color:#fff;background:${group.color}">${group.label}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.4rem;font-size:0.62rem;opacity:.55">${LINEAS_TRANSMISION_ATTRIBUTION}.</div>` +
    `<div style="margin-top:.2rem;font-size:0.62rem;font-weight:600;opacity:.7">${LINEAS_TRANSMISION_DISCLAIMER}</div>` +
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
export function buildCatastroFruticolaPopup(props: CatastroFruticolaProps): string {
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

  const body = popupRows(rows) + vintageNote;

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

export function buildVegetacionalPopup(props: VegetacionalProps, layerName = ''): string {
  const species = speciesPairs(props);
  const rows: [string, string][] = [];
  if (props.uso) rows.push(['Uso de la tierra', esc(props.uso)]);
  if (props.subuso) rows.push(['Subuso', esc(props.subuso)]);
  if (props.uso_tierra && props.uso_tierra !== props.subuso) rows.push(['Descripción', esc(props.uso_tierra)]);
  if (props.estructura) rows.push(['Estructura', esc(props.estructura)]);
  if (props.cobertura) rows.push(['Cobertura', esc(props.cobertura)]);
  if (props.altura) rows.push(['Altura', esc(props.altura)]);
  if (props.tipo_fores) rows.push(['Tipología forestal', esc(props.tipo_fores)]);
  if (props.subtipofor) rows.push(['Subtipo forestal', esc(props.subtipofor)]);
  if (species.length) rows.push(['Especies dominantes', esc(species.join(' · '))]);
  const conservationSpecies = [props.esp_c1, props.esp_c2].filter((value): value is string => Boolean(value));
  if (conservationSpecies.length) rows.push(['Especies en conservación', esc(conservationSpecies.join(' · '))]);
  if (props.nom_snaspe) rows.push(['Área silvestre protegida', esc(props.nom_snaspe)]);
  if (props.tipo_snasp) rows.push(['Categoría de protección', esc(props.tipo_snasp)]);
  if (props.nom_reg) rows.push(['Región', esc(props.nom_reg)]);
  if (props.nom_prov) rows.push(['Provincia', esc(props.nom_prov)]);
  if (props.nom_com) rows.push(['Comuna', esc(props.nom_com)]);
  if (props.superf_ha != null) rows.push(['Superficie cartográfica', `${props.superf_ha.toLocaleString('es-CL')} ha`]);
  if (props.tc) rows.push(['Código de cambio CONAF', esc(props.tc)]);
  if (props.tipo_poli) rows.push(['Tipo de polígono CONAF', esc(props.tipo_poli)]);
  const vintage = props.vintage || /CONAF\s+(\d{4}(?:-\d{4})?)/i.exec(layerName)?.[1] || '';
  if (vintage || props.nom_reg) {
    rows.push(['Actualización regional', [esc(vintage), esc(props.nom_reg)].filter(Boolean).join(' · ')]);
  }
  const body = popupRows(rows);
  return `<div style="font-size:0.8rem;line-height:1.45;min-width:230px"><div style="font-weight:600;font-size:.92rem">Recursos vegetacionales</div><table style="border-collapse:collapse">${body}</table><div style="margin-top:.35rem;font-size:.62rem;opacity:.5">${VEGETACIONAL_ATTRIBUTION} · cartografía referencial</div></div>`;
}

/**
 * Popup de un feature dentro de una capa KML del usuario. Muestra el nombre
 * del Placemark y su descripción como texto plano: cualquier HTML embebido en
 * el KML (habitual en exportes de Google Earth) se descarta antes de escapar,
 * para no inyectar markup ajeno en la página.
 */
export function buildKmlPopup(props: KmlFeatureProps, layer: KmlLayer): string {
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

/**
 * Popup de una celda del mapa de calor de valor. Muestra la mediana como cifra
 * principal, el rango intercuartil como medida de dispersión y el `n` como
 * medida de confianza — el mismo criterio de jerarquía visual del panel de
 * estadísticas (`docs/estadisticas.md` §4): el estadístico robusto al frente.
 *
 * Es el dato de la CELDA más cercana al clic, no el valor interpolado del
 * píxel: lo que se cita en un informe tiene que ser una mediana real de
 * transacciones reales, no el resultado del suavizado.
 */
export function buildHexbinPopup(props: HexbinProps, meta: HexbinMeta): string {
  const money = (v: number | null): string =>
    v == null || !Number.isFinite(v) ? '—' : formatCLP(Math.round(v));
  const rows: [string, string][] = [
    ['Rango intercuartil', `${money(props.p25)} – ${money(props.p75)} /m²`],
    ['Transacciones', `${props.n.toLocaleString('es-CL')} en la celda`],
    ['Mediana del monto', money(props.mediana_monto)],
    ['Resolución', `hexágono de ${hexEdgeLabel(meta.edge_m)} de arista`],
    ['Destino SII', esc(destinoLabel(meta.destino))],
  ];
  const body = popupRows(rows);
  return (
    `<div style="font-size:0.8rem;line-height:1.45;min-width:230px">` +
    `<div style="font-weight:600;font-size:.92rem">$/m² típico de la celda</div>` +
    `<div style="font-size:1.15rem;font-weight:700;margin:.15rem 0 .35rem">${money(props.mediana_ppm2)}</div>` +
    `<table style="border-collapse:collapse">${body}</table>` +
    `<div style="margin-top:.35rem;font-size:.62rem;opacity:.5">` +
    `Mediana de $/m² de terreno. Señal de mercado, no tasación.</div>` +
    `</div>`
  );
}
