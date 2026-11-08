import 'server-only';
import { proxyErrorResponse } from '@/lib/arcgis-proxy';
import { SII_PREDIOS_SERVICE_NAME } from '@/lib/sii-predios';

export type SiiPrediosProxyOperation = 'export';

export function siiPrediosProxyError(
  req: Request,
  status: number,
  code: string,
  operation: SiiPrediosProxyOperation,
) {
  return proxyErrorResponse(req, status, {
    code,
    message:
      code === 'INVALID_REQUEST'
        ? 'Los parámetros de la consulta de predios SII no son válidos.'
        : 'El servicio de deslindes prediales del SII no está disponible temporalmente.',
    service: SII_PREDIOS_SERVICE_NAME,
    operation,
  });
}
