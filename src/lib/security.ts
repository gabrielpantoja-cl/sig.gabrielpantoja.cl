/**
 * Security helpers for the public read-only API.
 *
 * Mirrors the hardening of the original gabrielpantoja.cl/api/mapa-cbr.js:
 * origin allowlist (in production), in-memory best-effort rate limiting, and
 * defensive headers. The API is read-only (SELECT via web_readonly), so this is
 * about reducing abuse, not protecting writes.
 */

const ALLOWED_ORIGINS = [
  'https://sig.gabrielpantoja.cl',
  'https://gabrielpantoja.cl',
  'https://www.gabrielpantoja.cl',
];

// In-memory rate limiting. Resets on cold start and is per-instance, so it is
// best-effort only — combined with the origin allowlist it still cuts the abuse
// surface meaningfully.
const requestCounts = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 60;

function isProd(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin)
    ? origin
    : isProd()
      ? 'https://sig.gabrielpantoja.cl'
      : '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return xff ? xff.split(',')[0].trim() : 'unknown';
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestCounts.get(ip) || []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW,
  );
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) return true;
  recent.push(now);
  requestCounts.set(ip, recent);
  return false;
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
  if (rateLimited(clientIp(req))) {
    return Response.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers },
    );
  }
  return null;
}
