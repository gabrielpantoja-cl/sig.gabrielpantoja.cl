import { enforce, corsHeaders } from '@/lib/security';
import { PROPIEDADES_RURALES_LAYER_IDS } from '@/lib/propiedades-rurales';
import { fetchArcGis, identifySearch, parseJsonBody, readIdentifyParams } from '@/lib/arcgis-proxy';
import {
  PROPIEDADES_RURALES_UPSTREAM_SERVICE,
  propiedadesRuralesProxyError,
  ruralExtent,
} from '@/lib/propiedades-rurales-proxy';

const OPERATION = 'identify' as const;
const MAX_JSON_BYTES = 512 * 1024;
const ROL = /^\d{1,7}-\d{1,6}$/;

const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 160) : null);

/** Primer atributo cuyo nombre (sin distinguir mayúsculas) está en `names`. */
const attr = (attributes: Record<string, unknown>, names: string[]) => {
  const key = Object.keys(attributes).find((candidate) => names.includes(candidate.toLowerCase()));
  return key ? text(attributes[key]) : null;
};

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readIdentifyParams(new URL(req.url).searchParams, ruralExtent);
  if (!input) {
    return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', OPERATION);
  }

  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/identify`);
  upstream.search = identifySearch(input, `visible:${PROPIEDADES_RURALES_LAYER_IDS.join(',')}`);

  const { response, body, timedOut, bodyError } = await fetchArcGis(upstream, 'application/json', MAX_JSON_BYTES);
  if (!response) {
    return propiedadesRuralesProxyError(req, timedOut ? 504 : 502, timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  if (!response.ok || bodyError || !body) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_UNAVAILABLE', OPERATION);
  }
  const data = parseJsonBody<{ results?: Array<{ layerName?: unknown; attributes?: unknown }>; error?: unknown }>(body);
  if (!data) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', OPERATION);
  }
  if (data.error || !Array.isArray(data.results)) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_ARCGIS_ERROR', OPERATION);
  }

  const results = data.results.slice(0, 10).map(({ layerName, attributes }) => {
    const a = attributes && typeof attributes === 'object' ? attributes as Record<string, unknown> : {};
    const rol = attr(a, ['rol', 'rol sii del predio', 'rol propiedad']);
    const rolValid = rol !== null && ROL.test(rol);
    return {
      layerName: text(layerName),
      attributes: {
        rol: rolValid ? rol : null,
        comuna: attr(a, ['desccomu']),
        codComuna: attr(a, ['comudere']),
        codProvincia: attr(a, ['provdere']),
        codRegion: attr(a, ['regidere']),
        ...(rol && !rolValid ? { quality: 'rol-invalid' as const } : {}),
      },
    };
  });
  return Response.json(
    { results },
    { headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } },
  );
}
