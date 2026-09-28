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

- **GPT-6 Sol** at `medium` is the baseline for substantive work. Raise it to
  `high` when the task's complexity or verification burden calls for it.
- **GPT-6 Luna** is for bounded, repetitive, or bulk work.
- **GPT-6 Astra** is for hard or high-risk work, or when Sol fell short. It
  costs as much as Fable 5.1, so reserve it for hard work and review.
- **Daybreak** (`gpt-daybreak-blue-latest`) is for defensive security work
  when the surface exposes it.
- **Codex review** (`codex review`, including the end-of-PR review) always
  runs GPT-6 Astra at `high`. In a third-party code-review benchmark, Astra
  reached 96% precision while Luna missed 23 bugs Astra caught, at about $0.11
  versus $0.004 per review:
  `codex review --base <base> -c model=gpt-6-astra -c review_model=gpt-6-astra -c model_reasoning_effort=high`.

`spawn_agent` accepts `model` and `reasoning_effort` only with `fork_turns`
set to `"none"` or a history count. A full-history fork (`"all"` or omitted)
inherits the parent's settings and cannot take overrides. When you narrow the
history, give the child a brief that is complete on its own.

## Judgment

- Mechanical work runs through tools, not agents. Don't spawn a model to run
  a command or apply an edit you already know.
- Inheriting the parent's settings is fine when it is a deliberate choice.
- For a cross-family second opinion, use the other family: a Codex child from
  Claude Code, or a Claude subagent from Codex, when that is available.
- Judge cost by the accepted result: count retries, repairs, and child agents,
  not the per-token price.
- If a requested model, effort, or history mode isn't supported, say so. Don't
  silently fall back.
- Report requested and observed allocation in one sentence. If the runtime
  doesn't expose the actual model or effort, call it unverified.

See the [native invocation reference](../../references/harness-model-invocation.md)
for exact IDs, effort ranges, prices, and dispatch examples. When the live
tool schema disagrees with that reference, the schema is correct.
