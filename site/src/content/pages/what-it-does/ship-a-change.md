---
layout: default
title: Ship a change
parent: Practices
nav_order: 1
---

# Ship a change

A webhook worker drops retries under load, and the fix matters only when it reaches the base branch and survives its focused check. State the outcome, run the change as one bounded delivery, and stay with it through review, merge, ancestry proof, and post-merge validation. Report the merged change and the checks that verified it.

## Easy path

```text
> Fix the retry path in the webhook worker.
```

Routine implementation runs natively. `railyard:deliver` can coordinate useful Compound Engineering (CE) stages and carry their result to the requested merge boundary.

## Illustrative workflow

The operator asks for webhook retries to survive load and land on the base branch. Native tools implement the bounded fix, with focused CE stages where useful. CE owns review settlement and CI monitoring; findings and failing checks return to that same owner for repair. The requested result is complete only after the merge is observed and its focused post-merge check supports the outcome.

## What happens

Use native children for independent work. Use CE to assign an implementation engine when the request names one.

Run repository checks and one independent [local review](/delivery/gates/) of the cumulative change before publishing through `compound-engineering:ce-commit-push-pr`. CE watches feedback and CI, batches repairs, and links follow-up issues for separable work. Review each repair and its affected behavior before pushing. Follow the repository’s queue where configured and verify merge ancestry and the smallest applicable post-merge check.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) records the terminal evidence contract: merge ancestry plus a real post-merge check.

## Next

[Harden the review path](/what-it-does/harden-review/) or [read delivery lifecycle details](/delivery/lifecycle/).
