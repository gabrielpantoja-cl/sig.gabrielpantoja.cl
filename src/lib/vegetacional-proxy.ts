import 'server-only';
import { corsHeaders } from '@/lib/security';

export const VEGETACIONAL_UPSTREAM_SERVICE =
  'https://esri.ciren.cl/server/rest/services/USOS_DE_LA_TIERRA__CONAF/MapServer';
export const VEGETACIONAL_PROXY_SERVICE_NAME =
  'CONAF · USOS_DE_LA_TIERRA__CONAF · ArcGIS MapServer';
export type VegetacionalProxyOperation = 'export' | 'identify';

export function vegetacionalProxyError(req: Request, status: number, code: string, operation: VegetacionalProxyOperation) {
  const message = code === 'INVALID_REQUEST'
    ? 'Los parámetros de la consulta vegetacional no son válidos.'
    : 'El servicio oficial de recursos vegetacionales no está disponible temporalmente.';
  return Response.json({ error: { code, message, service: VEGETACIONAL_PROXY_SERVICE_NAME, operation } }, {
    status,
    headers: { ...corsHeaders(req), 'Cache-Control': 'no-store', Vary: 'Origin' },
  });
}
