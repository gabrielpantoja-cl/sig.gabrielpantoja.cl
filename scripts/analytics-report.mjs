#!/usr/bin/env node
/**
 * Reporte de la analítica interna (esquema en db/analytics.sql).
 *
 *   npm run analytics:report            # últimos 30 días
 *   npm run analytics:report -- 7       # últimos 7 días
 *
 * Lee ANALYTICS_REPORT_DATABASE_URL (o, en su defecto, ANALYTICS_DATABASE_URL)
 * del entorno o de .env.local (rol analytics_writer). Solo cuenta eventos de
 * producción. En .env.local usa la variable propia del reporte: con
 * ANALYTICS_DATABASE_URL ahí, `npm run dev` también escribiría eventos.
 */
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const KEYS = ['ANALYTICS_REPORT_DATABASE_URL', 'ANALYTICS_DATABASE_URL'];

function loadEnv() {
  if (KEYS.some((k) => process.env[k])) return;
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(ANALYTICS_REPORT_DATABASE_URL|ANALYTICS_DATABASE_URL)\s*=\s*(.+?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // sin .env.local
  }
}

loadEnv();
const url = process.env.ANALYTICS_REPORT_DATABASE_URL || process.env.ANALYTICS_DATABASE_URL;
if (!url) {
  console.error('Falta ANALYTICS_REPORT_DATABASE_URL (en .env.local o en el entorno).');
  process.exit(1);
}

const days = Math.max(1, Math.min(395, Number(process.argv[2]) || 30));
const sql = neon(url);
const since = sql`now() - make_interval(days => ${days})`;
// Eventos de navegador; las consultas a la API (api_*, de src/proxy.ts) van en su sección.
const base = (extra) => sql`FROM analytics.events WHERE env = 'production' AND created_at >= ${since} AND left(event, 4) <> 'api_' ${extra ?? sql``}`;
const apiBase = sql`FROM analytics.events WHERE env = 'production' AND created_at >= ${since} AND left(event, 4) = 'api_'`;

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

section('API de datos: quién consulta (site = desde el mapa, external = fuera del navegador del sitio)', await sql`
  SELECT event AS endpoint, props->>'source' AS origen, props->>'client' AS cliente,
         props->>'format' AS formato, country AS pais,
         count(*) AS consultas, count(DISTINCT visitor_id) AS visitantes_dia,
         max(created_at) AS ultima
  ${apiBase} GROUP BY 1, 2, 3, 4, 5 ORDER BY consultas DESC LIMIT 30`);
