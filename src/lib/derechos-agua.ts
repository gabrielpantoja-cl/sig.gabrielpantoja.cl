/**
 * Derechos de aprovechamiento de aguas (DGA)
 *
 * Catastro Público de Aguas — registro consolidado de derechos consuntivos,
 * no consuntivos, permanentes y eventuales en el territorio nacional.
 *
 * ## Estado: INVESTIGACIÓN
 *
 * La fase 1 mapeará **contexto hídrico** (glaciares SNIA, cuencas DGA) como
 * capas de fondo, y derechos individuales como link-out desde el popup
 * (cada expediente es un PDF + shapefile individual sin consolidación pública).
 *
 * @see docs/roadmap.md § 2.2
 * @see https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/
 */

import type { GeoJSON } from 'geojson';

export type DerechosAguaProperties = {
  tipo?: string; // 'glaciar' | 'cauce' | 'cuenca' | etc.
  nombre?: string;
  cuenca?: string;
  estado?: string; // 'activo' | 'suspendido' | etc.
};

export type DerechosAguaFeature = GeoJSON.Feature<
  GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
  DerechosAguaProperties
>;

export type DerechosAguaGeoJSON = GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
  DerechosAguaProperties
>;

/**
 * Colores por tipo de derecho/entidad hídrica.
 * @todo Confirmar colores con DGA o estándar cartográfico.
 */
export const derechosAguaColors: Record<string, string> = {
  glaciar: '#4A90E2', // Azul glaciar
  cauce: '#2D5016', // Verde oscuro cauces
  cuenca: '#7FA5D0', // Azul claro cuencas
  acuifero: '#3D7A9E', // Azul profundo acuíferos
  estacion: '#E8C547', // Amarillo estaciones fluviométricas
  default: '#5A7A9E',
};

/** Configuración de capa para LayersControl */
export const derechosAguaLayerConfig = {
  name: 'Derechos de agua (DGA)',
  shortName: 'Derechos de agua',
  className: 'derechos-agua',
  color: derechosAguaColors.default,
  description: 'Catastro Público de Aguas, DGA-MOP (en investigación)',
  zIndex: 35,
};

/**
 * Fetch GeoJSON de derechos de agua.
 *
 * @throws Error si el archivo no existe o está vacío (investigación en curso).
 */
export async function fetchDerechosAgua(): Promise<DerechosAguaGeoJSON> {
  const res = await fetch('/data/derechos-agua.geojson');
  if (!res.ok) {
    throw new Error(`fetchDerechosAgua: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as Record<string, unknown> & {
    properties?: Record<string, unknown>;
  };
  if (
    data.properties?.status &&
    String(data.properties.status).includes('INVESTIGACIÓN')
  ) {
    console.warn(
      '⚠️  Capa Derechos de agua aún en investigación. Endpoint WFS DGA no confirmado.',
    );
  }
  return data as unknown as DerechosAguaGeoJSON;
}

/**
 * Popup content para un feature de derechos de agua.
 */
export function derechosAguaPopupContent(
  props: DerechosAguaProperties,
): string {
  const tipo = props.tipo || 'Sin especificar';
  const nombre = props.nombre || 'Sin nombre';
  const cuenca = props.cuenca || '—';
  const estado = props.estado || 'Sin información';

  return `
    <div class="text-sm">
      <p class="font-bold">${nombre}</p>
      <dl class="mt-1 text-xs space-y-0.5">
        <dt class="font-semibold">Tipo:</dt>
        <dd>${tipo}</dd>
        <dt class="font-semibold">Cuenca:</dt>
        <dd>${cuenca}</dd>
        <dt class="font-semibold">Estado:</dt>
        <dd>${estado}</dd>
      </dl>
      <p class="mt-2 text-xs opacity-60">
        <a href="https://dga.mop.gob.cl/servicios-de-informacion/catastro-publico-de-aguas/"
           target="_blank" rel="noreferrer noopener" class="underline">
          Ver en Catastro DGA
        </a>
      </p>
    </div>
  `;
}

/**
 * Atribución y descargo legal para la capa.
 *
 * @see AGENTS.md § Derechos de agua
 */
export const derechosAguaAttribution = `
© Dirección General de Aguas (DGA) — Ministerio de Obras Públicas (MOP).
Catastro Público de Aguas: <a href="https://dga.mop.gob.cl/" target="_blank">dga.mop.gob.cl</a>
| SNIA Observatorio: <a href="https://snia.mop.gob.cl/" target="_blank">snia.mop.gob.cl</a>

<strong>Nota:</strong> Los derechos individuales se consultan por expediente en el
Catastro Público. Esta capa muestra contexto hídrico (glaciares, cuencas, cauces).
`.trim();
