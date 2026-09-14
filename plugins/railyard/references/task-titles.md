# Workflow task titles

Apply this policy whenever a Railyard workflow says it owns a task
title.

Use:

`<state emoji> <general area> <specific focus>`

Use `🧭` for discovery or planning, `🛠️` for active execution, `🧪` for
testing or validation, `⏸️` for blocked or waiting, and `✅` only at the
workflow's terminal state. Retitle only when the material state or focus
changes.

Use `#123` and `PR #456` when the repository is unambiguous. Qualify them as
`owner/repo#123` and `owner/repo PR #456` when it is not. Include both when
both apply.

User preferences, repository instructions, and higher-priority harness rules
take precedence over this default. Do not rename for ordinary intermediate
steps or create a visible task merely to assign a title.

When an existing task's material focus or resume state changes, use the
harness's naming tool if available. If it cannot rename tasks, continue
without claiming the title was changed.
