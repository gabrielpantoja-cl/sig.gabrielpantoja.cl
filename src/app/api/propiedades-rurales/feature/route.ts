import { enforce, corsHeaders } from '@/lib/security';
import {
  normalizePropiedadRuralRol,
  PROPIEDADES_RURALES_DISCLAIMER,
  PROPIEDADES_RURALES_SUBLAYERS,
  type PropiedadRuralFeatureProps,
} from '@/lib/propiedades-rurales';
import {
  PROPIEDADES_RURALES_UPSTREAM_SERVICE,
  fetchCiren,
  propiedadesRuralesProxyError,
  readExactParams,
} from '@/lib/propiedades-rurales-proxy';

export const runtime = 'nodejs';

const MAX_GEOJSON_BYTES = 1024 * 1024;
const MAX_COORDINATES = 50_000;
type Position = [number, number];

function geometryExtent(geometry: unknown): [number, number, number, number] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== 'Polygon' && candidate.type !== 'MultiPolygon') return null;
  let count = 0;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lng, lat] = value as Position;
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -76 || lng > -66 || lat < -57 || lat > -17) return false;
      count++;
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
      return count <= MAX_COORDINATES;
    }
    return Array.isArray(value) && value.length > 0 && value.every(visit);
  };
  return visit(candidate.coordinates) && west < east && south < north
    ? [west, south, east, north]
    : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : null;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(req), Vary: 'Origin' } });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const input = readExactParams(new URL(req.url).searchParams, ['layer', 'oid', 'rol']);
  const layerId = input ? Number(input.layer) : NaN;
  const objectId = input ? Number(input.oid) : NaN;
  const rol = input ? normalizePropiedadRuralRol(input.rol) : null;
  const layer = PROPIEDADES_RURALES_SUBLAYERS.find((item) => item.layerId === layerId);
  if (!layer || !rol || !Number.isSafeInteger(objectId) || objectId <= 0) {
    return propiedadesRuralesProxyError(req, 400, 'INVALID_REQUEST', 'feature');
  }

  const upstream = new URL(`${PROPIEDADES_RURALES_UPSTREAM_SERVICE}/${layerId}/query`);
  upstream.search = new URLSearchParams({
    objectIds: String(objectId),
    where: `rol = '${rol}'`,
    outFields: `${layer.objectIdField},rol,desccomu,comudere,provdere,regidere`,
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '6',
    f: 'geojson',
  }).toString();

  const { response, body, timedOut, bodyError } = await fetchCiren(
    upstream,
    'application/geo+json,application/json',
    MAX_GEOJSON_BYTES,
  );
  if (!response || timedOut || bodyError || !body || !response.ok) {
    return propiedadesRuralesProxyError(
      req,
      timedOut ? 504 : 502,
      timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      'feature',
    );
  }

  let data: { type?: unknown; features?: unknown; error?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(body)) as typeof data;
  } catch {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', 'feature');
  }
  if (data.error || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || data.features.length !== 1) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', 'feature');
  }
  const source = data.features[0] as { type?: unknown; geometry?: unknown; properties?: unknown };
  const extent = geometryExtent(source.geometry);
  const attributes = source.properties && typeof source.properties === 'object'
    ? source.properties as Record<string, unknown>
    : {};
  if (!extent || source.type !== 'Feature' || text(attributes.rol) !== rol) {
    return propiedadesRuralesProxyError(req, 502, 'UPSTREAM_INVALID_RESPONSE', 'feature');
  }

  const properties: PropiedadRuralFeatureProps = {
    id: `${layerId}:${objectId}`,
    layerId,
    objectId,
    rol,
    comuna: text(attributes.desccomu),
    codComuna: text(attributes.comudere),
    codProvincia: text(attributes.provdere),
    codRegion: text(attributes.regidere),
    sourceRegion: layer.region,
    vintage: layer.vintage,
    disclaimer: PROPIEDADES_RURALES_DISCLAIMER,
  };
  return Response.json(
    { feature: { type: 'Feature', geometry: source.geometry, properties }, extent },
    { headers: { ...corsHeaders(req), 'Cache-Control': 'private, max-age=300', Vary: 'Origin' } },
  );
}
