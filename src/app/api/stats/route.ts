import { enforce, corsHeaders } from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';

/**
 * GET /api/stats — descriptive statistics over the same filtered set as
 * /api/points. Lightweight panel for peritos (count, avg, median, min/max,
 * price per m²) — the Recharts/PDF version is a later iteration.
 *
 * Tres denominadores distintos conviven en esta respuesta y por eso se
 * devuelven explícitos (ver docs/estadisticas.md):
 *
 *   count            filas de la selección
 *   count_monto      filas con `monto` informado → base de avg/mediana/min/max
 *   count_precio_m2  filas con `monto` Y `superficieTerreno` > 0 → base del $/m²
 *
 * `avg()` y `percentile_cont()` descartan NULL en silencio, así que sin estos
 * conteos la UI mostraría seis métricas bajo un único N que no les corresponde.
 *
 * Las mismas métricas se calculan en UF (`*_uf`, sobre `"montoUf"`), con sus
 * propios conteos `count_uf` y `count_uf_m2`. La UF es la unidad principal del
 * panel: el 92,7 % de la base trae UF y solo el 79,5 % trae pesos (22.027
 * filas tienen solo UF, casi todo Aysén antes de 2025), y la UF es la que
 * permite comparar años. Nunca se convierte una unidad en la otra.
 */

/** monto/m² de UNA transacción; NULL cuando la fila no puede aportar el dato.
 *  El CASE evita la división por cero (en float8 Postgres lanza error, no NaN)
 *  y el cast a float8 evita la división entera si ambas columnas son enteras. */
const RATIO_M2 = `CASE WHEN "superficieTerreno" > 0 AND monto IS NOT NULL
                       THEN monto::float8 / "superficieTerreno" END`;

/** Filas que sí pueden aportar un $/m². */
const HAS_M2 = `monto IS NOT NULL AND "superficieTerreno" > 0`;

/** Lo mismo en UF (`montoUf` ya es float8 en Neon). */
const RATIO_UF_M2 = `CASE WHEN "superficieTerreno" > 0 AND "montoUf" IS NOT NULL
                          THEN "montoUf" / "superficieTerreno" END`;
const HAS_UF_M2 = `"montoUf" IS NOT NULL AND "superficieTerreno" > 0`;

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  try {
    const { searchParams } = new URL(req.url);
    const { where, params } = buildFilters(searchParams);
    const sql = getSql();

    const rows = (await sql.query(
      `SELECT
         count(*)::int AS count,
         count(monto)::int AS count_monto,
         count(${RATIO_M2})::int AS count_precio_m2,
         avg(monto)::float8 AS avg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto)::float8 AS mediana,
         min(monto)::float8 AS min,
         max(monto)::float8 AS max,
         -- Razón de totales: sum(monto)/sum(superficie). Pondera cada predio por
         -- su tamaño, a diferencia de avg(monto/superficie), que daba el mismo
         -- peso a un sitio de 5 m² que a un fundo de 200 ha e inflaba el
         -- agregado ~2x. Ambos sumandos usan el MISMO subconjunto de filas.
         ((sum(monto) FILTER (WHERE ${HAS_M2}))::float8
            / NULLIF((sum("superficieTerreno") FILTER (WHERE ${HAS_M2}))::float8, 0)
         ) AS precio_m2,
         -- Mediana de las razones por transacción: el valor "típico", robusto
         -- frente a los outliers de superficie mínima. FILTER además de CASE
         -- para no depender de cómo trata los NULL el agregado ordenado.
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY ${RATIO_M2})
            FILTER (WHERE ${HAS_M2})
         )::float8 AS precio_m2_mediana,
         count("montoUf")::int AS count_uf,
         count(${RATIO_UF_M2})::int AS count_uf_m2,
         avg("montoUf")::float8 AS avg_uf,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY "montoUf")::float8 AS mediana_uf,
         min("montoUf")::float8 AS min_uf,
         max("montoUf")::float8 AS max_uf,
         ((sum("montoUf") FILTER (WHERE ${HAS_UF_M2}))
            / NULLIF((sum("superficieTerreno") FILTER (WHERE ${HAS_UF_M2}))::float8, 0)
         ) AS uf_m2,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY ${RATIO_UF_M2})
            FILTER (WHERE ${HAS_UF_M2})
         )::float8 AS uf_m2_mediana
       FROM referenciales
       WHERE ${where}`,
      params,
    )) as Record<string, unknown>[];

    const r = rows[0] ?? {};
    const num = (v: unknown): number | null => (v != null ? Number(v) : null);
    const stats = {
      count: Number(r.count ?? 0),
      count_monto: Number(r.count_monto ?? 0),
      count_precio_m2: Number(r.count_precio_m2 ?? 0),
      avg: num(r.avg),
      mediana: num(r.mediana),
      min: num(r.min),
      max: num(r.max),
      precio_m2: num(r.precio_m2),
      precio_m2_mediana: num(r.precio_m2_mediana),
      count_uf: Number(r.count_uf ?? 0),
      count_uf_m2: Number(r.count_uf_m2 ?? 0),
      avg_uf: num(r.avg_uf),
      mediana_uf: num(r.mediana_uf),
      min_uf: num(r.min_uf),
      max_uf: num(r.max_uf),
      uf_m2: num(r.uf_m2),
      uf_m2_mediana: num(r.uf_m2_mediana),
    };

    return Response.json(stats, {
      headers: {
        ...headers,
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return Response.json(
      { error: 'Failed to fetch stats' },
      { status: 500, headers },
    );
  }
}
