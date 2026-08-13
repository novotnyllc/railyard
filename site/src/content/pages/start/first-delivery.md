---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Get a reviewed, merged change with an observable post-merge receipt from one sentence on the machine you already use.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

`railyard:deliver` is the front door for this outcome.

## What happens

1. The request is classified and model routing freezes a model and effort for the work unit.
2. The implementation workflow plans and changes the source in its own working boundary.
3. Thermos runs correctness and code-quality review lenses against the same packet.
4. The branch, pull request, checks, independent review, and merge are settled.
5. The merged commit is checked for reachability from the base branch and the smallest applicable post-merge check runs.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) documents the observable terminal pair: `git merge-base --is-ancestor <merge-commit> origin/<base>` plus a real post-merge check.

## Scope

The first delivery is a one-machine path. Add fleet placement later through [run work on another machine](/what-it-does/run-work-on-another-machine/).

Next: [read the full lifecycle](/delivery/lifecycle/).
