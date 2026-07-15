# `.opencode/` — shared AI tooling

This directory holds shared (committed) OpenCode assets for the
`sig.gabrielpantoja.cl` repo: custom agents, slash commands, and
on-demand skills. Per-machine personal assets go in
`~/.config/opencode/` (NOT committed; lives in each developer's
home directory and is therefore isolated between the Linux Mint
and Windows 11 dual-boot machines).

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

## Current state

Empty by design (2026-07 audit). Populate as needed.