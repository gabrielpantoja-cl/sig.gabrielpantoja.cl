import { neon } from '@neondatabase/serverless';

/**
 * Read-only client for the Neon database that holds the CBR land
 * transactions (~85k rows). Uses the dedicated `web_readonly` role (SELECT
 * only); the connection string lives in NEON_DATABASE_URL (server-side only,
 * never exposed with a NEXT_PUBLIC_/VITE_ prefix).
 */
export function getSql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error('NEON_DATABASE_URL is not configured');
  }
  return neon(url);
}
