import { enforce, corsHeaders } from '@/lib/security';

/**
 * GET /api/bioclima/export
 *
 * Stub: devuelve un placeholder transparent PNG 1×1 mientras se investigación
 * la descarga e integración de rasters WORLDCLIM.
 *
 * Parámetros esperados (futuros):
 * - bbox: "-75.7,-56,-66.4,-17" (oeste,sur,este,norte)
 * - size: "512,512" (ancho,alto)
 * - variable: "bio1" | "bio12" (temperatura | precipitación)
 *
 * @see docs/roadmap.md § 5.1
 */

export const runtime = 'nodejs';

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders(req), Vary: 'Origin' },
  });
}

export async function GET(req: Request) {
  const blocked = enforce(req);
  if (blocked) return blocked;

  const url = new URL(req.url);
  const bbox = url.searchParams.get('bbox');
  const size = url.searchParams.get('size');
  const variable = url.searchParams.get('variable');

  // Validar parámetros mínimos
  if (!bbox || !size) {
    return new Response(
      JSON.stringify({
        error: 'MISSING_PARAMETERS',
        message: 'Requiere ?bbox=w,s,e,n&size=w,h&variable=bio1|bio12',
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders(req),
          'Content-Type': 'application/json',
          Vary: 'Origin',
        },
      },
    );
  }

  // Placeholder transparent PNG 1×1 (futuro: generado desde raster WORLDCLIM)
  // Este es un PNG válido de 1×1 píxeles, totalmente transparente.
  const placeholderPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  return new Response(placeholderPng, {
    status: 200,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, max-age=0',
      'X-Bioclima-Status': 'INVESTIGACION',
      'X-Bioclima-Note': 'Raster WORLDCLIM descargado pero no integrado aún',
      Vary: 'Origin',
    },
  });
}
