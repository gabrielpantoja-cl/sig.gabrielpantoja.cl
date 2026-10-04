import type { AnalyticsEvent, AnalyticsPayload, AnalyticsProps } from '@/lib/analytics-events';

/**
 * Cliente de la analítica interna: `track('layer_on', { layer: 'suelos' })`.
 *
 * Envía por `navigator.sendBeacon` (sobrevive al cierre de la pestaña y no
 * bloquea nada) a `POST /api/analytics`. Sin cookies ni localStorage: la
 * sesión es un id aleatorio en memoria. Si el navegador pide no ser rastreado
 * (DNT / GPC), no se envía nada. Reglas completas en `analytics-events.ts`.
 */

const ENDPOINT = '/api/analytics';

let sessionId: string | null = null;

function session(): string {
  if (!sessionId) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    sessionId = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
  }
  return sessionId;
}

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
}

export function track(event: AnalyticsEvent, props?: AnalyticsProps, extra?: Pick<AnalyticsPayload, 'r'>): void {
  if (typeof window === 'undefined' || optedOut()) return;
  const payload: AnalyticsPayload = {
    e: event,
    s: session(),
    p: window.location.pathname,
    w: window.innerWidth,
    ...extra,
    ...(props ? { props } : {}),
  };
  const body = JSON.stringify(payload);
  try {
    // String → text/plain: sin preflight CORS.
    if (navigator.sendBeacon?.(ENDPOINT, body)) return;
  } catch {
    // sendBeacon puede lanzar por cuota; cae a fetch.
  }
  fetch(ENDPOINT, { method: 'POST', body, keepalive: true }).catch(() => {});
}
