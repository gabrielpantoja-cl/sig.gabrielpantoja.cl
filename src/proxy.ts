import type { NextFetchEvent, NextRequest } from 'next/server';
import { analyticsRateLimited } from '@/lib/security';
import { analyticsEnabled, optedOut, recordApiEvent } from '@/lib/analytics-server';
import type { AnalyticsServerEvent } from '@/lib/analytics-events';

/**
 * Registro server-side de las consultas a la API de datos.
 *
 * Vive en el proxy (no en las rutas) porque `/api/points` se sirve con
 * `s-maxage`: un acierto de caché de la CDN nunca invoca la ruta, pero el
 * proxy corre antes de la caché, en cada petición. No toca la respuesta —
 * la petición sigue su curso — y la escritura va en `waitUntil`.
 *
 * Cuenta también lo que no pasa por el navegador (curl, scripts), que la
 * analítica de cliente no puede ver. Diseño en `lib/analytics-server.ts`.
 */

const EVENTS: Record<string, AnalyticsServerEvent> = {
  '/api/points': 'api_points',
  '/api/export': 'api_export',
};

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const name = EVENTS[request.nextUrl.pathname];
  if (!name || request.method !== 'GET') return;
  if (!analyticsEnabled() || optedOut(request) || analyticsRateLimited(request)) return;

  event.waitUntil(
    recordApiEvent(request, name).catch((err) => {
      console.error('[analytics] api insert failed:', err instanceof Error ? err.message : err);
    }),
  );
}

export const config = {
  matcher: ['/api/points', '/api/export'],
};
