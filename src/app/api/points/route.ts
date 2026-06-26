import { enforce, corsHeaders } from '@/lib/security';
import { buildFilters } from '@/lib/filters';
import { getSql } from '@/lib/neon';

/**
 * GET /api/points — geolocated CBR transactions for the map, filtered server-side.
 *
 * Returns ONLY the privacy-safe slice (lat, lng, monto, anio, comuna, predio,
 * superficie, rol). PII columns (comprador, vendedor, rut, user_id,
 * observaciones) are never selected.
 */

// Upper bound against runaway payloads. The frontend clusters, so it can handle
// the full geolocated dataset (~74k); narrower filters return far fewer rows.
const MAX_POINTS = 120000;

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

    // Filter referenciales inside a CTE (where the unqualified filter columns are
    // unambiguous), then LEFT JOIN conservadores for the human-readable CBR name.
    // Both tables have a `comuna` column, so a direct join would be ambiguous.
    const rows = (await sql.query(
      `WITH r AS (
         SELECT lat, lng, monto, anio, comuna, predio,
                "superficieTerreno" AS superficie, rol, destino,
                fojas, numero, "conservadorId"
         FROM referenciales
         WHERE ${where}
         ORDER BY anio DESC
         LIMIT ${MAX_POINTS}
       )
       SELECT r.lat, r.lng, r.monto, r.anio, r.comuna, r.predio, r.superficie,
              r.rol, r.destino, r.fojas, r.numero, c.nombre AS conservador
       FROM r
       LEFT JOIN conservadores c ON c.id = r."conservadorId"`,
      params,
    )) as Record<string, unknown>[];

    const points = rows.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      monto: r.monto != null ? Number(r.monto) : null,
      anio: r.anio,
      comuna: r.comuna,
      predio: r.predio,
      superficie: r.superficie != null ? Number(r.superficie) : null,
      rol: r.rol,
      destino: r.destino,
      fojas: r.fojas,
      numero: r.numero != null ? Number(r.numero) : null,
      conservador: r.conservador,
    }));

    return Response.json(points, {
      headers: {
        ...headers,
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error fetching points:', error);
    return Response.json(
      { error: 'Failed to fetch points' },
      { status: 500, headers },
    );
  }
}
