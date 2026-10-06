import {
  PROPIEDADES_RURALES_SERVICE_NAME,
  type PropiedadesRuralesOperation,
  type PropiedadesRuralesProxyErrorBody,
} from '@/lib/propiedades-rurales';
import {
  SUELOS_SERVICE_NAME,
  type SuelosOperation,
  type SuelosProxyErrorBody,
} from '@/lib/suelos';

/** Helpers compartidos por las capas raster por viewport (`use*Layer`). */

export async function suelosFailureDetails(
  response: Response,
  fallbackOperation: SuelosOperation,
): Promise<{ service: string; operation: SuelosOperation }> {
  try {
    const body = (await response.json()) as SuelosProxyErrorBody;
    const operation = body.error?.operation === 'identify' || body.error?.operation === 'export'
      ? body.error.operation
      : fallbackOperation;
    return {
      service: body.error?.service === SUELOS_SERVICE_NAME
        ? body.error.service
        : SUELOS_SERVICE_NAME,
      operation,
    };
  } catch {
    return { service: SUELOS_SERVICE_NAME, operation: fallbackOperation };
  }
}

export async function ruralFailureDetails(response: Response, fallbackOperation: PropiedadesRuralesOperation): Promise<{ service: string; operation: PropiedadesRuralesOperation }> {
  try {
    const body = await response.json() as PropiedadesRuralesProxyErrorBody;
    const operation = body.error?.operation === 'identify' || body.error?.operation === 'export' ? body.error.operation : fallbackOperation;
    return { service: body.error?.service === PROPIEDADES_RURALES_SERVICE_NAME ? body.error.service : PROPIEDADES_RURALES_SERVICE_NAME, operation };
  } catch { return { service: PROPIEDADES_RURALES_SERVICE_NAME, operation: fallbackOperation }; }
}

export function waitForImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Invalid soils image'));
    image.src = url;
  });
}
