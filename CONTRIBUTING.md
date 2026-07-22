# Contributing to sig.gabrielpantoja.cl

¡Gracias por tu interés en mejorar el SIG de suelo! Este documento resume cómo
contribuir de forma efectiva y qué reglas duras aplican.

## Código de conducta

Este proyecto adopta el [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md).
Al participar aceptas sus términos.

## Reportar problemas

- **Bugs / cosas rotas**: abre un [Bug Report](../../issues/new?template=bug_report.yml).
- **Mejoras / ideas de funcionalidad**: abre un [Feature Request](../../issues/new?template=feature_request.yml).
- **Vulnerabilidades de seguridad**: NO abras un issue público. Sigue
  [SECURITY.md](./SECURITY.md).

Antes de abrir un issue, busca en los ya existentes para evitar duplicados.
Incluye siempre:

- Navegador y versión
- URL exacta y paso a paso para reproducir
- Captura de pantalla si involucra el mapa
- Salida de la consola del navegador (F12 → Console)

## Setup de desarrollo

```bash
# 1. Fork y clona el repo
git clone https://github.com/<tu-usuario>/sig.gabrielpantoja.cl.git
cd sig.gabrielpantoja.cl

# 2. Configura las variables de entorno
cp .env.example .env.local
# Completar NEON_DATABASE_URL con la cadena read-only de Neon
# (consulta al maintainer si no la tienes; rol web_readonly, SELECT only)

# 3. Instala dependencias y arranca
npm install
npm run dev                  # http://localhost:3000

# 4. Regenera los GeoJSON de las capas (opcional; ya commiteados al repo)
npm run data:build
```

> **Sin `NEON_DATABASE_URL`**: la UI carga pero `/api/points`, `/api/stats`,
> `/api/facets` y `/api/export` devolverán error 500. El resto (geocoder,
> capas estáticas, KML propio, suelos CIREN dinámico) sigue funcionando.

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Dev server en `localhost:3000` |
| `npm run lint` | ESLint + TypeScript check (corre también en CI en cada PR) |
| `npm run build` | Build de producción |
| `npm run data:build:protected` | Regenera `public/data/areas-protegidas.geojson` |
| `npm run data:build:urban` | Regenera `public/data/limite-urbano.geojson` |
| `npm run data:build:comunas` | Regenera `public/data/limites-comunales.geojson` |
| `npm run data:build:red-vial` | Regenera `public/data/red-vial.geojson` |
| `npm run data:build:catastro-fruticola` | Regenera `public/data/catastro-fruticola.geojson` |
| `npm run data:build` | Regenera todo lo anterior |

## Convenciones de código

Lee [AGENTS.md](./AGENTS.md) § "Conventions" antes de tocar el código. En
resumen:

- **Next.js 16** App Router (este NO es el Next.js que conoces — lee
  `node_modules/next/dist/docs/` antes de escribir APIs nuevas).
- **TypeScript strict mode**, alias `@/` → `src/`.
- **Tailwind CSS v4** (PostCSS plugin, NO v3 config file).
- **Semicolons** en todos los archivos de código.
- **Dark mode** con variantes `dark:` de Tailwind.
- **Lint obligatorio antes de commit**: `npm run lint`.

## Áreas donde contributions son bienvenidas

1. **Nuevas capas temáticas** oficiales del Estado de Chile. Sigue la receta
   de [docs/arquitectura-capas.md](./docs/arquitectura-capas.md) § "Receta:
   agregar una capa temática nueva" al pie de la letra. Sin receta cumplida
   no se mergea.
2. **Bugs en `src/components/MapView.tsx`** (Leaflet es traicionero con SSR,
   refs y layers de Leaflet con cluster group).
3. **ETL de capas existentes** cuando la fuente oficial cambia de URL, formato
   o parámetros ArcGIS REST.
4. **i18n**: todo el UI está en español de Chile. Si quieres añadir inglés,
   se prefiere `next-intl` o similar, con traducciones externas y un PR inicial
   pequeño.
5. **Mejoras de accesibilidad**: el panel de capas y el `InfoPanel` aún tienen
   aria-labels pendientes.
6. **Tests**: no hay framework configurado (ver [AGENTS.md § Commands]).
   Si añades uno (sugerido: Vitest + Testing Library), empieza por los filtros
   (`src/lib/filters.ts`) y el sanitizador de inputs.

## Reglas duras (HARD RULES)

Estas nunca se negocian en un PR:

- **NUNCA exponer** `comprador`, `vendedor`, `rut`, `user_id`, `observaciones`
  en un endpoint o respuesta de API. Son PII bajo Ley 19.628. Si necesitas
  una columna nueva para investigación, abre primero un issue discutiendo el
  caso de uso legal.
- **NUNCA** pre-fijar `NEON_DATABASE_URL` ni con `NEXT_PUBLIC_` ni con
  `VITE_`. Va en `.env.local` (gitignoreado) y en Vercel env vars.
- **NUNCA** añadir acceso a DB desde el cliente. Toda query pasa por route
  handlers en `src/app/api/`.
- **Datos oficiales con atribución obligatoria**: cada capa debe llevar la
  attribution string en `src/lib/<capa>.ts`, en el panel y en el popup.

## Estructura del pull request

0. **El check `Lint` debe pasar antes de mergear**. La rama `main` está
   protegida por un ruleset que requiere el job `Lint` del workflow
   `.github/workflows/lint.yml` (corre `npm run lint`) y al menos 1
   aprobación. Un PR con lint en rojo no se puede mergear.

1. Crea una rama con prefijo descriptivo:
   - `feat/<capa>-nueva` — capa nueva
   - `fix/<síntoma-corto>` — bug fix
   - `chore/<descripción>` — mantenimiento
   - `docs/<descripción>` — solo docs
2. Commits chicos y con mensaje descriptivo. Conventional Commits sugerido.
3. Antes de abrir el PR corre:
   ```bash
   npm run lint
   ```
4. Llena la [PR template](./.github/PULL_REQUEST_TEMPLATE.md) al abrir.
5. Si tu PR agrega una capa nueva, enlaza en la descripción al issue de
   "Receta de capa" (o créalo primero) y al organismo proveedor.

## Versionado y releases

- `main` es siempre deployable.
- No se hace semantic versioning formal todavía (el proyecto está en
  `0.1.0` y todavía no hay consumo externo de la API que justifique romper).
- Cuando se publique la API v1, se introduce SemVer con `npm version` y
  `CHANGELOG.md`.

## Recursos

- [AGENTS.md](./AGENTS.md) — instrucciones para agentes AI y humanos (arquitectura,
  comandos, hard rules).
- [docs/arquitectura-capas.md](./docs/arquitectura-capas.md) — catálogo de capas
  + receta para agregar una capa nueva.
- [docs/fuentes-gis-chile.md](./docs/fuentes-gis-chile.md) — fuentes oficiales
  del Estado de Chile consultadas y su confiabilidad.
- [docs/roadmap.md](./docs/roadmap.md) — backlog priorizado.

## ¿Dudas?

Abre un issue con la etiqueta `question` o `discussion`. El maintainer
(Gabriel Pantoja) responde en horario hábil Chile continental.