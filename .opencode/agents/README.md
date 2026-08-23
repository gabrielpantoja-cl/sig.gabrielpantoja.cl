# Project agents

Drop markdown files here to add custom agents. Each file's basename
becomes the agent's name. Example `review.md` → `@review` mention in
the TUI.

## Frontmatter template

```markdown
---
description: <required — one sentence covering what AND when to trigger>
mode: subagent          # primary | subagent | all
model: inherit          # provider/model-id, or "inherit" to use the default
temperature: 0.1        # 0.0–1.0
permission:
  edit: deny
  bash: ask
  webfetch: deny
---

<agent instructions>
```

## Roster

- `build` and `plan` are OpenCode's built-in primary agents.
- `orchestrator` is this project's primary coordinator. It uses GPT-5.6 Sol
  and has a deny-by-default `task` allowlist for specialist delegation.
- `canvas-export-agent` and `gis-architect-agent` are read-only GIS specialists.
- `nextjs-architect-agent`, `neon-data-engineer-agent` and
  `etl-pipeline-engineer-agent` are read-only specialists for the application,
  API/database and official-data pipelines.
- `README` is a built-in documentation subagent, not a third primary agent.

The specialist agents never edit files. The primary orchestrator reviews their
reports, applies the patch, and runs verification. Keep the suffix `-agent` on
project specialists so contributors can distinguish `@`-invoked subagents from
primary agents.

See https://opencode.ai/docs/agents/ for the full schema.
