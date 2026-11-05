import { enforce, corsHeaders } from '@/lib/security';
import { getSql } from '@/lib/neon';
import {
  DATASET_MAX_AGE_S,
  datasetToken,
  type DatasetVersion,
} from '@/lib/dataset';

/**
 * GET /api/dataset — huella del conjunto CBR geolocalizado.
 *
 * Es la pieza que destraba la caché de `/api/points` (~31 MB, `s-maxage=3600`)
 * sin renunciar a ella: el cliente pide esta respuesta de ~80 bytes, la
 * adjunta como `?ds=<token>` al resto de las rutas de datos y, cuando entra
 * una carga nueva, el token cambia y esas rutas pasan solas a una clave de
 * caché nueva. Ver `lib/dataset.ts` para el razonamiento completo.
 *
 * `max("updatedAt")` recorre la tabla (no hay índice por esa columna y
 * `web_readonly` no puede crearlo), ~165 ms en caliente sobre 130k filas. Por
 * eso la respuesta se cachea 30 s en el borde: el costo real es una consulta
 * cada medio minuto por región, no una por pestaña.
 */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** `timestamp without time zone` llega como Date; defensivo ante texto. */
function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  try {
    const sql = getSql();
    // Mismo recorte que `buildFilters` sin filtros: solo lo que el mapa dibuja.
    // Si una carga deja filas sin georreferenciar, el token no se mueve — y es
    // correcto que no se mueva: `/api/points` tampoco las devolvería.
    const rows = (await sql.query(
      `SELECT count(*)::int AS n,
              max("updatedAt") AS updated,
              max("createdAt") AS created
       FROM referenciales
       WHERE lat IS NOT NULL AND lng IS NOT NULL`,
    )) as Record<string, unknown>[];

    const row = rows[0] ?? {};
    const count = Number(row.n ?? 0);
    // Un ETL que inserta sin tocar `updatedAt` deja `createdAt` como única
    // señal; se toma la más reciente de las dos.
    const updatedAt = toIso(row.updated);
    const createdAt = toIso(row.created);
    const updated = !updatedAt ? createdAt
      : !createdAt ? updatedAt
      : (updatedAt > createdAt ? updatedAt : createdAt);

    const body: DatasetVersion = {
      token: datasetToken(count, updated),
      count,
      updated,
    };

    return Response.json(body, {
      headers: {
        ...headers,
        'Cache-Control': `s-maxage=${DATASET_MAX_AGE_S}`,
      },
    });
  } catch (error) {
    console.error('Error fetching dataset version:', error);
    return Response.json(
      { error: 'Failed to fetch dataset version' },
      { status: 500, headers },
    );
  }
}
