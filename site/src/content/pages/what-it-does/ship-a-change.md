---
layout: default
title: Ship a change
parent: What it does
nav_order: 1
---

# Ship a change

Say what should change and receive a merged result with a focused post-merge receipt.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

`railyard:deliver` is the front door for this outcome.

## What happens

The request enters intent routing, receives an explicit model and effort, moves through plan and implementation, passes the paired review gate, and reaches the delivery tail. The tail settles the pull request and proves the merge commit is reachable from the base branch before running the smallest applicable check.

## Proof point

The lifecycle source records the terminal evidence contract: merge ancestry plus a real post-merge check. Source: `railyard/docs/lifecycle.md`.

## Next

[Harden the review path](/what-it-does/harden-review/) or [read delivery lifecycle details](/delivery/lifecycle/).
