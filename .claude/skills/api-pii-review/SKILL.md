---
name: api-pii-review
description: Privacy (Ley 19.628) and security checklist for the public read-only API over Neon — PII columns that must never leave the server, parameterized SQL, explicit column allowlists, enforce()/rate limit, CDN cache keys (`ds` token), error leakage and the analytics privacy contract. Invoke BEFORE editing or reviewing src/app/api/**, src/lib/{neon,security,filters,types,cbr-points,dataset,analytics-server}.ts, db/*.sql, or anything that adds a column, filter, export format or endpoint touching CBR data.
license: MIT
compatibility: claude-code, opencode
metadata:
  category: data-sensitivity
  data-tier: A
---

## When to apply

- A new or changed route under `src/app/api/` that reads Neon (`getSql()`).
- A new column in a response, CSV/GeoJSON export, popup, permalink or log.
- A new filter in `src/lib/filters.ts` or a new SQL fragment anywhere.
- Changes to `db/*.sql` roles/grants, `src/lib/security.ts` or analytics.

## Hard rules (a violation blocks the change)

1. **PII never leaves the server.** `comprador`, `vendedor`, `rut`, `user_id` /
   `userId`, `observaciones` are never SELECTed, filtered on, sorted by,
   exported, logged, put in an analytics prop or shown in a popup. Not even
   hashed, truncated or counted per person.
2. **`rol` IS public** (SII property identifier, not personal data): do not
   strip it "for safety"; peritos search by it.
3. **Exposed per point, and nothing else:** `lat, lng, monto, montoUf, anio,
   comuna, predio, superficie, rol, destino, fechaEscritura, fechaInscripcion,
   fojas, numero, conservador`. The contract is `MapPoint` in
   `src/lib/types.ts`; a new field changes that type AND `AGENTS.md § Data &
   privacy` in the same change.
4. **Server-only credentials.** `NEON_DATABASE_URL`, `ANALYTICS_DATABASE_URL`,
   `ANALYTICS_SALT`, `ETL_DATABASE_URL` never get a `NEXT_PUBLIC_` prefix and
   are only read in route handlers / `src/lib/*` server modules. No client-side
   DB access. Never read `.env*` to "check" a value.
5. **Least-privilege roles.** The web reads with `web_readonly` (SELECT),
   analytics writes with `analytics_writer` (INSERT on `analytics.events`
   only), the loader with `etl_writer`. A change that needs more privilege is
   a design discussion, not a GRANT.

## Checklist

**SQL**
- [ ] Every user value is a `$N` placeholder (see `buildFilters` in
      `src/lib/filters.ts`). Only constants, placeholders and the `where` string
      `buildFilters` returns are interpolated into the query text.
- [ ] Free text goes through `containsPattern` (escapes `%`, `_`, `\`; capped
      at `MAX_TEXT_FILTER`). Numbers/dates go through `intParam`/`dateParam`.
- [ ] Explicit column list — never `SELECT *` — and the response object is
      built field by field from the row (allowlist), as in
      `src/app/api/points/route.ts`. Spreading a row (`...r`) into a response
      is a leak waiting for the next column.
- [ ] camelCase columns are double-quoted (`"superficieTerreno"`); calendar
      dates are serialized `::text` (no timezone shift).
- [ ] The result set is bounded (`LIMIT`, `MAX_POINTS`, partitions) — ~85k rows
      exist and the endpoint is public.

**Route handler**
- [ ] `const blocked = enforce(req); if (blocked) return blocked;` first thing
      in every GET/POST. Known exceptions: `/api/version` (must stay
      `no-store`) and `/api/analytics` (own silent limiter, always 204).
- [ ] A 429 is OUR limit (`RATE_LIMITED`, `service: sig.gabrielpantoja.cl`),
      never reported as an agency outage.
- [ ] Errors: the client gets a generic message (`{ error: 'Failed to …' }`);
      the server logs the error, never the query params or row values.
- [ ] CBR data routes (points, stats, facets, hexbins) are keyed by the
      dataset token `?ds=` (NOT `v`, which is the permalink viewport) so the CDN
      can't serve the pre-load copy. Cache headers match their siblings.
- [ ] `/estado`, `/api/health`, `/api/estado/grilla` never import `getSql` —
      a monitor polling them would keep Neon's compute awake.

**Analytics**
- [ ] Event names come from the closed catalog in `src/lib/analytics-events.ts`.
- [ ] Props carry field NAMES only (`filtros: ['comuna','anio']`), never filter
      values, rol, coordinates typed by the user or any free text.

## Mechanical checks

Run from the repo root (Git Bash). Each must print nothing except the noted
exceptions:

```sh
# 1. PII column names outside comments/tests
grep -rnwiE "comprador|vendedor|rut|user_?id|observaciones" src/app/api src/lib --include=*.ts \
  | grep -vE "^\S+:[0-9]+:\s*(\*|//|/\*)" | grep -v "\.test\.ts"
# 2. SELECT *
grep -rnE "SELECT\s+\*|\.\*\s+FROM" src/app/api src/lib --include=*.ts
# 3. Public-prefixed secrets
grep -rn "NEXT_PUBLIC_[A-Z_]*\(DATABASE\|NEON\|SALT\)" src
# 4. Handlers without enforce() — expected: analytics, version
for f in $(find src/app/api -name route.ts); do
  grep -qE "export (async )?function (GET|POST)" "$f" && ! grep -qE "=\s*enforce\(" "$f" && echo "$f"
done
# 5. Neon in the health/estado surface
grep -rln "getSql\|neon(" src/app/estado src/app/api/health src/app/api/estado src/lib/estado*.ts
```

Then `npm run typecheck && npm test` (`security.test.ts`, `filters.test.ts`
cover the limiter and the escaping).

## Report format (when reviewing)

Diagnosis · Evidence (`file:line`) · PII review (explicit "no PII exposed" or
the exact leak) · Query/performance notes · Recommended diff · Risks ·
Verification commands run and their result.
