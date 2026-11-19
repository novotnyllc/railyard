# Delivery routing

Use native tools for ordinary local work and select Compound Engineering
stages when they help: `ce-debug` for difficult diagnosis, `ce-plan` for
substantial planning, and `lfg` for a coordinated full workflow.
`railyard:deliver` coordinates these stages for implementation and shipping
requests.

- Use the [pre-push review policy](../../plugins/railyard/references/whole-candidate-review.md).
  Default `light` runs one independent cumulative review before first
  publication and focused review for later repairs, with broad review again
  when design or risk changes materially or prior coverage is uncertain.
- For opt-in full review, run `railyard:thermos` and
  `codex review --base <base>` with the configured Codex review settings. Give
  both reports to the CE owner. The [historical review bakeoff](../../site/src/content/pages/delivery/review-bakeoff.md)
  records the original comparison.
- Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or
  pushing user-requested commits to an existing PR, and `gh-stack` for related
  dependent PRs.
- CE alone owns review settlement and CI/PR monitoring, settling each thread
  by the [review feedback settlement policy](../../plugins/railyard/references/review-feedback-settlement.md).
  Batch feedback and keep the active CE watcher. After one shared automated repair batch, newly raised minor findings default to follow-up
  issues. Real blockers still need resolution.
- With standing delivery authority, plain implementation and fix requests run
  through confirmed merge via the
  repository's merge process. Shipping requests or repository requirements add
  any required release or deployment and consumer verification. Plan-only,
  diagnosis-only, review-only, PR-only, and local-only requests stop at their
  stated endpoint.
- Native work uses the harness defaults and any explicit user settings. For
  external implementation, let CE resolve the engine and model. The owning
  chat can run separate `ce-work` invocations for distinct scopes and engines.
  [Work across harnesses](../../site/src/content/pages/what-it-does/work-across-harnesses.md)
- Native subagents are the default for delegation. Visible user-owned tasks
  require explicit user direction; fleet inventory or account configuration is
  not that direction.
- `railyard:orchestrate` is only for explicitly requested fleet/account
  allocation or delegated remote-agent work. A bounded one-host admin
  operation uses its named CLI or `roundhouse:remote-mac` over SSH directly.
- Keep startup focused on delivery and review guidance.

Repository and user title instructions take precedence over the default
[task-title guidance](../../plugins/railyard/references/task-titles.md).
