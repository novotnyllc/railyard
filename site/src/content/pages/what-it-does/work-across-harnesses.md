---
layout: default
title: Work across harnesses
parent: What it does
nav_order: 6
---

# Work across harnesses

Use one request across Claude Code and Codex while the route records the harness, model, effort, and transport for each work unit.

## Easy path

```text
> Route this work to the best available harness and show the dispatch decision.
```

`railyard:model-routing` resolves the work class before the workflow starts.

## What happens

The router derives a bounded work class from ambiguity, novelty, repetition, decomposability, volume, semantic risk, and verification strength. A selected route freezes model and effort; cross-harness movement is an explicit opt-in seam with its own carrier and receipt.

## Proof point

The [Model routing reference](/delivery/model-routing/) identifies the contract as `railyard/model-routing/v1` and requires explicit model and effort on every dispatch.

## Next

[Control model cost](/what-it-does/control-model-cost/) or [read routing details](/delivery/routing/).
