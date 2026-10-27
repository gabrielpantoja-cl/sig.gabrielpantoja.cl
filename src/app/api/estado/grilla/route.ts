import { enforce, corsHeaders } from '@/lib/security';
import { obtenerGrilla } from '@/lib/estado-server';

/**
 * GET /api/estado/grilla — la copia restaurada del respaldo, agrupada en
 * celdas de 0,1° (~10 km): `{ total, celdas: [{ lat, lng, n }] }`. La dibuja
 * el micro visor de `/estado` para ver que la copia trae datos en todo el
 * territorio, no solo un conteo.
 *
 * No consulta Neon (misma regla que `/api/health`): lee la base del respaldo
 * con la clave publicable. La copia cambia una vez al día, de ahí la caché de
 * una hora en la CDN.
 */

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;
  const headers = corsHeaders(req);

  const grilla = await obtenerGrilla();
  if (!grilla) {
    return Response.json(
      { error: 'Grilla del respaldo no disponible' },
      { status: 503, headers: { ...headers, 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
  return Response.json(grilla, {
    headers: {
      ...headers,
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
