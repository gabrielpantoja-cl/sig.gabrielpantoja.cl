# `.claude/` — shared agent config (Claude Code + OpenCode)

This folder is the **canonical home** of the agent assets both tools can share.
Edit here; never duplicate a file into `.opencode/`.

| Path | Claude Code | OpenCode | How |
|---|---|---|---|
| `skills/<name>/SKILL.md` | ✅ | ✅ | Both read `.claude/skills/` natively |
| `commands/*.md` | ✅ `/name` | ✅ `/name` | OpenCode via the `.opencode/commands` junction |
| `settings.local.json` | ✅ | — | Personal, gitignored |
| `../.opencode/agents/*.md` | — | ✅ | OpenCode-only format (`permission:`) |

## Setup (once per clone)

```sh
npm run agents:link
```

Creates `.opencode/commands → .claude/commands` (a junction on Windows, no admin
needed; a symlink elsewhere). Git does not track links, so the link is
gitignored and the script is idempotent. Skills need no link: a link there would
register every skill twice in OpenCode.

## Writing a command that works in both

Both tools accept the same body (`$ARGUMENTS`, `` !`shell` ``, `@file`) and
ignore frontmatter keys they don't know, so put both dialects side by side:

```markdown
---
description: <required — shown in both pickers>
agent: build                     # OpenCode
allowed-tools: Bash(npx tsc:*)   # Claude Code: lets the `!` steps run unprompted
---
```

Don't put a `README.md` inside `commands/` — both tools would expose it as a
`/README` command.

## Writing a skill

One folder per skill; `name` must match the folder (kebab-case). Front-load
trigger keywords in `description` (≤1024 chars) — it is the only text either
tool sees before deciding to load the skill.

```markdown
---
name: <folder-name>
description: <what AND when to trigger>
license: MIT
compatibility: claude-code, opencode
metadata:
  category: <tool | doctrine | data-sensitivity>
  data-tier: <A | B | C | D>
---
```

Docs: [Claude Code skills](https://code.claude.com/docs/en/skills) ·
[OpenCode skills](https://opencode.ai/docs/skills/) ·
[OpenCode commands](https://opencode.ai/docs/commands/).
