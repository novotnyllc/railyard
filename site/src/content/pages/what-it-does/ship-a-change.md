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

Routine implementation runs natively. `railyard:deliver` can coordinate useful Compound Engineering (CE) stages and carry their result to the requested merge boundary.

## Illustrative workflow

The operator asks for webhook retries to survive load and land on the base branch. Native tools implement the bounded fix, with CE stages selected automatically where useful. CE owns review settlement and CI monitoring; findings and failing checks return to that same owner for repair. The requested result is complete only after the merge is observed and its focused post-merge check supports the outcome.

## What happens

Choose model and effort together when delegating: Opus 5.5 at `medium` in Claude Code or GPT-6 Sol at `medium` in Codex, escalating to Fable 5.1 or Astra when the work is harder. Omitting the model means the child inherits. Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR. Resolve CE when the selected stage needs it; optional specialist review feeds its existing loop. After CE settles review and CI, the authorized delivery tail verifies merge ancestry and the smallest applicable post-merge check.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) records the terminal evidence contract: merge ancestry plus a real post-merge check.

## Next

[Harden the review path](/what-it-does/harden-review/) or [read delivery lifecycle details](/delivery/lifecycle/).
