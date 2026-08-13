---
layout: default
title: Control model cost
parent: What it does
nav_order: 10
---

# Control model cost

Match model and effort to the work shape, then carry the choice in the dispatch and run record.

## Easy path

```text
> Use the smallest suitable route for this task and show the budget evidence.
```

`railyard:model-routing` classifies the work before a carrier starts it.

## What happens

The router resolves role, work shape, privacy, transport, and budget policy into one selected carrier. Implementation, mechanical work, orchestration, and review can each use their own tier. Forecasts and route disclosures make the decision inspectable.

## Proof point

The [routing reference](/delivery/routing/) freezes `model`, `effort`, carrier, and budget effect before dispatch, then binds the decision to an action receipt.

## Next

[Read routing](/delivery/routing/) or [work across harnesses](/what-it-does/work-across-harnesses/).
