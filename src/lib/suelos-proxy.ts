import 'server-only';
import { proxyErrorResponse } from '@/lib/arcgis-proxy';

export const SUELOS_UPSTREAM_SERVICE =
  'https://esri.ciren.cl/server/rest/services/ESTUDIO_AGROLOGICO_SUELOS/MapServer';

export const SUELOS_PROXY_SERVICE_NAME =
  'CIREN · ESTUDIO_AGROLOGICO_SUELOS · ArcGIS MapServer';

export type SuelosProxyOperation = 'export' | 'identify';

export function suelosProxyError(
  req: Request,
  status: number,
  code: string,
  operation: SuelosProxyOperation,
) {
  return proxyErrorResponse(req, status, {
    code,
    message: code === 'INVALID_REQUEST'
      ? 'Los parámetros de la consulta de suelos no son válidos.'
      : 'El servicio oficial de suelos CIREN no está disponible temporalmente.',
    service: SUELOS_PROXY_SERVICE_NAME,
    operation,
  });
}
