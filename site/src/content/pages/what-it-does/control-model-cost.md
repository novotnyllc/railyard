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

`railyard:model-routing` gives the defaults for each harness. In Claude Code, Opus 5.5 at `medium` handles substantive subagent work, Sonnet 5 takes bounded edits, and Haiku 4.5 takes read-only search. In Codex, GPT-6 Sol at `medium` is the baseline and Luna takes bounded work. Use deterministic tools directly for mechanical work.

Railyard itself is free and open source (MIT). You pay only for your own Claude or Codex usage, billed like any other session in that harness.

## Illustrative comparison

A migration with mechanical edits and one difficult semantic seam: make the mechanical edits with deterministic tools, and give the seam to the default model at a deliberate effort. Escalate (Fable 5.1 in Claude Code, Astra in Codex) only when the seam needs it. Evaluate the whole accepted result before claiming savings; this example reports no benchmark result.

## What happens

Choose both model and effort, or let the child inherit. If a selection isn't available, say so; don't switch to a cheaper model without telling anyone. Observed usage and accepted results are what establish efficiency.

## Next

[Read model routing](/delivery/model-routing/) or [work across harnesses](/what-it-does/work-across-harnesses/).
