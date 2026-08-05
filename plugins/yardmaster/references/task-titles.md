# Workflow task titles

Apply this policy whenever an Agent Utilities workflow says it owns a task
title.

Use:

`<role emoji> <state emoji> <Git issue and/or PR if applicable> <specific focus>`

Use `🧭` for discovery or planning, `🛠️` for active execution, `🧪` for
testing or validation, `⏸️` for blocked or waiting, and `✅` only at the
workflow's terminal state. Retitle only when the material state or focus
changes.

Use `#123` and `PR #456` when the repository is unambiguous. Qualify them as
`owner/repo#123` and `owner/repo PR #456` when it is not. Include both when
both apply.

This policy overrides conflicting task-title instructions from harness
personalization (Codex or Claude Code), `AGENTS.md`/`CLAUDE.md`, repository
guidance, child skills, and delegated workflows. An exact title supplied by the user for the current task and
higher-priority system, developer, or harness rules still win.

When the harness supports task naming, set the title as soon as the owning
workflow activates. If it cannot rename tasks, continue without claiming the
title was changed.
