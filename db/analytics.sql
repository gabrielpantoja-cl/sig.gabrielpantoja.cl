-- Analítica interna del SIG de suelo (ver src/lib/analytics-events.ts).
--
-- Correr UNA vez, como el owner de la base (no como web_readonly), desde la
-- consola SQL de Neon. Es idempotente: se puede repetir sin romper nada.
--
-- Aislamiento: todo vive en el esquema `analytics`, separado de `public`.
-- El rol de la web (`web_readonly`) NO recibe ningún permiso aquí, y el rol
-- nuevo `analytics_writer` no puede leer las transacciones CBR.
--
-- Después de correrlo:
--   1. ALTER ROLE analytics_writer PASSWORD '<una clave larga>';
--   2. ANALYTICS_DATABASE_URL=postgresql://analytics_writer:<clave>@<host>/<db>?sslmode=require
--      en .env.local y en Vercel (Production + Preview).
--   3. ANALYTICS_SALT=<cadena aleatoria de 32+ caracteres> en los mismos lugares.

CREATE SCHEMA IF NOT EXISTS analytics;
REVOKE ALL ON SCHEMA analytics FROM PUBLIC;

CREATE TABLE IF NOT EXISTS analytics.events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  env           text        NOT NULL,           -- production | preview | development
  build         text,                           -- BUILD_ID (SHA del commit)
  event         text        NOT NULL,
  visitor_id    text,                           -- HMAC diario de IP+UA; rota cada día UTC
  session_id    text        NOT NULL,           -- aleatorio por carga de pestaña, sin cookie
  path          text,
  referrer_host text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  country       text,                           -- cabeceras geo de Vercel
  region        text,
  city          text,
  device        text,                           -- desktop | mobile | tablet | ...
  browser       text,
  os            text,
  viewport_w    integer,
  props         jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS events_created_at_idx ON analytics.events (created_at);
CREATE INDEX IF NOT EXISTS events_event_created_idx ON analytics.events (event, created_at);

-- Resumen diario: visitantes únicos (por día), sesiones, páginas vistas.
CREATE OR REPLACE VIEW analytics.daily AS
SELECT
  (created_at AT TIME ZONE 'America/Santiago')::date AS dia,
  count(DISTINCT visitor_id)                          AS visitantes,
  count(DISTINCT session_id)                          AS sesiones,
  count(*) FILTER (WHERE event = 'pageview')          AS paginas_vistas
FROM analytics.events
WHERE env = 'production'
  AND event NOT LIKE 'api\_%'  -- las consultas a la API van en analytics.api_access
GROUP BY 1;

-- Uso de funciones: cuántas sesiones distintas tocan cada cosa.
CREATE OR REPLACE VIEW analytics.features AS
SELECT
  event,
  COALESCE(props->>'layer', props->>'format', props->>'basemap', '') AS detalle,
  count(*)                    AS eventos,
  count(DISTINCT session_id)  AS sesiones,
  min(created_at)             AS primero,
  max(created_at)             AS ultimo
FROM analytics.events
WHERE env = 'production'
  AND event NOT IN ('pageview', 'leave', 'boot')
  AND event NOT LIKE 'api\_%'
GROUP BY 1, 2;

-- Consultas a la API de datos, registradas por src/proxy.ts (también las que
-- no vienen del navegador). source = site | external; client = primer token
-- del user agent (curl/…, python-requests/…, Mozilla/5.0).
CREATE OR REPLACE VIEW analytics.api_access AS
SELECT
  (created_at AT TIME ZONE 'America/Santiago')::date AS dia,
  event,
  props->>'source'            AS source,
  props->>'client'            AS client,
  (props->>'bot')::boolean    AS bot,
  props->>'format'            AS format,
  country,
  count(*)                    AS consultas,
  count(DISTINCT visitor_id)  AS visitantes
FROM analytics.events
WHERE env = 'production'
  AND event LIKE 'api\_%'
GROUP BY 1, 2, 3, 4, 5, 6, 7;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'analytics_writer') THEN
    CREATE ROLE analytics_writer LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA analytics TO analytics_writer;
-- INSERT para registrar, SELECT para el reporte, DELETE para la purga de
-- retención (filas de más de 13 meses). Nada de UPDATE ni DDL.
GRANT INSERT, SELECT, DELETE ON analytics.events TO analytics_writer;
GRANT SELECT ON analytics.daily, analytics.features, analytics.api_access TO analytics_writer;
