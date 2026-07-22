# Security Policy

## Supported versions

This is a **single-track** project. Only the latest commit on `main` receives
security updates. There is no LTS branch yet. If you depend on a fork or a
specific commit, you are responsible for keeping it patched.

| Version | Supported          |
|---------|--------------------|
| `main`  | ✅ Yes             |
| Older commits / forks / vendored copies | ❌ No — track `main` |

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security reports.** Public disclosure
of an unpatched vulnerability puts users at risk.

Preferred channels (in order of preference):

1. **GitHub private vulnerability report**: go to the repo's
   [Security tab](../../security/advisories/new) → "Report a vulnerability".
   This keeps the report confidential and routes it to the maintainer.
2. **Direct email** to the maintainer: check the commit history
   (`git log -1 --format='%an <%ae>'`) for the latest committer and use the
   address published on <https://gabrielpantoja.cl>.

Please include:

- A clear description of the vulnerability and its impact.
- Reproduction steps (curl, browser steps, payload, etc.).
- Environment: deployment (Vercel), Neon region, browser, OS.
- Whether you intend to disclose publicly (we will coordinate embargo).

You can expect:

- **Initial acknowledgment** within 72 hours.
- A **triage assessment** (severity, scope, affected versions) within 7 days.
- A **patch timeline** for confirmed vulnerabilities; high and critical
  issues aim for a same-week fix.

If you do not hear back within a week, please send a polite follow-up to the
same channel.

## Scope of this policy

### In scope

- The public read-only API under `src/app/api/` (the SELECT endpoint against
  Neon with role `web_readonly`).
- The frontend client (`src/app/`, `src/components/`) as served by Vercel.
- Authentication / authorization of the public API (origin allowlist, rate
  limit). Currently there is no write endpoint.
- Anything affecting the privacy guarantees documented in [README.md](./README.md)
  and [AGENTS.md § Data & privacy](./AGENTS.md):
  - The PII columns `comprador`, `vendedor`, `rut`, `user_id`,
    `observaciones` must never appear in any response payload, log line, or
    client bundle.

### Out of scope

- The upstream data sources themselves (MMA, MINVU, SUBDERE, MOP, CIREN,
  IDE Minagri). Report issues to those organizations directly.
- The Neon managed database service. Report to Neon support.
- Vercel platform security. Report to Vercel support.
- The npm ecosystem. Report to the relevant package maintainer.

## Security model (in plain terms)

This is a **read-only public app**. There is no write endpoint and no
authenticated user. Threat surface is therefore narrow:

1. **Data exfiltration via injection**: inputs from query strings go through
   `src/lib/filters.ts` (parameterized `$N` placeholders, anti-injection
   sanitization) before reaching Neon. The web_readonly DB role has SELECT
   only.
2. **CORS / abuse via bot scraping**: `src/lib/security.ts` enforces an
   origin allowlist in production and a best-effort per-IP rate limit.
3. **Layer hallucination via 3rd-party services**: soils CIREN and geocoder
   are proxied server-side. Failures degrade the UX, not data integrity.
4. **Dependency CVEs**: covered by Dependabot (`.github/dependabot.yml`).

If you find a way around any of these, that's a vulnerability — please
report it.

## Disclosure timeline

1. You privately report the issue.
2. Maintainer confirms reproduction and assigns severity (CVSS v3.1).
3. Patch is developed in a private fork / security advisory branch.
4. Patch is merged to `main`, deployment rolls out via Vercel.
5. Once deployed (typically same day for high/critical), a public GitHub
   Security Advisory is published with credit to the reporter (unless they
   prefer to remain anonymous).
6. CVE is requested if the issue warrants it (high/critical).

We aim for full disclosure within 90 days of the initial report, per
[CVD](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
norms.

## Recognition

Researchers who follow this policy and contribute a fix (or a high-quality
report that leads to one) are credited in the public advisory. We do not
currently run a paid bug bounty program — this project is volunteer-run.