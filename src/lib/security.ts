/**
 * Security helpers for the public read-only API.
 *
 * Origin allowlist (in production), in-memory best-effort rate limiting, and
 * defensive headers. The API is read-only (SELECT via web_readonly), so this
 * is about reducing abuse, not protecting writes.
 */

const ALLOWED_ORIGINS = [
  'https://sig.gabrielpantoja.cl',
  'https://gabrielpantoja.cl',
  'https://www.gabrielpantoja.cl',
];

// In-memory rate limiting. Resets on cold start and is per-instance, so it is
// best-effort only — combined with the origin allowlist it still cuts the abuse
// surface meaningfully.
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60;

/** Above this many tracked IPs, a call sweeps out the ones with no recent hit. */
const MAX_TRACKED_KEYS = 5_000;

/**
 * Sliding-window limiter keyed by client IP. Each route that needs its own
 * budget creates one; the sweep keeps a warm instance (Fluid compute) from
 * accumulating one entry per IP it has ever seen.
 */
export function createRateLimiter(windowMs: number, max: number): (req: Request) => boolean {
  const waitMs = createRateLimiterWithRetry(windowMs, max);
  return (req) => waitMs(req) > 0;
}

/**
 * Same sliding window, but instead of a yes/no it answers how long the client
 * must wait: `0` = allowed (and counted), otherwise the milliseconds until the
 * oldest hit leaves the window. That is what goes into `Retry-After`, so the
 * map can retry by itself instead of showing an outage.
 */
export function createRateLimiterWithRetry(windowMs: number, max: number): (req: Request) => number {
  const hits = new Map<string, number[]>();
  return (req) => {
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return Math.max(1, recent[0] + windowMs - now);
    recent.push(now);
    if (hits.size >= MAX_TRACKED_KEYS) {
      for (const [key, times] of hits) {
        if (!times.some((t) => now - t < windowMs)) hits.delete(key);
      }
    }
    hits.set(ip, recent);
    return 0;
  };
}

const rateLimitWait = createRateLimiterWithRetry(RATE_LIMIT_WINDOW, MAX_REQUESTS_PER_WINDOW);

/** Service name of the rate-limit error: it is OUR limit, never an agency's. */
export const RATE_LIMIT_SERVICE = 'sig.gabrielpantoja.cl';

/**
 * 429 in the shared error contract `{ error: { code, message, service,
 * operation } }`, with `Retry-After` in whole seconds. The map reads both:
 * `code: RATE_LIMITED` keeps it from blaming CIREN/MMA/CONAF, and the header
 * tells it when to retry on its own.
 */
export function rateLimitResponse(req: Request, waitMs: number, message?: string): Response {
  return Response.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: message ?? 'Too many requests in a short time. Retry after the indicated seconds.',
        service: RATE_LIMIT_SERVICE,
        operation: 'rate-limit',
      },
    },
    {
      status: 429,
      headers: {
        ...corsHeaders(req),
        'Retry-After': String(Math.max(1, Math.ceil(waitMs / 1000))),
        'Cache-Control': 'no-store',
        Vary: 'Origin',
      },
    },
  );
}

function isProd(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

/**
 * `methods` is what the route accepts; it only matters on the preflight
 * (OPTIONS) answer, so routes that take POST pass it there.
 */
export function corsHeaders(req: Request, methods = 'GET, OPTIONS'): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : isProd()
      ? 'https://sig.gabrielpantoja.cl'
      : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

// Bucket separado para la analítica: un usuario activo genera varios eventos
// por minuto y no deben gastar el presupuesto de las consultas al mapa.
const MAX_ANALYTICS_PER_WINDOW = 120;
export const analyticsRateLimited = createRateLimiter(RATE_LIMIT_WINDOW, MAX_ANALYTICS_PER_WINDOW);

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') || '';
  return !isProd() || ALLOWED_ORIGINS.includes(origin);
}

export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : 'unknown';
}

/**
 * Returns a Response to short-circuit the request (403/429), or null to proceed.
 * Apply at the top of every GET handler.
 */
export function enforce(req: Request): Response | null {
  const headers = corsHeaders(req);
  const origin = req.headers.get('origin') || '';

  if (isProd() && origin && !ALLOWED_ORIGINS.includes(origin)) {
    return Response.json({ error: 'Forbidden' }, { status: 403, headers });
  }
  const waitMs = rateLimitWait(req);
  if (waitMs > 0) return rateLimitResponse(req, waitMs);
  return null;
}
