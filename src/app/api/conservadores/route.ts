import { enforce, corsHeaders } from '@/lib/security';
import { getSql } from '@/lib/neon';
import { normalizeConservadorRow } from '@/lib/conservadores';
import type { Conservador } from '@/lib/types';

/**
 * GET /api/conservadores — oficinas de los Conservadores de Bienes Raíces con
 * su ubicación física y la jurisdicción (nombres + CUT DPA 2023) que atienden.
 *
 * Solo las oficinas ya ubicadas: las de lat/lng NULL se completan con el
 * tiempo y mientras tanto no se dibujan (el filtro también excluye la fila
 * legacy `copiapo-cbr`). Son datos institucionales que cambian poco, de ahí
 * la caché larga en la CDN.
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
    const rows = (await sql.query(
      `SELECT id, nombre, direccion, comuna, region, telefono, email, "sitioWeb",
              jurisdiccion, jurisdiccion_cut, lat, lng
       FROM conservadores
       WHERE lat IS NOT NULL AND lng IS NOT NULL
       ORDER BY nombre`,
    )) as Record<string, unknown>[];

    const conservadores = rows
      .map(normalizeConservadorRow)
      .filter((c): c is Conservador => c !== null);

    return Response.json(conservadores, {
      headers: {
        ...headers,
        'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (error) {
    console.error('Error fetching conservadores:', error);
    return Response.json(
      { error: 'Failed to fetch conservadores' },
      { status: 500, headers },
    );
  }
}
