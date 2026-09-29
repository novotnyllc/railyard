---
layout: default
title: Model routing
parent: Skills
nav_order: 3
---

# Model routing

`railyard:model-routing` is short guidance for choosing a model and reasoning effort together when you delegate work. It uses each harness's native controls. It doesn't create tasks, dispatch workers, or run a separate routing CLI.

## Defaults

- **Claude Code:** Opus 5.5 (`opus`, `claude-opus-5-5`, Claude Code 2.1.280 or later, `low`–`max` effort, default `medium`) handles substantive or judgment-heavy subagent work, including reviewers. Escalate to Fable 5.1 (`claude-fable-5-1`) for frontier-hard or long autonomous work. Use Sonnet 5.5 (`sonnet`, Claude Code 2.1.284 or later; earlier versions resolve `sonnet` to Sonnet 5) at `low` or `medium` for well-scoped work with a clear acceptance check, such as bug fixes, test fixes, bounded edits, docs, and fast fan-out. Don't raise it to `high` as a stand-in for Opus. Use Haiku 4.5 for read-only search.
- **Codex:** GPT-6.1 Sol at `medium` is the baseline for implementation, debugging, planning, and ambiguous or multi-file work, even when small or bounded. Use Luna only for routine or repetitive work with no substantial engineering judgment and an inexpensive acceptance check, such as extraction, classification, large repetitive transforms, or narrowly specified edits. Raise Sol 6.1 to `high`, `xhigh`, or `max` for justified demanding work; Codex reviews default to Sol 6.1 at `high`. Astra is a rare, explicitly justified escalation after a concrete residual failure or quality gap on Sol 6.1. Daybreak fits defensive security work when the harness exposes it.

An explicit user choice or fixed role wins. Leaving the model unset means the child inherits the parent's model. Use deterministic tools directly for mechanical work.

## How it works

Check the active tool's model selectors, effort values, and history constraints, then request the chosen pair or let the child inherit. `gpt-6.1-sol` is the API base ID; a provider-backed catalog may expose `openai/gpt-6.1-sol`. Use the exact live selector and do not assume every host supports the model. With `TYPESAFE_API_KEY` set, [Jev](/skills/jev/) recommends among the eligible pairs; if it's uncertain or unavailable, the defaults above apply.

```text
assignment=bounded-engineering
model=gpt-6.1-sol effort=medium
reason=ordinary engineering baseline
```

## Proof point

Dispatch arguments show what was requested. Use runtime metadata for the model and effort that actually ran; if there is none, mark them unverified. If a selection isn't supported, report it and don't substitute another model. Judge efficiency by accepted results and the whole assignment's cost and time.

## Source

Ships in the `railyard` plugin. Go deeper: [model routing](/delivery/model-routing/).
