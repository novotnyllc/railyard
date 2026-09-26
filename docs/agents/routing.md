# Delivery routing

Use native tools for ordinary local work and select Compound Engineering
stages when they help: `ce-debug` for difficult diagnosis, `ce-plan` for
substantial planning, `ce-code-review` for meaningful review, and `lfg` for a
coordinated full workflow. `railyard:deliver` coordinates these stages when
the user asks to deliver or ship.

- Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or
  pushing user-requested commits to an existing PR, and `gh-stack` for related
  dependent PRs.
- CE alone owns review settlement and CI/PR monitoring. Reuse the active CE
  watcher; Deliver completes an authorized merge and post-merge proof through
  the CE snapshot handoff without another settlement gate.
- An explicit Deliver request authorizes the full lifecycle by default:
  commit, push, PR, CE settlement, merge, required release or deployment, and
  consumer verification. Plan-only, diagnosis-only, review-only, PR-only, and
  local-only requests stop at their result. Internal skill selection does not
  expand the user's request, and child handoffs and bounded waits are not
  completion.
- Model and effort choice: `railyard:model-routing` (Claude Code defaults to
  Opus 5.5 for substantive subagents; details in
  [model invocation](../../plugins/railyard/references/harness-model-invocation.md)).
- Native subagents are the default for delegation. Visible user-owned tasks
  require explicit user direction; fleet inventory or account configuration is
  not that direction.
- `railyard:orchestrate` is only for explicitly requested fleet/account
  allocation or delegated remote-agent work. A bounded one-host admin
  operation uses its named CLI or `roundhouse:remote-mac` over SSH directly.
- Keep startup small and free of dependency installation. Audits,
  retrospectives, and process cleanup run on request.

Repository and user title instructions take precedence over the default
[task-title guidance](../../plugins/railyard/references/task-titles.md).
Dispatch-gate payload notes for maintainers are in
[native dispatch](native-dispatch.md).
