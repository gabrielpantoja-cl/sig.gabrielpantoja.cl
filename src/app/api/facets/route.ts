import { enforce, corsHeaders } from '@/lib/security';
import { getSql } from '@/lib/neon';

/**
 * GET /api/facets — values needed to populate the filter UI: the list of
 * comunas, the available ranges for year and monto, and the transaction count
 * per comuna and year (~7 KB) that feeds the year filter. Fetched once on load;
 * cached aggressively at the edge since it changes at most daily.
 */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  try {
    const sql = getSql();

    const comunaRows = (await sql.query(
      `SELECT DISTINCT comuna FROM referenciales
       WHERE comuna IS NOT NULL AND comuna <> ''
       ORDER BY comuna`,
    )) as Record<string, unknown>[];

    const rangeRows = (await sql.query(
      `SELECT
         min(EXTRACT(YEAR FROM COALESCE(fechaescritura, "fechaInscripcion")))::int AS min_anio,
         max(EXTRACT(YEAR FROM COALESCE(fechaescritura, "fechaInscripcion")))::int AS max_anio,
         min(monto)::float8 AS min_monto,
         max(monto)::float8 AS max_monto
       FROM referenciales
       WHERE lat IS NOT NULL AND lng IS NOT NULL`,
    )) as Record<string, unknown>[];

    // Same year expression and same row set as `buildFilters`, so a bar of
    // the histogram and the filtered count agree.
    const yearRows = (await sql.query(
      `SELECT comuna,
         EXTRACT(YEAR FROM COALESCE(fechaescritura, "fechaInscripcion"))::int AS anio,
         count(*)::int AS n
       FROM referenciales
       WHERE lat IS NOT NULL AND lng IS NOT NULL
         AND comuna IS NOT NULL AND comuna <> ''
         AND COALESCE(fechaescritura, "fechaInscripcion") IS NOT NULL
       GROUP BY 1, 2`,
    )) as Record<string, unknown>[];
    const anios: Record<string, Record<string, number>> = {};
    for (const row of yearRows) {
      const comuna = String(row.comuna);
      (anios[comuna] ??= {})[String(row.anio)] = Number(row.n);
    }

    const r = rangeRows[0] ?? {};
    const facets = {
      comunas: comunaRows.map((c) => String(c.comuna)),
      minAnio: Number(r.min_anio ?? 2015),
      maxAnio: Number(r.max_anio ?? new Date().getFullYear()),
      anios,
      minMonto: Number(r.min_monto ?? 0),
      maxMonto: Number(r.max_monto ?? 0),
    };

    return Response.json(facets, {
      headers: {
        ...headers,
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching facets:', error);
    return Response.json(
      { error: 'Failed to fetch facets' },
      { status: 500, headers },
    );
  }
}
