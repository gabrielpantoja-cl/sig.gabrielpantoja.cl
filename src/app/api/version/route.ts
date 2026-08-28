import { corsHeaders } from '@/lib/security';
import { APP_VERSION, BUILD_ID, type VersionInfo } from '@/lib/version';

/**
 * GET /api/version — identidad del despliegue que está sirviendo la app.
 *
 * La consume `components/UpdateNotice.tsx` para avisar al usuario cuando hay
 * un despliegue nuevo mientras tiene el SIG abierto. Es la única ruta que
 * NO pasa por `enforce()`: un sondeo cada cinco minutos por pestaña abierta
 * consumiría el presupuesto de rate limit que necesitan las consultas reales
 * al mapa, y la respuesta no toca la base de datos ni expone nada que no esté
 * ya en el bundle público.
 *
 * `no-store` es obligatorio: si el CDN cachea esta respuesta, el cliente sigue
 * viendo el build viejo y el aviso nunca aparece — que es exactamente el bug
 * que esta ruta existe para evitar.
 */

export const dynamic = 'force-dynamic';

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: Request) {
  const body: VersionInfo = { version: APP_VERSION, build: BUILD_ID };
  return Response.json(body, {
    headers: {
      ...corsHeaders(req),
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
