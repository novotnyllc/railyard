---
layout: default
title: Convergence
parent: Roundhouse
nav_order: 2
---

# Pull, gate, apply, prove

Treat convergence as an evidence pipeline. Move each store edit through signed history, host-local review, canary evidence, an owning manager, and a journal record before another machine adopts it. The loop is crash-resumable: the last applied value stays visible while a decision is held, and every rollout outcome stays explainable.

Roundhouse runs that loop through one repeatable host-owned cycle.

![Fleet convergence pipeline: poll, fetch, resume, promote, fold, review, apply, journal, and publish, with clean exits and named holds.](/diagrams/m1-convergence.svg)

### Sequence

1. **Poll.** The receiving host checks its head and the clean floor.
2. **Fetch.** New signed history enters the local run.
3. **Resume.** Crash recovery confirms the run can continue from an evidenced point.
4. **Promote.** The host passes the promotion gate before changing effective state.
5. **Fold.** Fleet, platform, group, and host layers resolve at the reconcile point.
6. **Review.** Unknown categories and class refusals remain visible in the hold set.
7. **Verdict.** Passing evidence can advance; a blocked result keeps the last value and names the reason.
8. **Apply.** The owning manager applies the exact reviewed item after canary evidence.
9. **Journal.** The host records `applied` or `satisfied` with item identity and digest.
10. **Publish.** The host publishes its evidence and nudges peers; an empty floor exits early.

The diagram is the short path: a clean floor exits early; a passing verdict applies and journals; a blocked verdict holds and alerts by name.

## Run order

The operator's intent enters once; every later stage either strengthens the evidence or produces a named hold:

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

Fleet-wide reach is earned one digest at a time. A non-canary host applies item X at digest D only when a canary journaled `applied` or `satisfied` for D at least the configured `canary_wait_hours` ago, with a 24-hour default and fallback, nothing later reverted or held D, and the canary has published any record since the wait began. A silent canary closes the evidence window as a hold and never reads as a pass.

The wait and the per-run removal caps bound how far a bad item can travel. `satisfied` counts as liveness because the desired identity is still present and observed. `held` carries a reason and keeps the prior value, so it cannot satisfy the canary gate.

## Journal outcomes

When an operator investigates a mixed rollout, these records keep successful adoption, observed satisfaction, and a policy hold distinct:

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

Rollback is an ordinary signed change through review, canary, and apply. The revert-signature predicate is `applied → withdrawn → reincoming`; `reincoming` is the contract term for a value returning after withdrawal, and that sequence requires a fresh review.

## Offline return

Reconnect from the last trusted position. An offline host resumes from its reviewed reference, fetches the available history, reviews changed items, and publishes its own evidence when it reconnects. Parse errors and open conflicts keep affected items at their applied values and name the hold reason.
