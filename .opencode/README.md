# `.opencode/` — shared AI tooling

This directory holds shared (committed) OpenCode assets: custom agents, slash
commands, and on-demand skills. Per-machine personal assets go in
`~/.config/opencode/` (NOT committed; lives in each developer's home
directory and is therefore isolated between machines).

## Layout

| Path | Purpose |
|---|---|
| `agents/*.md` | Custom agents (markdown form) |
| `commands/*.md` | Custom `/slash` commands (markdown form) |
| `skills/<name>/SKILL.md` | On-demand skills (one folder per skill) |

The discovery order is documented at
https://opencode.ai/docs/config/#precedence-order — project-local
`.opencode/` is loaded after the global config and before
`CLAUDE.md` imports.

## Conventions

- Skill names: kebab-case, must match their directory name
  (1–64 chars, lowercase alphanumeric + single hyphens).
- Frontmatter: only `name` and `description` are required.
- Test locally before committing: open a session and use the
  `skill` tool to verify each new skill resolves.

## Current roster

Primary agents:

- `build` — OpenCode's default implementation agent.
- `plan` — OpenCode's read-only planning agent.
- `orchestrator` — project coordinator for multi-domain SIG work, configured
  with GPT-5.6 Luna and a specialist allowlist.

Read-only project subagents:

- `canvas-export-agent`
- `gis-architect-agent`
- `nextjs-architect-agent`
- `neon-data-engineer-agent`
- `etl-pipeline-engineer-agent`

The built-in `README` agent remains available for documentation generation; it
is not a primary agent and is intentionally not in the orchestrator's task
allowlist.
