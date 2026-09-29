---
layout: default
title: Control model cost
parent: Practices
nav_order: 10
---

# Control model cost

Compare model and effort choices by accepted task outcomes and by total cost and time, including children, retries, and repairs. A lower per-call price doesn't, on its own, mean better efficiency.

## Easy path

```text
> Choose a model and reasoning effort for this task and explain the tradeoff.
```

`railyard:model-routing` gives the defaults for each harness. In Claude Code, Opus 5.5 at `medium` handles substantive subagent work, Sonnet 5.5 at `low` or `medium` takes well-scoped edits, bug fixes, and docs, and Haiku 4.5 takes read-only search. In Codex, GPT-6.1 Sol at `medium` is the baseline for implementation, debugging, planning, and ambiguous or multi-file work, even when small or bounded. Use Luna only for routine or repetitive work with no substantial engineering judgment and an inexpensive acceptance check, such as extraction, classification, large repetitive transforms, or narrowly specified edits. Use deterministic tools first for fully mechanical work.

At the published Standard API rates, Sol 6.1 input and output tokens cost 20× Luna's and cached input costs 10× Luna's. See the official [Sol 6.1 pricing](https://developers.openai.com/api/docs/models/gpt-6.1-sol.md) and [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna.md). Both apply higher full-request rates above 272K input tokens. These token-price ratios do not establish savings per accepted task; use Luna only when the work meets the limits above.

Railyard itself is free and open source (MIT). You pay only for your own Claude or Codex usage, billed like any other session in that harness.

## Illustrative comparison

A migration with mechanical edits and one difficult semantic seam: make the mechanical edits with deterministic tools, and give the seam to the default model at a deliberate effort. For Claude Code, escalate to Fable 5.1 when the seam needs it. For demanding Codex work, raise Sol 6.1 to `high`, `xhigh`, or `max` when justified. Use Astra only as a rare, explicitly justified escalation after a concrete residual failure or quality gap on Sol 6.1. Evaluate the whole accepted result before claiming savings; this example reports no benchmark result.

## What happens

Choose both model and effort, or let the child inherit. If a selection isn't available, say so; don't switch to a cheaper model without telling anyone. Observed usage and accepted results are what establish efficiency.

## Next

[Read model routing](/delivery/model-routing/) or [work across harnesses](/what-it-does/work-across-harnesses/).
