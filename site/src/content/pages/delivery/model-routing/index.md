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
| GPT-6.1 Sol | `medium` | Implementation, debugging, planning, and ambiguous or multi-file work, even when small or bounded |
| GPT-6.1 Sol | `high`, `xhigh`, or `max` | Demanding work when the higher effort is justified; Codex reviews default to `high` |
| GPT-6 Luna | `low` or `medium` | Routine or repetitive work with no substantial engineering judgment and an inexpensive acceptance check: extraction, classification, large repetitive transforms, or narrowly specified edits |
| GPT-6 Astra | explicitly chosen | Rare escalation after a concrete residual failure or quality gap on Sol 6.1, with explicit justification |
| Daybreak | as exposed | Defensive security work, when the harness exposes it |

The API base model ID is `gpt-6.1-sol`. Use the exact selector exposed by the live harness rather than assuming every host accepts that ID: a provider-backed catalog may expose `openai/gpt-6.1-sol`. Check availability before dispatch and disclose an unsupported selection.

OpenAI describes Sol 6.1 as near-Astra performance, not universal equivalence. Its [official model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol.md) lists a 1,050,000-token context window, a 128,000-token maximum output, and API reasoning efforts `low`, `medium` (default), `high`, `xhigh`, and `max`; `ultra` is not a documented API effort. Standard prices per million tokens are $2 input, $0.10 cached input, $2.50 cache write, and $10 output for requests with up to 272K input tokens. Above 272K input tokens, the full request is priced at 2× input, cached-input, and cache-write rates and 1.5× output rates: $4 input, $0.20 cached input, $5 cache write, and $15 output per million tokens. These specifications do not establish task-level savings or benchmark superiority.

Small or bounded work can still require substantial engineering judgment; keep that work on Sol 6.1. Sol also owns review, with Codex reviews defaulting to `high`. Use deterministic tools first for fully mechanical work.

Hard work, high risk, or a review does not automatically select Astra. First identify a concrete residual failure or quality gap on Sol 6.1, then explicitly justify any Astra escalation. Codex reviews start with Sol 6.1 at `high`.

Check the live `spawn_agent` schema. A surface with `fork_turns` requires `"none"` or a limited history count for overrides; a surface with `fork_context` uses `false` for explicit allocation. Give a child without full history a self-contained brief. Full-history forks inherit both settings. Don't make `max` the default.

## Choosing well

- An explicit user choice, repository constraint, or fixed role wins.
- Use deterministic tools directly for mechanical work.
- When `TYPESAFE_API_KEY` is set, [Jev](/skills/jev/) recommends among the eligible pairs you supply. If Jev is uncertain or unavailable, fall back to this guidance.
- Judge cost by the whole accepted assignment, including children, retries, and repairs. Per-token prices alone don't show which pair finishes the task more cheaply.
- If the harness cannot run the selected model or effort, say so and don't swap in something else. Dispatch arguments show what you requested; only runtime metadata shows what ran.

See the [model routing skill](/skills/model-routing/) and [control model cost](/what-it-does/control-model-cost/).
