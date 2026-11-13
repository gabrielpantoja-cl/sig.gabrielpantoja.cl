-- exportar-puntos.sql — el conjunto completo de /api/points como un solo JSON.
--
-- Lo corre scripts/publicar-puntos.sh sobre la copia restaurada del respaldo
-- (no sobre la base principal ni sobre la base de respaldo en línea): así la
-- carga del mapa sin filtros sale de un archivo estático y no gasta cuota de
-- transferencia de ninguna base.
--
-- CONTRATO: misma forma, mismas columnas y mismo orden que /api/points sin
-- filtros (src/app/api/points/route.ts, `MapPoint` en src/lib/types.ts). Si se
-- cambia una, se cambian las dos. NUNCA comprador, vendedor, rut, user_id ni
-- observaciones (Ley 19.628): cada columna se nombra explícitamente.
--
-- Salida: una sola línea, un arreglo JSON de objetos MapPoint.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

WITH r AS (
  SELECT lat, lng, monto, "montoUf", anio, comuna, predio,
         "superficieTerreno" AS superficie, rol, destino,
         fechaescritura::text AS "fechaEscritura",
         "fechaInscripcion"::text AS "fechaInscripcion",
         fojas, numero, "conservadorId",
         COALESCE(fechaescritura, "fechaInscripcion") AS orden_fecha
  FROM referenciales
  WHERE lat IS NOT NULL AND lng IS NOT NULL
)
SELECT COALESCE(
  json_agg(
    json_build_object(
      'lat', r.lat::float8,
      'lng', r.lng::float8,
      'monto', r.monto::float8,
      'montoUf', r."montoUf"::float8,
      'anio', r.anio::int,
      'comuna', r.comuna,
      'predio', r.predio,
      'superficie', r.superficie::float8,
      'rol', r.rol,
      'destino', r.destino,
      'fechaEscritura', r."fechaEscritura",
      'fechaInscripcion', r."fechaInscripcion",
      'fojas', r.fojas,
      'numero', r.numero::float8,
      'conservador', c.nombre
    )
    ORDER BY r.orden_fecha DESC NULLS LAST, r.anio DESC NULLS LAST
  ),
  '[]'::json
)
FROM r
LEFT JOIN conservadores c ON c.id = r."conservadorId";
