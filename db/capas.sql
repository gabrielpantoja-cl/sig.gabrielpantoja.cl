-- Capas oficiales en PostGIS para los geoprocesos (ficha del predio).
--
-- Correr UNA vez, como el owner de la base (no como web_readonly), desde la
-- consola SQL de Neon. Es idempotente. Conviene probarlo primero en una rama
-- de Neon y recién después en la principal.
--
-- Las tablas NO se crean aquí: las crea `npm run data:load:postgis` con el rol
-- `etl_writer`, que carga cada capa en una tabla de staging y la intercambia
-- con la vigente en una sola transacción (la API nunca ve una tabla a medio
-- cargar). Este archivo solo prepara el esquema y los permisos.
--
-- Aislamiento: `etl_writer` solo puede crear y escribir en `capas`; no ve las
-- transacciones CBR ni la analítica. `web_readonly` recibe SELECT sobre lo que
-- `etl_writer` cree, nada más.
--
-- Después de correrlo:
--   1. ALTER ROLE etl_writer PASSWORD '<una clave larga>';
--   2. ETL_DATABASE_URL=postgresql://etl_writer:<clave>@<host>/<db>?sslmode=require
--      SOLO en .env.local de la máquina que corre el ETL. Nunca en Vercel: la
--      web no escribe capas.

-- Las funciones SQL de PostGIS quedaron en 3.3.3 mientras la librería ya es
-- 3.3.x posterior (`SELECT postgis_full_version();` lo advierte). Alinearlas
-- evita sorpresas en ST_MakeValid / ST_Intersection.
ALTER EXTENSION postgis UPDATE;

CREATE SCHEMA IF NOT EXISTS capas;
REVOKE ALL ON SCHEMA capas FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'etl_writer') THEN
    CREATE ROLE etl_writer LOGIN;
  END IF;
END
$$;

GRANT USAGE, CREATE ON SCHEMA capas TO etl_writer;
GRANT USAGE ON SCHEMA capas TO web_readonly;
-- El SELECT sobre cada tabla lo concede el propio cargador (dueño de la tabla)
-- al crearla: ALTER DEFAULT PRIVILEGES FOR ROLE exige ser miembro del rol, y
-- en PostgreSQL 16 crear un rol no te hace miembro de él.

-- Si la consulta del ETL tarda, que falle en vez de colgar la conexión.
ALTER ROLE etl_writer SET statement_timeout = '5min';
