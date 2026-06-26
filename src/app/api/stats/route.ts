import { enforce, corsHeaders } from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';

/**
 * GET /api/stats — descriptive statistics over the same filtered set as
 * /api/points. Lightweight panel for peritos (count, avg, median, min/max,
 * price per m²) — the Recharts/PDF version is a later iteration.
 */

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
         avg(monto)::float8 AS avg,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY monto)::float8 AS mediana,
         min(monto)::float8 AS min,
         max(monto)::float8 AS max,
         avg(monto / NULLIF("superficieTerreno", 0))::float8 AS precio_m2
       FROM referenciales
       WHERE ${where}`,
      params,
    )) as Record<string, unknown>[];

    const r = rows[0] ?? {};
    const stats = {
      count: Number(r.count ?? 0),
      avg: r.avg != null ? Number(r.avg) : null,
      mediana: r.mediana != null ? Number(r.mediana) : null,
      min: r.min != null ? Number(r.min) : null,
      max: r.max != null ? Number(r.max) : null,
      precio_m2: r.precio_m2 != null ? Number(r.precio_m2) : null,
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
