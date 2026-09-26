---
name: model-routing
description: "Choose a model and reasoning effort for native subagents in Claude Code or Codex, or review an allocation on request. Use before dispatching substantive delegated work, or when changing a child's model or effort."
---

# Model routing

Choose the model and reasoning effort together for each assignment. This skill
only guides native delegation. It does not create tasks, dispatch workers, or
replace the delivery or review workflow.

When `TYPESAFE_API_KEY` is set, consult [`railyard:jev`](../jev/SKILL.md) in
allocation mode with the eligible pairs, then apply the guidance below. The
user's explicit model or effort choices always win.

## Claude Code

- **Opus 5.5** (`opus`, `claude-opus-5-5`) is the default for substantive
  subagents. Choose effort on purpose: `medium` for ordinary work, `high` for
  multi-file or ambiguous work.
- **Fable 5.1** (`fable`) is for frontier-hard problems, long autonomous runs,
  or work where Opus 5.5 fell short.
- **Sonnet 5** (`sonnet`) is for bounded, well-specified edits.
- **Haiku 4.5** (`haiku`) is for read-only search. It has no effort setting.

The Agent tool's `model` parameter accepts only these aliases. Effort comes
from the session or from a subagent definition's `effort` field. `fork`
subagents inherit both model and effort.

## Codex

- **GPT-6 Sol** at `medium` is the baseline for substantive work. Raise it to
  `high` when the task's complexity or verification burden calls for it.
- **GPT-6 Luna** is for bounded, repetitive work.
- **GPT-6 Astra** is for hard or high-risk work, or when Sol fell short.
- **Daybreak** (`gpt-daybreak-blue-latest`) is for defensive security work
  when the surface exposes it.

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
