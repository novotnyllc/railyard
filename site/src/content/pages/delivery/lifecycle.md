---
layout: default
title: Lifecycle
parent: Delivery
nav_order: 1
---

# The delivery lifecycle

A single request becomes a traceable sequence of intent, routing, implementation, review, merge, proof, and learning.

## 1. Intent intake

`railyard:deliver` reads the requested outcome and selects the artifact boundary. A plan request produces a plan, a diagnosis request produces findings, and an implementation request carries through the full delivery route.

## 2. Model routing

`railyard:model-routing` resolves the work class before a carrier starts. The decision records the selected model, effort, adapter, transport, privacy, and budget effect.

## 3. Plan and implement

The implementation workflow creates a bounded working boundary, plans the change, writes the smallest useful implementation, and runs the relevant checks. Independent work can run in isolated worktrees and converge into one integration branch.

## 4. Thermos review

The correctness/security lens and the maintainability lens review the same frozen packet. The synthesis gives the implementation lane one findings list, and the lane fixes real findings before the chunk moves forward.

## 5. Browser-visible quality

For React, Next, JSX, TSX, or component work, the route runs the project-appropriate React Doctor command against the staged change. Docs-only work stays on its document checks.

## 6. Commit and publish

The delivery owner creates the configured commit, pushes the working branch, and opens or updates the pull request when the repository workflow uses one. Checkpoint commits give another lane a resumable handoff.

## 7. Review settlement

The delivery tail settles CI, review threads, branch currency, and stack order. Merge authority follows the latest review evidence and the repository's configured merge strategy.

## 8. Post-merge proof

The terminal pair is observable:

```sh
git merge-base --is-ancestor <merge-commit> origin/<base>
<smallest applicable post-merge check>
```

The result reports both the merge ancestry and the check outcome.

## 9. Durable learning

A substantial run closes with a recap and retrospective. Reusable repo lessons can enter the compound workflow; cross-repo routing lessons stay in the routing learning surface.

## One-line shape

```text
intent -> routed -> planned -> implemented -> gated -> reviewed -> merged -> proven -> learned
```

Source basis: `railyard/docs/lifecycle.md`.

Next: [see the gates](/delivery/gates/).
