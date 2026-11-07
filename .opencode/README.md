# `.opencode/` — shared AI tooling

This directory holds the **OpenCode-only** assets. Skills and commands are
shared with Claude Code and live canonically in [`../.claude/`](../.claude/README.md):
OpenCode reads `.claude/skills/` natively and reaches `.claude/commands/`
through the gitignored `commands` junction created by `npm run agents:link`.
Per-machine personal assets go in `~/.config/opencode/` (NOT committed).

## Layout

| Path | Purpose |
|---|---|
| `agents/*.md` | Custom agents (OpenCode format, not shared) |
| `commands` → `../.claude/commands` | Junction — edit the target, never here |

## Conventions

- Skill and command conventions: see [`../.claude/README.md`](../.claude/README.md).
- Agent names: keep the `-agent` suffix on read-only specialists.

## Current roster

Primary agents:

- `build` — OpenCode's default implementation agent.
- `plan` — OpenCode's read-only planning agent.
- `orchestrator` — project coordinator for multi-domain SIG work, configured
  with a deny-by-default specialist allowlist (the model itself is not pinned
  in the repo; it comes from each machine's OpenCode config).

Read-only project subagents:

- `canvas-export-agent`
- `gis-architect-agent`
- `nextjs-architect-agent`
- `neon-data-engineer-agent`
- `etl-pipeline-engineer-agent`

The built-in `README` agent remains available for documentation generation; it
is not a primary agent and is intentionally not in the orchestrator's task
allowlist.
