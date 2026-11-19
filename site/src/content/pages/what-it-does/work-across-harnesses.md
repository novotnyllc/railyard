---
layout: default
title: Work across harnesses
parent: Practices
nav_order: 6
---

# Work across harnesses

Describe the outcome in your Codex or Claude Code chat:

> Fix retries and show a useful CLI error when they run out.

The chat can handle a small change directly or select CE Work for a clear
implementation request. CE Work keeps scheduling, integration, and verification
in the current chat. It defaults to the current harness and reads external
implementer preferences from `.compound-engineering/config.local.yaml` and
`.compound-engineering/config.yaml` when it runs. You can also name an engine for
a particular assignment.

Each run binds a single implementation engine. Give one run ownership of a
shared file at a time. CE checks the requested engine, isolates external edits
in a worktree, and returns evidence to the coordinating chat. Use
`mode:return-to-caller` when the chat owns the combined review or publication.

CE has implementation targets for Codex, Claude, Grok, Antigravity, OpenCode,
and others. Use Groq through CE's `opencode` route. Configure Groq in OpenCode,
connect your account with `/connect`, then pass a `groq/<model-id>` selector from
`/models` to CE. External routes depend on local tooling, account access, and
the requested model. Follow CE's preflight and read back which engine ran. [OpenCode providers](https://opencode.ai/docs/providers/) · [Execution engines](https://github.com/EveryInc/compound-engineering-plugin/blob/compound-engineering-v3.38.2/skills/ce-work/references/execution-engines.md) · [External execution](https://github.com/EveryInc/compound-engineering-plugin/blob/compound-engineering-v3.38.2/skills/ce-work/references/cross-model-execution.md)

For one coordinated PR workflow with a selected implementation engine, use
CE's `lfg` and name the engine for implementation. For work that must run on
a specific remote host or account, use Railyard's fleet workflow.
[CE stage routing](https://github.com/EveryInc/compound-engineering-plugin/blob/compound-engineering-v3.38.2/skills/lfg/references/stage-routing.md) ·
[Fleet orchestration](/skills/orchestrate/)
