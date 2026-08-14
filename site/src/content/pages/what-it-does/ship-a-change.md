---
layout: default
title: Ship a change
parent: Practices
nav_order: 1
---

# Ship a change

A webhook worker drops retries under load, and the fix matters only when it reaches the base branch and survives its focused check. State the outcome, run the change as one bounded delivery, and stay with it through review, merge, ancestry proof, and post-merge validation. The handoff is a working change with a receipt.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

`railyard:deliver` provides the front door for this outcome.

## The run

The operator asks for webhook retries to survive load and land on the base branch. Railyard binds that outcome to one delivery lane, carries the change through implementation and paired review, and settles the pull request against current evidence. The turn comes when findings or stale settlement evidence send the work back instead of letting an old green state pass. The run closes when merge ancestry and the focused post-merge check are visible in the receipt.

## What happens

The request enters intent routing, receives an explicit model and effort, moves through plan and implementation, passes the paired review gate, and reaches the delivery tail. The tail settles the pull request, proves the merge commit is reachable from the base branch, and runs the smallest applicable check.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) records the terminal evidence contract: merge ancestry plus a real post-merge check.

## Next

[Harden the review path](/what-it-does/harden-review/) or [read delivery lifecycle details](/delivery/lifecycle/).
