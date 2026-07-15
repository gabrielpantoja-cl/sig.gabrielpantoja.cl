# Custom commands

Drop markdown files here to add custom `/slash` commands. Each
file's basename becomes the command's name. Example `test.md` → `/test`
in the TUI.

## Frontmatter template

```markdown
---
description: <required — shown in the /command picker>
agent: build              # which agent runs the command
model: inherit            # provider/model-id, or "inherit"
subtask: false            # true to force subagent invocation
---

<command body — supports $ARGUMENTS, $1, $2, `!`shell``, @file>
```

See https://opencode.ai/docs/commands/ for the full schema.