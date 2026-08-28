import { enforce, corsHeaders } from '@/lib/security';
import {
  normalizePropiedadRuralRol,
  PROPIEDADES_RURALES_SUBLAYERS,
  type PropiedadRuralSearchMatch,
} from '@/lib/propiedades-rurales';
import {
  PROPIEDADES_RURALES_UPSTREAM_SERVICE,
  fetchCiren,
  propiedadesRuralesProxyError,
  readExactParams,
} from '@/lib/propiedades-rurales-proxy';

export const runtime = 'nodejs';

const MAX_LAYER_RESULTS = 6;
const MAX_RESULTS = 40;
const MAX_JSON_BYTES = 128 * 1024;

type ArcGisFeature = { attributes?: unknown };
type ArcGisQueryResponse = { features?: unknown; exceededTransferLimit?: unknown; error?: unknown };

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;

const normalizePlace = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-CL');

async function queryLayer(
  layer: (typeof PROPIEDADES_RURALES_SUBLAYERS)[number],
  rol: string,
): Promise<{ results: PropiedadRuralSearchMatch[]; truncated: boolean }> {
  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/${layer.layerId}/query`);
  upstream.search = new URLSearchParams({
    where: `rol = '${rol}'`,
    outFields: `${layer.objectIdField},rol,desccomu,comudere,provdere,regidere`,
    returnGeometry: 'false',
    resultRecordCount: String(MAX_LAYER_RESULTS),
    orderByFields: 'desccomu ASC',
    f: 'json',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchCiren(
    upstream,
    'application/json',
    MAX_JSON_BYTES,
  );
  if (!response || timedOut || bodyError || !body || !response.ok) {
    throw new Error(timedOut ? 'timeout' : 'upstream');
  }

  let data: ArcGisQueryResponse;
  try {
    data = JSON.parse(new TextDecoder().decode(body)) as ArcGisQueryResponse;
  } catch {
    throw new Error('invalid-json');
  }
  if (data.error || !Array.isArray(data.features)) throw new Error('arcgis');

  const results = (data.features as ArcGisFeature[]).flatMap((feature) => {
    if (!feature.attributes || typeof feature.attributes !== 'object') return [];
    const attributes = feature.attributes as Record<string, unknown>;
    const objectId = Number(attributes[layer.objectIdField]);
    const sourceRol = text(attributes.rol);
    if (!Number.isSafeInteger(objectId) || objectId <= 0 || sourceRol !== rol) return [];
    return [{
      id: `${layer.layerId}:${objectId}`,
      layerId: layer.layerId,
      objectId,
      rol: sourceRol,
      comuna: text(attributes.desccomu),
      codComuna: text(attributes.comudere),
      codProvincia: text(attributes.provdere),
      codRegion: text(attributes.regidere),
      sourceRegion: layer.region,
      vintage: layer.vintage,
    } satisfies PropiedadRuralSearchMatch];
  });
  return {
    results,
    truncated: data.exceededTransferLimit === true || results.length >= MAX_LAYER_RESULTS,
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readExactParams(new URL(req.url).searchParams, ['rol', 'comuna']);
  const rol = input ? normalizePropiedadRuralRol(input.rol) : null;
  const comuna = input?.comuna.trim() ?? '';
  if (!rol || comuna.length > 100 || (comuna && !/^[\p{L}\p{M}\s.'’-]+$/u.test(comuna))) {
    return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', 'search');
  }

  try {
    const batches: Array<(typeof PROPIEDADES_RURALES_SUBLAYERS)[number][]> = [];
    for (let index = 0; index < PROPIEDADES_RURALES_SUBLAYERS.length; index += 4) {
      batches.push(PROPIEDADES_RURALES_SUBLAYERS.slice(index, index + 4));
    }
    const layerResults: Awaited<ReturnType<typeof queryLayer>>[] = [];
    for (const batch of batches) {
      layerResults.push(...await Promise.all(batch.map((layer) => queryLayer(layer, rol))));
    }

    const preferredComuna = comuna ? normalizePlace(comuna) : null;
    const all = layerResults.flatMap((item) => item.results);
    all.sort((a, b) => {
      const aPreferred = preferredComuna && a.comuna ? normalizePlace(a.comuna) === preferredComuna : false;
      const bPreferred = preferredComuna && b.comuna ? normalizePlace(b.comuna) === preferredComuna : false;
      if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      return (a.comuna ?? '').localeCompare(b.comuna ?? '', 'es-CL') || a.id.localeCompare(b.id);
    });
    const deduplicated = [...new Map(all.map((match) => [match.id, match])).values()];
    const truncated = layerResults.some((item) => item.truncated) || deduplicated.length > MAX_RESULTS;

    return Response.json(
      {
        query: { rol, comuna: comuna || null },
        results: deduplicated.slice(0, MAX_RESULTS),
        truncated,
      },
      {
        headers: {
          ...corsHeaders(req),
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          Vary: 'Origin',
        },
      },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'timeout';
    return propiedadesRuralesProxyError(
      req,
      timedOut ? 504 : 502,
      timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_INVALID_RESPONSE',
      'search',
    );
  }
}
