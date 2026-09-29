---
name: model-routing
description: "Choose a model and reasoning effort for native subagents in Claude Code or Codex, or review an allocation on request. Use before dispatching substantive delegated work, or when changing a child's model or effort."
---

# Model routing

Choose the model and reasoning effort together for each assignment. This skill
only guides native delegation. It does not create tasks, dispatch workers, or
replace the delivery or review workflow.

When `TYPESAFE_API_KEY` is set and the choice among the pairs below is
genuinely open, consult [`railyard:jev`](../jev/SKILL.md) in allocation mode
with 2 to 4 eligible pairs from this list, including the default pair. Then
apply the guidance below. Skip Jev when a default clearly applies. The
user's explicit model or effort choices always win.

## Claude Code

- **Opus 5.5** (`opus`, `claude-opus-5-5`) is the default for substantive or
  judgment-heavy subagents: design, ambiguous debugging, coordination, and
  reviewers. Choose effort on purpose: `medium` for ordinary work, `high` for
  multi-file or ambiguous work. The Thermos and review-bakeoff
  evidence is on Opus 5.5.
- **Fable 5.1** (`fable`) is for frontier-hard problems, long autonomous runs,
  or work where Opus 5.5 fell short.
- **Sonnet 5.5** (`sonnet`, Claude Code 2.1.284 or later; earlier versions
  resolve `sonnet` to Sonnet 5) at `low` or `medium` is for well-scoped work
  with a clear acceptance check: bug fixes with a repro, bounded edits, test
  fixes, PR-feedback fixers, docs, and fast parallel fan-out. Don't raise it
  to `high` or above as a stand-in for Opus; use Opus 5.5 at `medium`. For
  long, cache-heavy, judgment-heavy loops, prefer Opus: cache reads cost the
  same.
- **Haiku 4.5** (`haiku`) is for read-only search. It has no effort setting.

The Agent tool's `model` parameter accepts only these aliases. Effort comes
from the session or from a subagent definition's `effort` field. `fork`
subagents inherit both model and effort.

Both 5.5 models apply cyber safeguards, so security-adjacent tasks may hit
refusals or fallbacks. Report them; don't silently switch models.

## Codex

- **GPT-6.1 Sol** (`gpt-6.1-sol`) at `medium` is the default for substantive
  work and subagents. Use `high`, `xhigh`, or `max` when complexity or
  verification warrants more effort. Do not select legacy GPT-6 Sol.
- **GPT-6 Luna** is for routine extraction, classification, repetitive
  transforms, and narrowly specified edits with an inexpensive acceptance
  check and little engineering judgment. A small or bounded task alone does
  not qualify: use Sol 6.1 for implementation, debugging, review, planning,
  and ambiguous or cross-file decisions. Use deterministic tools first for
  fully mechanical work.
- **GPT-6 Astra** is a rare escalation after a concrete Sol 6.1 shortfall
  remains at suitable effort. Record the gap and acceptance check; a task
  being hard, high-risk, or a review does not by itself justify Astra.
  OpenAI reports an advantage on the most difficult scientific research;
  near-Astra performance elsewhere is not a guarantee on every task.
- **Daybreak** (`gpt-daybreak-blue-latest`) is for defensive security work
  when the surface exposes it.
- **Codex review** (`codex review`, including the end-of-PR review) defaults
  to GPT-6.1 Sol at `high`:
  `codex review --base <base> -c model=gpt-6.1-sol -c review_model=gpt-6.1-sol -c model_reasoning_effort=high`.
  Astra requires the same demonstrated-gap rationale as any other escalation.

The API and standard Codex selector is `gpt-6.1-sol`. A provider may expose
`openai/gpt-6.1-sol` instead; use the exact selector in the live native schema
for that surface, including both `model` and `review_model` for review.
If Sol 6.1 is unavailable, report the blocker; do not silently fall back to
GPT-6 Sol or Astra.

Check the live `spawn_agent` schema before allocating. On surfaces with
`fork_turns`, overrides require `"none"` or a history count; a full-history
fork (`"all"` or omitted) inherits the parent. On surfaces with
`fork_context`, use `false` for an explicit allocation. Do not send fields
from another schema. Give a child without full history a self-contained brief.

## Judgment

- Mechanical work runs through tools, not agents. Don't spawn a model to run
  a command or apply an edit you already know.
- Inheriting the parent's settings is fine when it is a deliberate choice.
- For a cross-family second opinion, use the other family: a Codex child from
  Claude Code, or a Claude subagent from Codex, when that is available. From
  Claude Code, run the Codex CLI directly:
  `codex exec -m <model> -c model_reasoning_effort=<effort> -s read-only -o <file> '<brief>'`
  (a writable sandbox only when the child owns edits).
- Judge cost by the accepted result: count retries, repairs, and child agents,
  not the per-token price.
- If a requested model, effort, or history mode isn't supported, say so. Don't
  silently fall back.
- Report requested and observed allocation in one sentence. If the runtime
  doesn't expose the actual model or effort, call it unverified.

See the [native invocation reference](../../references/harness-model-invocation.md)
for exact IDs, effort ranges, prices, and dispatch examples. When the live
tool schema disagrees with that reference, the schema is correct.
