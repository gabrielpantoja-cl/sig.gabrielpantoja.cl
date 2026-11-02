import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': src,
      // `server-only` is resolved by Next's bundler; outside it the package is
      // not installed. Server modules import it as a guard, so tests swap it
      // for an empty module.
      'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // Los scripts de construccion de datos tambien llevan pruebas: la
    // canonicalizacion y el arbol de Merkle del corte publico son logica pura
    // que no puede romperse en silencio (docs/preservacion-datos.md).
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
});
