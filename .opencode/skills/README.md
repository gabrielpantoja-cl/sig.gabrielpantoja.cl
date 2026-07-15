# Custom skills

Drop one folder per skill, each containing a `SKILL.md`. Skills are
loaded on demand via the native `skill` tool. Front-load trigger
keywords in the `description` (1–1024 chars) so the model can pick
the right skill.

## Frontmatter template

```markdown
---
name: <required — must match the directory name, kebab-case>
description: <required — what AND when to trigger>
license: MIT
compatibility: opencode
metadata:
  category: <tool | doctrine | data-sensitivity>
  data-tier: <A | B | C | D>
---

<skill body>
```

## Discovery paths

OpenCode discovers skills at (in order of precedence):

1. `~/.config/opencode/skills/<name>/SKILL.md` (personal, global)
2. `~/.claude/skills/<name>/SKILL.md` (Claude-compatible, personal)
3. `~/.agents/skills/<name>/SKILL.md` (Agent-compatible, personal)
4. `.opencode/skills/<name>/SKILL.md` (this directory — shared, committed)
5. `.claude/skills/<name>/SKILL.md` (Claude-compatible, shared)
6. `.agents/skills/<name>/SKILL.md` (Agent-compatible, shared)

See https://opencode.ai/docs/skills/ for the full schema.