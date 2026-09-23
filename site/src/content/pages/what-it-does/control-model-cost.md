---
layout: default
title: Control model cost
parent: Practices
nav_order: 10
---

# Control model cost

Compare model and effort choices by accepted task outcomes and total cost and time, including children, retries, and repairs. GPT-6 Sol at `medium` is the ordinary engineering candidate; a lower per-call price alone does not establish better efficiency.

## Easy path

```text
> Choose a model and reasoning effort for this task, explain the tradeoff, and respect my budget.
```

`railyard:model-routing` supports deliberate native allocation and configured budget controls when needed. Use deterministic tools directly for mechanical work.

Railyard itself is free and open source (MIT); you pay only your own Claude/Codex usage, billed exactly as any other session in that harness.

## Illustrative comparison

For a migration with mechanical edits and a difficult semantic seam, use deterministic edits where suitable and choose a model/effort pair for the reasoning work. Start with Sol at `medium` for ordinary reasoning; use Astra at `high` when the seam needs stronger judgment. Evaluate the whole accepted result before claiming savings; this example reports no benchmark result. [Read the worked examples](/delivery/model-routing/worked-runs/).

## What happens

Choose both model and effort, or deliberately inherit both through a supported native mode. Configured routes can additionally apply privacy, transport, admission, and budget policy. Forecasts are planning evidence; observed usage and accepted results establish actual efficiency. Disclose an unavailable selection rather than silently substituting a cheaper route.

## Proof point

The [model-routing section](/delivery/model-routing/) explains allocation and the optional strict route lifecycle. Use existing run evidence to compare accepted work, total usage, elapsed time, and retries; no routine benchmark or retrospective artifact is required.

## Next

[Read model routing](/delivery/model-routing/) or [work across harnesses](/what-it-does/work-across-harnesses/).
