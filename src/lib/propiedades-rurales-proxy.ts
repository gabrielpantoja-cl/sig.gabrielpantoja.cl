import 'server-only';
import { proxyErrorResponse, validGeographicExtent } from '@/lib/arcgis-proxy';

export const PROPIEDADES_RURALES_UPSTREAM_SERVICE =
  'https://esri.ciren.cl/server/rest/services/IDEMINAGRI/PROPIEDADES_RURALES/MapServer';
export const PROPIEDADES_RURALES_PROXY_SERVICE_NAME = 'CIREN · PROPIEDADES_RURALES · ArcGIS MapServer';
export type PropiedadesRuralesProxyOperation = 'export' | 'identify' | 'search' | 'feature';

export function propiedadesRuralesProxyError(
  req: Request,
  status: number,
  code: string,
  operation: PropiedadesRuralesProxyOperation,
) {
  return proxyErrorResponse(req, status, {
    code,
    message: code === 'INVALID_REQUEST'
      ? 'Los parámetros de la consulta de propiedades rurales no son válidos.'
      : 'El servicio oficial de propiedades rurales CIREN no está disponible temporalmente.',
    service: PROPIEDADES_RURALES_PROXY_SERVICE_NAME,
    operation,
  });
}

/** Extent inside continental Chile and at most 2° on each side. */
export function ruralExtent(values: number[]): boolean {
  if (!validGeographicExtent(values)) return false;
  const [west, south, east, north] = values;
  return east - west <= 2 && north - south <= 2 && west >= -76 && east <= -66 && south >= -57 && north <= -17;
}
