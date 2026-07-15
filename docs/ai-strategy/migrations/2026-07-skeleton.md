# Migration journal — 2026-07 — AI tooling skeleton

**Date:** 2026-07-14
**Type:** Additive (no deletes, no moves, no renames, no junctions)
**Phase:** 6 (documentation)

## What changed

Adopted current OpenCode 1.18 best practices for this repo:

1. **`opencode.json`** — extended from 4 lines to a full configuration:
   - pinned the primary model to `minimax/MiniMax-M3` (paid Token Plan);
   - set `enabled_providers: ["minimax"]` so the 75+ default providers
     are not loaded and any leaked credentials elsewhere are ignored;
   - added the Playwright MCP server (`@playwright/mcp@latest` via
     `npx -y`) for in-IDE browser smoke tests of the Leaflet map;
   - added an explicit `permission` block with the user's chosen
     permissive posture (`edit: allow`, `bash: allow`, `build: allow`)
     plus two non-negotiable denies (`git push*`, `rm -rf *`) that
     mirror the constraints in `AGENTS.local.md`;
   - kept `share: manual` and `snapshot: true` (the OpenCode defaults);
   - kept `autoupdate: true` (user choice);
   - kept the existing `instructions: ["AGENTS.md", "AGENTS.local.md"]`.

2. **`AGENTS.md`** — appended five new additive sections (Models,
   MCP, Skills/Agents/Commands, Permissions, Documentation). No edits
   to any existing line; the project rules, HARD RULES, and Next.js
   reminder are untouched.

3. **`.opencode/` skeleton** — created three empty subdirectories
   (`agents/`, `commands/`, `skills/`) plus four README files
   explaining the shared vs personal split and providing frontmatter
   templates for future content. No skill, agent, or command files
   were created (user chose "skeleton only").

4. **`docs/ai-strategy/`** — created two reference docs from the
   audit (`research-2026-07-14.md`, `plan-2026-07-14.md`) and this
   migration journal.

## What did NOT change

- `AGENTS.local.md` — by design the per-machine override file. The
  user's dual-boot (Linux Mint + Windows 11) needs distinct content
  on each machine, so it remains gitignored and un-touched by this
  audit.
- `CLAUDE.md` and `CLAUDE.local.md` — redirector / per-machine
  Claude override. Unchanged.
- `.gitignore` — already covers `.env*`, `AGENTS.local.md`,
  `CLAUDE.local.md`, `/.playwright-mcp/`, `/scripts/.cache/`.
- App code (`src/`, `scripts/`, `public/`, `docs/`,
  `node_modules/`) — zero changes.
- `package.json`, `package-lock.json`, `tsconfig.json`,
  `eslint.config.mjs`, `next.config.ts` — zero changes.

## Why

The pre-audit state had a working but minimal config:

```json
{ "$schema": "...", "instructions": ["AGENTS.md", "AGENTS.local.md"] }
```

It relied on OpenCode's internal defaults for model selection
(which would auto-pick whatever last-credentialed provider is loaded)
and loaded all 75+ providers by default. With a paid Token Plan, the
user wanted deterministic model selection, a provider allowlist as a
defensive default-deny posture, and one MCP server for browser
testing of the Leaflet map. The `.opencode/` skeleton is forward-
looking: future skills/agents/commands have a canonical home.

## Validation performed

- `opencode debug config` — JSONC parsed cleanly, merged config
  shows the new keys.
- `opencode mcp list` — playwright connected (the only new server).
  Two pre-existing global MCPs (`docling`, `supabase`) failed to
  connect, unrelated to this change.
- `npm run lint` — passed with zero errors.
- `git status` — exactly the expected file set.

## Rollback

Single command:

```
git revert HEAD
```

Or for finer control:

```
git checkout HEAD~1 -- opencode.json AGENTS.md
rm -rf .opencode
```

The `.opencode/` directory contains only README files; removing it
is harmless if rollback is needed.

## Lessons

1. The user develops on a dual-boot (Linux Mint + Windows 11). The
   `AGENTS.local.md` per-machine override mechanism is the right
   pattern for that — keep it, don't centralise.
2. The user prefers permissive defaults with explicit denies for
   known footguns, rather than default-deny everywhere. Respect
   that.
3. OpenCode's `enabled_providers` is an allowlist — it cleanly
   prevents accidental fallback to other providers when the primary
   fails. Use it for single-plan repos.
4. The user's global config already has MCP servers (`docling`,
   `supabase`, `ollama`) configured. Project-level MCP config does
   not disturb the global config; both are merged. Good.

## Related docs

- `docs/ai-strategy/research-2026-07-14.md` — pre-flight research
- `docs/ai-strategy/plan-2026-07-14.md` — approved plan