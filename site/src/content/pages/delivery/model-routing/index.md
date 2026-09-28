---
layout: default
title: Model routing
parent: Delivery
nav_order: 2
---

# Model routing

Choose the model and reasoning effort together for each delegated assignment, using the harness's own controls. Railyard supplies guidance, not a router: there is no routing CLI, catalog, admission step, or receipt ledger. Leaving the model unset means the child inherits the parent's model.

## Claude Code

| Model | Selector | Use it for |
| --- | --- | --- |
| Opus 5.5 | `opus` (`claude-opus-5-5`) | The default for substantive or judgment-heavy work: design, ambiguous debugging, coordination, and reviewers |
| Fable 5.1 | `fable` (`claude-fable-5-1`) | Escalation for frontier-hard or long autonomous work |
| Sonnet 5.5 | `sonnet` (`claude-sonnet-5-5`) | At `low` or `medium`: well-scoped work with a clear acceptance check, such as bug fixes with a repro, bounded edits, test fixes, PR-feedback fixers, docs, and fast parallel fan-out |
| Haiku 4.5 | `haiku` | Read-only search and lookup |

Opus 5.5 requires Claude Code 2.1.280 or later and accepts `low` through `max` effort, with `medium` as the default. Start a session with `--model` and `--effort`. The `Agent` tool takes a model alias; effort comes from the session or from a subagent definition that sets both `model` and `effort`. Fork subagents always inherit the parent's settings.

Sonnet 5.5 (`sonnet`, Claude Code 2.1.284 or later; earlier versions resolve `sonnet` to Sonnet 5) runs at `low` or `medium`. Don't raise it to `high` or above as a stand-in for Opus; use Opus 5.5 at `medium`. Its cache reads cost the same as Opus 5.5, so prefer Opus for long, cache-heavy, judgment-heavy loops. Both 5.5 models apply cyber safeguards, so security-adjacent tasks may hit refusals or fallbacks.

## Codex

| Model | Effort | Use it for |
| --- | --- | --- |
| GPT-6 Sol | `medium` | The baseline for ordinary engineering |
| GPT-6 Luna | `low` or `medium` | Bounded, repetitive work |
| GPT-6 Astra | `high` | Hard or high-risk work, or when Sol has fallen short |
| Daybreak | as exposed | Defensive security work, when the harness exposes it |

In `spawn_agent`, overriding `model` or `reasoning_effort` requires `fork_turns: "none"` or a limited history count, plus a brief with enough context for the child. Full-history forks inherit both settings. Don't make `max` the default.

## Choosing well

- An explicit user choice, repository constraint, or fixed role wins.
- Use deterministic tools directly for mechanical work.
- When `TYPESAFE_API_KEY` is set, [Jev](/skills/jev/) recommends among the eligible pairs you supply. If Jev is uncertain or unavailable, fall back to this guidance.
- Judge cost by the whole accepted assignment, including children, retries, and repairs. Per-token prices alone don't show which pair finishes the task more cheaply.
- If the harness cannot run the selected model or effort, say so and don't swap in something else. Dispatch arguments show what you requested; only runtime metadata shows what ran.

See the [model routing skill](/skills/model-routing/) and [control model cost](/what-it-does/control-model-cost/).
