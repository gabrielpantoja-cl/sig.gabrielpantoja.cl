import {
  ANALYTICS_OPT_OUT_COOKIE,
  type AnalyticsClientEvent,
  type AnalyticsPayload,
  type AnalyticsProps,
} from '@/lib/analytics-events';

/**
 * Cliente de la analítica interna: `track('layer_on', { layer: 'suelos' })`.
 *
 * Envía por `navigator.sendBeacon` (sobrevive al cierre de la pestaña y no
 * bloquea nada) a `POST /api/analytics`. Sin cookies de seguimiento: la
 * sesión es un id aleatorio en memoria. Si el navegador pide no ser rastreado
 * (DNT / GPC) o tiene la cookie de exclusión (`?analytics=off`), no se envía
 * nada. Reglas completas en `analytics-events.ts`.
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

const OPT_OUT_MAX_AGE = 60 * 60 * 24 * 365 * 5; // 5 años

/** Lee `?analytics=off|on` y pone o borra la cookie de exclusión. */
export function applyOptOutParam(params: URLSearchParams): void {
  const value = params.get('analytics');
  if (value === 'off') {
    document.cookie = `${ANALYTICS_OPT_OUT_COOKIE}=1; Max-Age=${OPT_OUT_MAX_AGE}; Path=/; SameSite=Lax; Secure`;
  } else if (value === 'on') {
    document.cookie = `${ANALYTICS_OPT_OUT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
  }
}

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return true;
  return document.cookie.split('; ').some((c) => c === `${ANALYTICS_OPT_OUT_COOKIE}=1`);
}

export function track(event: AnalyticsClientEvent, props?: AnalyticsProps, extra?: Pick<AnalyticsPayload, 'r'>): void {
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
