---
layout: default
title: Model routing
parent: Skills
nav_order: 3
---

# Model routing

`railyard:model-routing` is short guidance for choosing a model and reasoning effort together when you delegate work. It uses each harness's native controls. It doesn't create tasks, dispatch workers, or run a separate routing CLI.

## Defaults

- **Claude Code:** Opus 5.5 (`opus`, `claude-opus-5-5`, Claude Code 2.1.280 or later, `low`–`max` effort, default `medium`) handles substantive subagent work. Escalate to Fable 5.1 (`claude-fable-5-1`) for frontier-hard or long autonomous work. Use Sonnet 5 for bounded edits and Haiku 4.5 for read-only search.
- **Codex:** GPT-6 Sol at `medium` is the baseline. Use Luna for bounded work and Astra when the work is hard. Daybreak fits defensive security work when the harness exposes it.

An explicit user choice or fixed role wins. Leaving the model unset means the child inherits the parent's model. Use deterministic tools directly for mechanical work.

## How it works

Check the active tool's model selectors, effort values, and history constraints, then request the chosen pair or let the child inherit. With `TYPESAFE_API_KEY` set, [Jev](/skills/jev/) recommends among the eligible pairs; if it's uncertain or unavailable, the defaults above apply.

```text
assignment=bounded-engineering
model=gpt-6-sol effort=medium
reason=ordinary engineering baseline
```

## Proof point

Dispatch arguments show what was requested. Use runtime metadata for the model and effort that actually ran; if there is none, mark them unverified. If a selection isn't supported, report it and don't substitute another model. Judge efficiency by accepted results and the whole assignment's cost and time.

## Source

Ships in the `railyard` plugin. Go deeper: [model routing](/delivery/model-routing/).
