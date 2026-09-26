# Workflow task titles

Default format when a Railyard workflow owns a task title:

`<state emoji> <general area> <specific focus>`

Use `🧭` for discovery or planning, `🛠️` for active execution, `🧪` for
testing or validation, `⏸️` for blocked or waiting, and `✅` only at the
workflow's terminal state.

Use `#123` and `PR #456` when the repository is unambiguous; otherwise qualify
them as `owner/repo#123` and `owner/repo PR #456`.

User preferences, repository instructions, and harness rules take precedence.
Retitle with the harness's naming tool only when the material state, focus, or
resume state changes; never create a visible task just to title it.
