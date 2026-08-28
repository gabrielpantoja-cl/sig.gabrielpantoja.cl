import 'server-only';
import { corsHeaders } from '@/lib/security';
import { fetchCiren, parseNumberTuple, readExactParams, validGeographicExtent, validGeographicPoint, validIntegerTuple } from '@/lib/suelos-proxy';

export const PROPIEDADES_RURALES_UPSTREAM_SERVICE =
  'https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer';
export const PROPIEDADES_RURALES_PROXY_SERVICE_NAME = 'CIREN · PROPIEDADES_RURALES · ArcGIS MapServer';
export type PropiedadesRuralesProxyOperation = 'export' | 'identify';

export function propiedadesRuralesProxyError(req: Request, status: number, code: string, operation: PropiedadesRuralesProxyOperation) {
  return Response.json({ error: { code, message: code === 'INVALID_REQUEST' ? 'Los parámetros de la consulta de propiedades rurales no son válidos.' : 'El servicio oficial de propiedades rurales CIREN no está disponible temporalmente.', service: PROPIEDADES_RURALES_PROXY_SERVICE_NAME, operation } }, { status, headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' } });
}

export function ruralExtent(values: number[]): boolean {
  if (!validGeographicExtent(values)) return false;
  const [west, south, east, north] = values;
  return east - west <= 2 && north - south <= 2 && west >= -76 && east <= -66 && south >= -57 && north <= -17;
}

export { fetchCiren, parseNumberTuple, readExactParams, validGeographicPoint, validIntegerTuple };
