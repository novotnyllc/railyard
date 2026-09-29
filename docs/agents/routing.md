# Delivery routing

Use native tools for ordinary local work and select Compound Engineering
stages when they help: `ce-debug` for difficult diagnosis, `ce-plan` for
substantial planning, and `lfg` for a coordinated full workflow.
`railyard:deliver` coordinates these stages when the user asks to deliver or
ship.

- End-of-PR review: run `railyard:thermos` and `codex review --base <base>`
  in parallel, and feed their findings to the CE owner. The Codex review model
  and effort come from `railyard:model-routing`: Sol 6.1 at high by default.
  Historical evidence, collected before Sol 6.1 launched: in a bakeoff on
  five past commits with known later-fixed bugs, Thermos caught 6.5 of 8
  ground-truth units, `ce-code-review` caught 4 at about twice the tokens and
  time, and Codex review on GPT-6 Astra at high caught 2, including the one
  nothing else found, with no false positives.
  The old Astra-versus-Luna comparison does not establish an Astra advantage
  over Sol 6.1. Recheck cost per accepted review before escalating; review
  alone is not a reason to select Astra.
- OpenAI placement evidence (2026-09-29, not Railyard measurements):
  [GPT-6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/) offers
  near-Astra performance at one-fifth of standard input/output list prices.
  It matches Astra on DeepSWE v1.1 in OpenAI's evaluation; Astra retains an
  advantage on the most difficult scientific research. Use Sol 6.1 for
  ordinary work, subagents, and reviews, with effort suited to the task.
  Reserve Astra for a demonstrated residual gap, and Luna for routine work
  with little engineering judgment and an inexpensive acceptance check.
- Model placement evidence (2026-09-28, not Railyard measurements):
  For Sonnet 5.5, Anthropic reports it 30% faster than Sonnet 5 and up to 30% cheaper per task
  on well-scoped everyday tasks. Artificial Analysis ranks it second to Opus 5.5
  on its Intelligence Index (56). It scores 70.6% on Terminal-Bench against Opus
  5.5's 66.4%, a gap commenters partly attribute to Opus hitting safeguard
  fallbacks more often. Practitioners report that Sonnet 5.5 at `high` or
  `xhigh` often costs about the same as Opus 5.5 at `low` or `medium` for
  similar results. Its cache reads cost $0.20/MTok, the same as Opus 5.5, so
  savings shrink in long cache-heavy loops. It is the first Sonnet with the cyber
  safeguards that both 5.5 models apply, so security-adjacent code can see
  refusals or fallbacks.

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
