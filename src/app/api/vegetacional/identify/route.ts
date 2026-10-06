import { enforce, corsHeaders } from '@/lib/security';
import { vegetacionalLayerIds, type VegetacionalProps } from '@/lib/vegetacional';
import { fetchArcGis, identifySearch, parseJsonBody, readIdentifyParams } from '@/lib/arcgis-proxy';
import { VEGETACIONAL_UPSTREAM_SERVICE, vegetacionalProxyError } from '@/lib/vegetacional-proxy';

const OPERATION = 'identify' as const;
const MAX_JSON_BYTES = 512 * 1024;

/**
 * `identify` devuelve los atributos con su alias legible; se normaliza el alias
 * (sin tildes, minúsculas) y se mapea al nombre de campo que espera la UI. Un
 * atributo que ya llega con el nombre canónico se acepta tal cual.
 */
const FIELD_ALIASES: Record<string, keyof VegetacionalProps> = {
  'descripcion del uso subuso estructura y cobertura': 'uso_tierra',
  'uso de la tierra': 'uso',
  'subuso de la tierra': 'subuso',
  'estructura del bosque nativo': 'estructura',
  'cobertura de la vegetacion': 'cobertura',
  'altura de la vegetacion': 'altura',
  'tipo forestal': 'tipo_fores',
  'descriptor subtipo forestal': 'subtipofor',
  'especie en conservacion 1': 'esp_c1',
  'especie en conservacion 2': 'esp_c2',
  'area silvestre protegida': 'nom_snaspe',
  'categoria de area silvestre protegida': 'tipo_snasp',
  'nombre region': 'nom_reg',
  'nombre provincia': 'nom_prov',
  'nombre comuna': 'nom_com',
  'tipo de cambio': 'tc',
  'tipo de poligono': 'tipo_poli',
  'superficie en hectareas': 'superf_ha',
};
for (const n of [1, 2, 3, 4, 5, 6]) {
  FIELD_ALIASES[`especie ${n} nombre cientifico`] = `especi${n}_ci` as keyof VegetacionalProps;
  FIELD_ALIASES[`especie ${n} nombre comun`] = `especi${n}_co` as keyof VegetacionalProps;
}

const CANONICAL_FIELDS = new Set(Object.values(FIELD_ALIASES));

function normalizedFieldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalAttributes(raw: unknown): Record<string, string | number | null> {
  const attributes: Record<string, string | number | null> = {};
  if (!raw || typeof raw !== 'object') return attributes;
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const direct = rawKey as keyof VegetacionalProps;
    const canonical = FIELD_ALIASES[normalizedFieldName(rawKey)]
      ?? (CANONICAL_FIELDS.has(direct) ? direct : null);
    if (!canonical) continue;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      attributes[canonical] = rawValue;
    } else if (typeof rawValue === 'string') {
      const cleaned = rawValue.replace(/\s+/g, ' ').trim().slice(0, 500);
      if (canonical === 'superf_ha') {
        const number = Number(cleaned.replace(',', '.'));
        attributes[canonical] = Number.isFinite(number) ? number : null;
      } else {
        attributes[canonical] = cleaned || null;
      }
    } else if (rawValue == null) {
      attributes[canonical] = null;
    }
  }
  return attributes;
}

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readIdentifyParams(new URL(req.url).searchParams);
  if (!input) {
    return vegetacionalProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }
  const okHeaders = { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' };

  const layerIds = vegetacionalLayerIds(input.mapExtent);
  if (layerIds.length === 0) return Response.json({ results: [] }, { headers: okHeaders });

  const upstream = new URL(`${VEGETACIONAL_UPSTREAM_SERVICE}/identify`);
  upstream.search = identifySearch(input, `visible:${layerIds.join(',')}`);

  const { response, body, timedOut, bodyError } = await fetchArcGis(upstream, 'application/json', MAX_JSON_BYTES);
  if (!response) {
    return vegetacionalProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok || timedOut || bodyError || !body) {
    return vegetacionalProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  const data = parseJsonBody<{ results?: unknown; error?: unknown }>(body);
  if (!data) {
    return vegetacionalProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (data.error || !Array.isArray(data.results)) {
    return vegetacionalProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', OPERATION);
  }

  const results = (data.results as Array<{ layerName?: unknown; attributes?: unknown }>)
    .slice(0, 20)
    .map((result) => ({
      layerName: typeof result.layerName === 'string' ? result.layerName.slice(0, 160) : '',
      attributes: canonicalAttributes(result.attributes),
    }));
  return Response.json({ results }, { headers: okHeaders });
}
