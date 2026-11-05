import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Artefactos locales del MCP de Playwright (gitignorados): scripts de
    // sondeo desechables, no código del proyecto.
    ".playwright-mcp/**",
    // Repos de terceros y salidas de investigación (gitignorados): con un
    // proyecto externo descomprimido ahí el lint local reportaba cientos de
    // errores ajenos. En CI la carpeta no existe.
    ".research/**",
    // Salida de `open-next` (gitignorada): bundles minificados que disparaban
    // ~19k problemas y dejaban inservible el `npm run lint` previo al push.
    // En CI la carpeta no existe.
    ".open-next/**",
    // Leaflet vendorizado en el espejo estático: código de terceros, copiado
    // tal cual a propósito para que el corte público no dependa de un CDN.
    // Lintearlo dejaba `main` en rojo (un `no-this-alias` dentro del bundle).
    "espejo/sitio/vendor/**",
  ]),
]);

export default eslintConfig;
