---
layout: default
title: Local routing learning
parent: Delivery
nav_order: 4
---

# Let the router learn locally

Use observed delivery outcomes to improve estimates while policy remains operator-owned. Railyard learns from bounded route metadata on the local machine, offers that evidence only as a tier-zero tiebreak, and leaves eligibility, privacy, budgets, and declared tier order under operator control.

## The run

The operator enables learning and completes several comparable work units. Terminal reconciliation records categorical work shape, carrier, effort, meter facts, duration, retries, verification, and rating under opaque outcome IDs. After five samples, the router can apply a bounded estimate adjustment inside the already-eligible tier. The turn is the fifth comparable settlement. The run closes when `learning inspect` reports the aggregate, the catalog lists `learnedEstimate` in tier-zero `softPriorities`, and the next decision's `learning` block reports `provenance: "learned_estimate"` with a route-effect `tieBreakInfluence`.

## What is retained

The store is local-only, content-free, and bounded to 200 outcomes and 256 aggregates. It keeps no prompt, file, path, title, endpoint, provider output, or credential. Base demand groups role, risk, context class, and normalized work shape; route effects add model, carrier version, effort, and billing surface.

Learning begins only after a five-sample floor. Its forecast hint is capped at plus or minus 20 percent, and a lower learned estimate never lowers a `hardAdmission` or `strict` forecast. Only a catalog that explicitly lists `learnedEstimate` among tier-zero `softPriorities` uses the route-effect tiebreak.

## Operate the learning store

```text
railyard:model-routing learning inspect
railyard:model-routing learning disable
railyard:model-routing learning enable
railyard:model-routing learning clear
```

`inspect` reports bounded counts and aggregates. `disable` preserves the stored observations while pausing use and collection. `enable` resumes the configured behavior. `clear` removes learning samples and aggregates while leaving settled accounting evidence intact.

```text
learning=enabled outcomes=37 aggregates=9
work_class=implementation.mechanical samples=8
route=codex-luna effort=max adjustment=-12%
eligibility=unchanged privacy=unchanged budget_floor=unchanged
```

The mechanism improves a route only inside the policy the operator already approved. Read [owning your routing policy](/delivery/model-routing/policy/) for the `learning` key and [audit](/delivery/audit/) for the human lessons and upstream suggestions that remain deliberately separate.
