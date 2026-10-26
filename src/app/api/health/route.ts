import { enforce, corsHeaders } from '@/lib/security';
import { APP_VERSION, BUILD_ID } from '@/lib/version';
import { resumirEstado } from '@/lib/estado';
import { obtenerVerificaciones } from '@/lib/estado-server';

/**
 * GET /api/health — salud del sitio y de los datos, para monitores externos.
 *
 * Responde 200 mientras la app esté arriba; el estado de los datos va en
 * `datos.nivel` (`al-dia` | `falla` | `atrasado` | `sin-datos`), así un monitor
 * de palabra clave puede alertar sobre `"nivel":"al-dia"` sin confundir una
 * falla del respaldo con una caída del sitio.
 *
 * No consulta la base principal: un sondeo cada pocos minutos la mantendría
 * despierta (horas de cómputo) y gastaría su cuota. Lee la misma tabla de
 * verificaciones que `/estado`, con caché de 15 min. Sí pasa por `enforce()`:
 * un monitor sondea muy por debajo del límite de 60 req/min.
 */

export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const { nivel, ultima, ultimaOk } = resumirEstado(await obtenerVerificaciones(5), Date.now());
  return Response.json(
    {
      status: 'ok',
      version: APP_VERSION,
      build: BUILD_ID,
      datos: {
        nivel,
        ultima_verificacion: ultima?.verificado_en ?? null,
        ultimo_respaldo_verificado: ultimaOk?.verificado_en ?? null,
        transacciones: ultimaOk?.referenciales ?? null,
      },
    },
    {
      headers: {
        ...corsHeaders(req),
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
