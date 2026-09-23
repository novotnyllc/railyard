# Delivery routing

Use native tools for ordinary local work and automatically select relevant
Compound Engineering stages when they help. Difficult diagnosis can use
`ce-debug`, substantial planning `ce-plan`, meaningful review `ce-code-review`,
and a coordinated full workflow `lfg`. `railyard:deliver` coordinates these
stages when needed; an ordinary fix does not require LFG, contracts, receipts,
or audit artifacts.

- Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing
  user-requested commits to an existing PR. Use `gh-stack` for related
  dependent PRs when appropriate.
- CE alone owns review settlement and CI/PR monitoring. Reuse the active CE
  watcher and its continuations. Deliver completes an authorized merge and
  post-merge proof without adding another settlement gate.
- Honor the requested endpoint and persistent authorization. Plan-only,
  review-only, PR-only, and local-only work stop at that result; authorized
  delivery continues to its real acceptance surface.
- An explicit Deliver implementation/fix request authorizes the full lifecycle
  by default: commit, push, PR, CE settlement, merge, required release or
  deployment, and consumer verification. Preserve explicit narrower stops;
  internal skill selection alone does not expand the user's request. Child
  handoffs and bounded waits are intermediate states, not delivery completion.
- Choose model AND reasoning effort for each agent assignment through
  `railyard:model-routing`; routine native tool use needs no intake ritual.
  GPT-6 Sol at medium effort is the baseline for ordinary Codex engineering;
  raise effort for demanding work and reserve Astra for a specific need. Mechanical
  operations can use deterministic tools directly.
- When `TYPESAFE_API_KEY` is present, use `railyard:jev` by default for bounded
  model-and-effort selection, workflow choice, evidence selection, work priority,
  and review-triage judgments throughout delivery. Explicit choices,
  deterministic work, and offline/privacy restrictions take precedence. Its
  typed suggestions do not grant authority; failures and uncertainty leave
  ordinary Railyard reasoning in charge. Startup advertises it without
  making a network request or recording the key.
- Deliberate inheritance is valid. A native full-history fork cannot accept
  model/effort overrides; choose a supported limited/no-history fork and a
  sufficient brief when changing settings. Fixed roles keep their authoritative
  settings. Details live in
  [model invocation](../../plugins/railyard/references/harness-model-invocation.md).
- Native subagents are the default for ordinary delegation. Visible user-owned
  tasks require explicit user direction to create or fork them. Existing fleet
  inventory or account configuration is not that direction.
- `railyard:orchestrate` is for explicitly requested fleet/account allocation or
  delegated remote-agent work. Load advanced admission, transport, readiness,
  and accounting contracts only for that selected scope. A bounded one-host
  admin operation uses its named CLI or `roundhouse:remote-mac` over SSH directly.
- Keep startup small and dependency installation out of it. Retrospectives,
  audit artifacts, legacy carrier receipts, and process cleanup are on-demand
  capabilities. Verify requested behavior and required repository checks;
  report results and blockers proportionately.

Repository/user title instructions take precedence over the optional
[task-title guidance](../../plugins/railyard/references/task-titles.md).
