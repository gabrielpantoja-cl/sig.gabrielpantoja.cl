#!/usr/bin/env node
/**
 * Reporte de la analítica interna (esquema en db/analytics.sql).
 *
 *   npm run analytics:report            # últimos 30 días
 *   npm run analytics:report -- 7       # últimos 7 días
 *
 * Lee ANALYTICS_DATABASE_URL de .env.local (rol analytics_writer). Solo
 * cuenta eventos de producción.
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function loadEnv() {
  if (process.env.ANALYTICS_DATABASE_URL) return;
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*ANALYTICS_DATABASE_URL\s*=\s*(.+?)\s*$/);
      if (m) process.env.ANALYTICS_DATABASE_URL = m[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // sin .env.local
  }
}

loadEnv();
const url = process.env.ANALYTICS_DATABASE_URL;
if (!url) {
  console.error('Falta ANALYTICS_DATABASE_URL (en .env.local o en el entorno).');
  process.exit(1);
}

const days = Math.max(1, Math.min(395, Number(process.argv[2]) || 30));
const sql = neon(url);
const since = sql`now() - make_interval(days => ${days})`;
const base = (extra) => sql`FROM analytics.events WHERE env = 'production' AND created_at >= ${since} ${extra ?? sql``}`;

const section = (title, rows) => {
  console.log(`\n== ${title} ==`);
  if (rows.length) console.table(rows);
  else console.log('(sin datos)');
};

const [totals] = await sql`
  SELECT count(*) FILTER (WHERE event = 'pageview') AS paginas_vistas,
         count(DISTINCT session_id)                  AS sesiones,
         count(DISTINCT (visitor_id, (created_at AT TIME ZONE 'America/Santiago')::date))
                                                     AS visitantes_dia
  ${base()}`;
console.log(`Analítica interna — últimos ${days} días (producción)`);
console.table([totals]);

section('Por día', await sql`
  SELECT dia, visitantes, sesiones, paginas_vistas FROM analytics.daily
  WHERE dia >= (now() AT TIME ZONE 'America/Santiago')::date - ${days}::int
  ORDER BY dia DESC`);

section('Ubicación (sesiones)', await sql`
  SELECT country AS pais, region, city AS ciudad, count(DISTINCT session_id) AS sesiones
  ${base()} GROUP BY 1, 2, 3 ORDER BY sesiones DESC LIMIT 20`);

section('Dispositivo', await sql`
  SELECT device AS dispositivo, os, browser AS navegador, count(DISTINCT session_id) AS sesiones
  ${base()} GROUP BY 1, 2, 3 ORDER BY sesiones DESC LIMIT 15`);

section('Origen del tráfico', await sql`
  SELECT COALESCE(utm_source, referrer_host, '(directo)') AS origen, count(*) AS visitas
  ${base(sql`AND event = 'pageview'`)} GROUP BY 1 ORDER BY visitas DESC LIMIT 15`);

section('Uso de funciones', await sql`
  SELECT event AS evento,
         COALESCE(props->>'layer', props->>'format', props->>'basemap', props->>'fields', '') AS detalle,
         count(*) AS eventos, count(DISTINCT session_id) AS sesiones
  ${base(sql`AND event NOT IN ('pageview', 'leave', 'boot')`)}
  GROUP BY 1, 2 ORDER BY sesiones DESC LIMIT 40`);

section('Rendimiento de carga (ms hasta el mapa listo)', await sql`
  SELECT device AS dispositivo, count(*) AS n,
         round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY (props->>'ms')::numeric)) AS p50,
         round(percentile_cont(0.9)  WITHIN GROUP (ORDER BY (props->>'ms')::numeric)) AS p90
  ${base(sql`AND event = 'boot'`)} GROUP BY 1 ORDER BY n DESC`);

section('Tiempo activo por sesión (s)', await sql`
  WITH s AS (
    SELECT session_id, max((props->>'active_s')::numeric) AS activo
    ${base(sql`AND event = 'leave'`)} GROUP BY 1
  )
  SELECT count(*) AS sesiones,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY activo)) AS p50,
         round(percentile_cont(0.9) WITHIN GROUP (ORDER BY activo)) AS p90,
         count(*) FILTER (WHERE activo < 10) AS rebote_menos_10s
  FROM s`);
