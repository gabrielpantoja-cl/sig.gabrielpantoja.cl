import { after } from 'next/server';
import { analyticsRateLimited, corsHeaders, isAllowedOrigin } from '@/lib/security';
import {
  analyticsEnabled,
  isBot,
  optedOut,
  parsePayload,
  recordEvent,
} from '@/lib/analytics-server';

/**
 * POST /api/analytics — recibe un evento de uso del cliente
 * (`lib/analytics.ts`, vía `navigator.sendBeacon`) y lo registra en
 * `analytics.events`. Diseño de privacidad en `lib/analytics-events.ts`.
 *
 * Responde SIEMPRE 204 y rápido: el beacon no lee la respuesta, y un error
 * aquí no puede afectar el mapa. La escritura en Neon va en `after()`, ya
 * enviada la respuesta. Descarta en silencio: origen ajeno, bots, DNT/GPC,
 * exceso de eventos por IP, cuerpos inválidos o analítica sin configurar.
 *
 * El cuerpo llega como text/plain (lo que manda sendBeacon con un string)
 * para no disparar un preflight CORS; por eso se parsea a mano.
 */

export const dynamic = 'force-dynamic';

const MAX_BODY = 4096;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  const headers = { ...corsHeaders(req), 'Cache-Control': 'no-store' };
  const done = () => new Response(null, { status: 204, headers });

  if (!analyticsEnabled() || !isAllowedOrigin(req) || optedOut(req) || isBot(req)) {
    return done();
  }
  if (analyticsRateLimited(req)) return done();

  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return done();
    raw = JSON.parse(text);
  } catch {
    return done();
  }
  const payload = parsePayload(raw);
  if (!payload) return done();

  after(async () => {
    try {
      await recordEvent(req, payload);
    } catch (err) {
      // Nunca rompe la respuesta; queda en los logs de Vercel para diagnosticar.
      console.error('[analytics] insert failed:', err instanceof Error ? err.message : err);
    }
  });

  return done();
}
