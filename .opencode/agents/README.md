# Custom agents

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

See https://opencode.ai/docs/agents/ for the full schema.