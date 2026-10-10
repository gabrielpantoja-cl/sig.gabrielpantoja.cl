import 'server-only';
import { proxyErrorResponse } from '@/lib/arcgis-proxy';
import {
  HUMEDALES_SERVICE_NAME,
  type HumedalInventarioProps,
  type HumedalIdentifyResult,
  type HumedalUrbanoProps,
  type HumedalesOperation,
} from '@/lib/humedales';

export const HUMEDALES_UPSTREAM_SERVICE =
  'https://arcgis.mma.gob.cl/server/rest/services/SIMBIO/SIMBIO_HUMEDALES/MapServer';

/** Subcapas: 0 = Inventario Nacional, 1 = Humedales Urbanos Declarados. */
export const HUMEDALES_LAYER_IDS = '0,1';

export function humedalesProxyError(
  req: Request,
  status: number,
  code: string,
  operation: HumedalesOperation,
) {
  return proxyErrorResponse(req, status, {
    code,
    message: code === 'INVALID_REQUEST'
      ? 'Los parámetros de la consulta de humedales no son válidos.'
      : 'El servicio oficial de humedales del MMA no está disponible temporalmente.',
    service: HUMEDALES_SERVICE_NAME,
    operation,
  });
}

/**
 * `identify` entrega los atributos bajo su ALIAS («Nombre Humedal»,
 * «Hectáreas, ha») y con números como texto en formato chileno («124,13»).
 * Se normaliza el alias (sin tildes, minúsculas) y se mapea a un nombre
 * estable; cualquier atributo que no esté en estas tablas se descarta, así
 * que un campo nuevo en el servicio nunca llega a la UI sin revisarlo.
 */
const INVENTARIO_ALIASES: Record<string, keyof HumedalInventarioProps> = {
  'cod humeda': 'codigo',
  'nombre humedal': 'nombre',
  'nombre humedal master': 'nombreMaster',
  'orden 1': 'orden1',
  'orden 2': 'orden2',
  'orden 3': 'orden3',
  'orden 4': 'orden4',
  'orden 5': 'orden5',
  'hectareas ha': 'hectareas',
  'hectareas limite urbano': 'hectareasUrbanas',
  'url ficha simbio': 'urlFicha',
};

const URBANO_ALIASES: Record<string, keyof HumedalUrbanoProps> = {
  'codigo humedal urbano declarado': 'codigo',
  'nombre del humedal': 'nombre',
  comuna: 'comuna',
  provincia: 'provincia',
  region: 'region',
  'superficie ha': 'hectareas',
  proceso: 'proceso',
  'resolucion exenta': 'resolucion',
  'enlace resolucion exenta': 'urlResolucion',
  'enlace expediente': 'urlExpediente',
};

const NUMERIC_FIELDS = new Set(['hectareas', 'hectareasUrbanas']);

export function normalizedAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** ArcGIS escribe «Null» como texto cuando el campo está vacío. */
function cleanText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  return cleaned === '' || cleaned.toLowerCase() === 'null' ? null : cleaned;
}

/**
 * «124,130663» → 124.130663 y «1.234,5» → 1234.5. Sin coma, el punto se lee
 * como decimal («124.13»). Acepta también un número ya parseado.
 */
export function parseChileanNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = cleanText(value);
  if (!text) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function mapAttributes<T extends object>(
  raw: unknown,
  aliases: Record<string, keyof T>,
): T {
  const out = Object.fromEntries(
    Object.values(aliases).map((field) => [field, null]),
  ) as Record<string, string | number | null>;
  if (!raw || typeof raw !== 'object') return out as T;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = aliases[normalizedAlias(key)] as string | undefined;
    if (!field) continue;
    out[field] = NUMERIC_FIELDS.has(field) ? parseChileanNumber(value) : cleanText(value);
  }
  return out as T;
}

/** Normaliza un resultado de `identify` según la subcapa que lo produjo. */
export function canonicalHumedal(result: {
  layerId?: unknown;
  attributes?: unknown;
}): HumedalIdentifyResult | null {
  if (result.layerId === 0) {
    return { kind: 'inventario', attributes: mapAttributes<HumedalInventarioProps>(result.attributes, INVENTARIO_ALIASES) };
  }
  if (result.layerId === 1) {
    return { kind: 'urbano', attributes: mapAttributes<HumedalUrbanoProps>(result.attributes, URBANO_ALIASES) };
  }
  return null;
}
