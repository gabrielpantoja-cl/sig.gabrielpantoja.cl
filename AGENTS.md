<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# sig.gabrielpantoja.cl — SIG de suelo

> **Open source** ([MIT](./LICENSE); data layers keep their own licences, see
> [README § Licencias](./README.md)). Read [CONTRIBUTING.md](./CONTRIBUTING.md)
> before a PR; conduct in [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), security
> reports via [SECURITY.md](./SECURITY.md).

Single-page Next.js 16 App Router app (one route, `/`). Maps ~85k CBR land
transaction points from Neon plus ~15 thematic layers from official Chilean
sources.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on `localhost:3000` |
| `npm run build` | Production build |
| `npm run lint` | ESLint — required to merge |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest 4 unit tests (`src/**/*.test.ts`, next to the module; `npm run test:watch`) |
| `npm run data:build` | Regenerate every static layer; one layer: `npm run data:build:<capa>` (`protected`, `urban`, `comunas`, `red-vial`, `red-drenaje`, `lineas-transmision`, `catastro-fruticola`, `bioclima`) |
| `npm run analytics:report [-- días]` | Internal usage report from `analytics.events` |

CI (`.github/workflows/lint.yml`) runs lint → typecheck → test → build on
**Node 22**; keep `engines.node` in `package.json` equal to the workflow's
`node-version`. In tests `server-only` is aliased to `test/server-only.ts`.

## Architecture

```
Browser → /api/{points,stats,export,facets,hexbins,conservadores} → Neon (web_readonly, SELECT)
Browser → /api/{suelos,vegetacional,humedales,propiedades-rurales}/* → official ArcGIS (validated proxy)
Browser → /api/{ndvi,relieve}/* → public COGs on AWS, rendered by our server
Browser → /api/geocode → Nominatim/OSM (Chile only, cached proxy)
Browser → /api/analytics (sendBeacon) → Neon analytics.events (analytics_writer, INSERT)
Any client → src/proxy.ts (before CDN cache) on /api/{points,export} → api_* analytics events
```

- **No client-side DB access.** All data goes through `src/app/api/`.
- **MapView** is dynamically imported with `ssr: false` (Leaflet needs `window`); each thematic layer lives in its own hook under `src/components/map/`.
- **Layer families**: static files in `public/data/` built by `scripts/build-*.mjs` (with a `*.meta.json` provenance manifest); remote per-viewport PNGs (ArcGIS proxies via `useViewportRaster`, NDVI and Relieve rendered server-side); derived (value heat map from `/api/hexbins`); Neon points (CBR, Conservadores).
- **Point query («¿Qué hay aquí?»)**: ONE click handler, `usePointQuery.ts`, for every queryable layer. Do NOT add per-layer click popups; add a section there.
- **Permalink**: `src/lib/permalink.ts` + `usePermalink.ts` (`replaceState`, never `pushState`). A new layer must be added to `layerFlags` in `page.tsx` or it fails to compile.
- **Analytics** is privacy-first: closed event catalog in `src/lib/analytics-events.ts`, no tracking cookies, props carry field NAMES only — never filter values or user text.

**Before touching a layer or map feature, read its section in
[`docs/design-notes.md`](./docs/design-notes.md)** — it records the
load-bearing decisions (and the bugs that already shipped once). The full
key-files table lives there too. Invariants that are easy to break:

- Never use tiled WMS for the ArcGIS layers (~40 simultaneous GetMap collapse the state servers): one PNG per viewport.
- Raster overlays must be produced linear in EPSG:3857, never in degrees (bioclima once landed 287 km off).
- A 429 is OUR rate limit (60 req/min/IP, `enforce()`), never reported as the agency being down.
- Shared ramps (`bioclima-ramp.json`, `ndvi-ramp.json`, `rampPosition`) are read by both painter and legend — never duplicate them.
- The heat map always filters by a single `destino` and interpolates cell MEDIANS; the hex grid is never drawn.
- Transmission lines are referential axes: never derive servidumbres with buffers. Catastro frutícola `vintage` is the survey year, never the planting year. Relieve is a DSM and its Copernicus licence notice is mandatory.
- Do NOT add CARTO or Stadia basemaps (they require API keys). The basemap preference is read via `useSyncExternalStore`, not `useState` + `useEffect`.
- `/api/version` is the only route that skips `enforce()` and must stay `no-store`.

