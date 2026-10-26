import type { MetadataRoute } from 'next';

/**
 * Web App Manifest: hace el SIG instalable desde Chrome en Android («Instalar
 * app»), con ícono propio y sin la barra del navegador. Es el camino elegido
 * en vez de un APK propio (ver `docs/roadmap.md` § Producto y mercado); si se
 * quiere estar en Play Store, esta misma PWA se empaqueta como TWA.
 *
 * Los PNG de `public/icons/` salen de `src/app/icon.svg`; el maskable lleva
 * el ícono dentro de la zona segura (80 %) para que Android lo recorte sin
 * comerse el marcador.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SIG de suelo — Transacciones CBR',
    short_name: 'SIG de suelo',
    description:
      'Mapa de compraventas de suelo inscritas en el CBR y capas oficiales de Chile, con datos abiertos.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'es-CL',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['utilities', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
