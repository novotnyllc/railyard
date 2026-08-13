---
layout: default
title: Convergence
parent: Roundhouse
nav_order: 2
---

# Pull, gate, apply, prove

One store edit travels through signed history, host-local review, canary evidence, an owning manager, and a journal record before another machine adopts it. The loop is crash-resumable and keeps each item's applied value visible while a decision is held.

![Fleet convergence pipeline: poll, fetch, resume, promote, fold, review, apply, journal, and publish, with clean exits and named holds.](/diagrams/m1-convergence.svg)

The diagram is the short path: a clean floor exits early; a passing verdict applies and journals; a blocked verdict holds and alerts by name.

## Run order

1. Poll the remote head and the local publication floor.
2. Fetch the shared history when the floor shows work.
3. Resume or close the prior run before opening a new one.
4. Promote a parseable snapshot to the reviewed reference.
5. Fold fleet, platform, group, and host layers at the reconcile point.
6. Build the hold set for unknown categories, class refusals, conflicts, and missing evidence.
7. Review the changed item and its ownership.
8. Apply a passing item through its native manager.
9. Journal `applied`, `satisfied`, `held`, `reverted`, `resolved`, `alive`, or `unreachable`.
10. Publish the evidence and nudge peers.

## Canary evidence

A non-canary host applies item X at digest D only when a canary journaled `applied` or `satisfied` for D at least 41 hours ago, nothing later reverted or held D, and the canary has published any record since the wait began. A silent canary closes the evidence window as a hold; it does not read as a pass.

The wait and the per-run removal caps bound how far a bad item can travel. `satisfied` counts as liveness because the desired identity is still present and observed. `held` carries a reason and keeps the prior value, so it cannot satisfy the canary gate.

## Journal outcomes

```yaml
- item: skills.my-review
  result: applied
  digest: sha256:7c1a...
- item: plugins.review-tools
  result: satisfied
  digest: sha256:12af...
- item: hooks.review-gate
  result: held
  reason: hook-approval
  alert: hook-approval-required
```

Conflict reconciliation follows a strict evidence ladder: signed history first, replicated journal second, self-asserted trailers last. A trailer can escalate a finding, but it cannot win the decision. A `resolved` record carries both parents and the rationale that produced the new reviewed commit.

Rollback is an ordinary signed change through review, canary, and apply. The revert-signature predicate is `applied → withdrawn → reincoming`; when that sequence appears, the returning value receives a fresh review rather than inheriting the old pass.

## Offline return

An offline host resumes from its reviewed reference, fetches the available history, reviews changed items, and publishes its own evidence when it reconnects. Parse errors and open conflicts keep affected items at their applied values and name the hold reason.

Next: [inspect the store](/roundhouse/store/) or [run the cadence and CLI](/roundhouse/operating/).
