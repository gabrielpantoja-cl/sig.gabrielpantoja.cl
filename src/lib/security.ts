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
  const hits = new Map<string, number[]>();
  return (req) => {
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) return true;
    recent.push(now);
    if (hits.size >= MAX_TRACKED_KEYS) {
      for (const [key, times] of hits) {
        if (!times.some((t) => now - t < windowMs)) hits.delete(key);
      }
    }
    hits.set(ip, recent);
    return false;
  };
}

const rateLimited = createRateLimiter(RATE_LIMIT_WINDOW, MAX_REQUESTS_PER_WINDOW);

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
  if (rateLimited(req)) {
    return Response.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers },
    );
  }
  return null;
}
