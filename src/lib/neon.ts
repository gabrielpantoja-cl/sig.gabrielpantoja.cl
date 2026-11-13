import 'server-only';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';

/**
 * Read-only access to the CBR land transactions.
 *
 * Primary: Neon, role `web_readonly` (SELECT only), `NEON_DATABASE_URL`.
 *
 * Fallback: `FALLBACK_DATABASE_URL`, a read-only role on the daily restored
 * copy of the same tables (identical columns, at most ~1 day behind). Used
 * when a Neon query fails — above all when Neon blocks the project for
 * exhausting its monthly network-transfer quota, which took the whole map
 * down on 2026-11-13. The role's `search_path` points at the copy's schema, so
 * every route runs its SQL unchanged. Tables only the primary has (the
 * `capas.*` of the ficha del predio) still fail while on the fallback.
 *
 * After a Neon failure the instance skips Neon for `NEON_COOLDOWN_MS`, so an
 * exhausted quota does not add a failing round-trip to every request; then it
 * tries Neon again and recovers on its own when the quota resets.
 *
 * Both URLs are server-side only, never `NEXT_PUBLIC_`.
 */
export interface ReadOnlySql {
  query(text: string, params?: unknown[]): Promise<unknown[]>;
}

const NEON_COOLDOWN_MS = 5 * 60_000;
let neonDownUntil = 0;

let fallbackClient: ReturnType<typeof postgres> | null = null;
let fallbackUrl: string | null = null;

function getFallback(url: string) {
  if (!fallbackClient || fallbackUrl !== url) {
    fallbackUrl = url;
    fallbackClient = postgres(url, {
      // Transaction pooler: no prepared statements, few connections per
      // serverless instance.
      prepare: false,
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return fallbackClient;
}

async function queryFallback(url: string, text: string, params: unknown[]) {
  const rows = await getFallback(url).unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  return Array.from(rows) as unknown[];
}

export function getSql(): ReadOnlySql {
  const primary = process.env.NEON_DATABASE_URL;
  const fallback = process.env.FALLBACK_DATABASE_URL;
  if (!primary && !fallback) {
    throw new Error('NEON_DATABASE_URL is not configured');
  }

  return {
    async query(text, params = []) {
      if (primary && (!fallback || Date.now() >= neonDownUntil)) {
        try {
          return (await neon(primary).query(text, params)) as unknown[];
        } catch (err) {
          if (!fallback) throw err;
          neonDownUntil = Date.now() + NEON_COOLDOWN_MS;
          // Only the error class/message: never the query params or rows.
          console.warn(
            '[db] Neon failed, using fallback for 5 min:',
            err instanceof Error ? err.message.slice(0, 200) : 'unknown error',
          );
        }
      }
      return queryFallback(fallback as string, text, params);
    },
  };
}