## Environment

`NEON_DATABASE_URL` in `.env.local` (and Vercel), never `NEXT_PUBLIC_`. Get it
with `npx vercel link` once, then
`npx vercel env pull .env.local --environment=development`. Without it the CBR
routes answer 500 but every other layer works.

Optional analytics: `ANALYTICS_DATABASE_URL` (role `analytics_writer`, see
`db/analytics.sql`) and `ANALYTICS_SALT`. Locally use
`ANALYTICS_REPORT_DATABASE_URL` for the report, NOT `ANALYTICS_DATABASE_URL`
(dev would write events).

## Data & privacy

Exposed per point: `lat, lng, monto, anio, comuna, predio, superficie, rol, destino, fojas, numero, conservador`.
`rol` IS intentionally public (SII identifier, not PII under Ley 19.628).

## Versioning

SemVer, currently **0.2.0** (`package.json` and `src/lib/version.ts` must
agree). `0.x` because the `/api/*` contract is not frozen; `1.0.0` freezes it.
MENOR = a user-visible capability ships; PARCHE = fixes, styling, data
regeneration. Tag each release (`v0.2.0`) and record it in `CHANGELOG.md`.
The update monitor triggers on `BUILD_ID`, so un-bumped deploys still notify.

## Conventions

- **Tailwind CSS v4** via `@tailwindcss/postcss` (no v3 config file); `dark:` class-based dark mode
- **Path alias** `@/` → `src/`; TypeScript strict, `bundler` resolution; ESLint flat config
- **Semicolons** in source files
- Commit straight to `main` for routine work; use `feat/**`, `fix/**`, `chore/**`, `docs/**` branches for large or experimental changes

## Documentation

- `docs/design-notes.md` — per-layer and per-feature design decisions + full key-files table
- `docs/arquitectura-capas.md` — layer catalog + recipe for a new layer (READ before adding one)
- `docs/estadisticas.md` — how the stats panel is computed (READ before touching `/api/stats` or `StatsFields`)
- `docs/fuentes-gis-chile.md` — catalog of official Chilean GIS sources and verified endpoints
- `docs/roadmap.md` — current state and prioritized backlog
- `docs/plan-mapa-de-calor.md` — heat map design and calibration
- `docs/estructura-catastral.md` — SII catastral structure and coding tables
- `docs/auditoria-ux-2026-08.md` — UX audit from a power GIS user's perspective

## HARD RULES

- **NEVER expose** `comprador`, `vendedor`, `rut`, `user_id`, `observaciones` (PII under Ley 19.628) — stripped at the API level (`src/lib/security.ts`)
- **NEVER use `NEXT_PUBLIC_`** for database credentials
- **NEVER add client-side DB access**
- **NEVER commit `.env.local`** or any real `.env*` file; editing them needs explicit approval (tracked templates like `.env.example` are fine)
- **NEVER remove semicolons**
- **NEVER `--force` push to `main`** — blocked by the `Protect main` ruleset; the `ESLint + TypeScript` check (lint, typecheck, tests, build) runs on every push. Run `npm run lint` before pushing.

## AI tooling

Read by Claude Code, OpenCode, Codex and others. This file is the single
source of truth; per-machine overrides (paths, model, providers, permissions)
live in the gitignored `AGENTS.local.md`. `CLAUDE.md` / `CLAUDE.local.md` are
shims that import them. `opencode.json` is committed with permissions and
instruction wiring only — no model, which stays a per-machine choice.

`.opencode/` holds the shared assets: `agents/orchestrator.md` (primary
coordinator, deny-by-default delegation), read-only specialists
`agents/*-agent.md` (keep them read-only), `commands/*.md` and
`skills/<name>/SKILL.md`. This is a public repo: agent prompts must never
contain credentials, private appraisal content or machine-specific secrets.
