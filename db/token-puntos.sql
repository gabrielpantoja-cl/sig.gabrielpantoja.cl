-- token-puntos.sql — huella del conjunto, igual que /api/dataset
-- (src/lib/dataset.ts `datasetToken`): `<filas georreferenciadas>.<ms de la
-- marca más reciente entre updatedAt y createdAt>`. Da nombre al archivo de
-- puntos publicado. Salida: una línea, p. ej. `215402.1794256128105`.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

SELECT count(*)::text || '.' ||
       COALESCE(
         floor(extract(epoch FROM GREATEST(max("updatedAt"), max("createdAt"))) * 1000)::bigint,
         0
       )::text
FROM referenciales
WHERE lat IS NOT NULL AND lng IS NOT NULL;
