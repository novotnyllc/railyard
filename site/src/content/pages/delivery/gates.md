---
layout: default
title: Gates
parent: Delivery
nav_order: 3
---

# Delivery gates

Put each quality decision beside the stage that can act on it. Focused gates turn review, merge authority, and post-merge proof into observable delivery facts, so agents can move quickly while operators retain a trustworthy finish line.

## Thermos

Review a coherent change while its reasoning is still local. Thermos runs two lenses against one frozen packet:

- `thermo-nuclear-review` covers correctness, security, breakage, developer experience, and feature-leak risk.
- `thermo-nuclear-code-quality-review` covers structure, duplication, maintainability, and complexity.

The synthesis deduplicates findings into one actionable list. Real findings are fixed before the chunk commits, and affected checks run again.

![Review gate sequence from a ready diff through parallel Thermos review, synthesis, merge settlement, independent review, merge, post-merge proof, and focused quality gates.](/diagrams/m6-review-gates.svg)

Findings return to the implementation lane, so the diagram describes a loop whose success path stays short.

The dispatch gate keeps the worker identity explicit. A Codex child missing both fields returns:

```text
[railyard] Dispatch refused: spawn_agent must set model and reasoning_effort explicitly (no silent inheritance of the session tier). Retry with the fields set.
```

## Merge settlement

Tie merge authority to the latest branch head and its settled review evidence. The merge-settlement hook gives a new head time to receive reviews and carries unresolved threads in the settlement state.

An unresolved thread returns:

```text
[railyard] Merge refused: PR #42 has 1 unresolved review thread(s). Reviews that arrive after CI turns green are still real findings. Address each one — fix it, or reply on the thread with the rationale for declining — then resolve the threads (resolveReviewThread via gh api graphql) and retry this merge. A tripped guard is waited out or fixed, never bypassed.
```

A fresh head with no reviews is held for the ten-minute settlement window:

```text
[railyard] Merge refused: the head commit 4e1d... of PR #42 has no reviews yet and is only 2m old. Bot reviewers post after a push, so green CI is not merge authority yet. Wait 8m more (settlement window 10m from the head commit), then retry.
```

The [merge-settlement hook](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.js) and its [proof tests](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.test.mjs) are public implementation evidence.

## Independent review

Reserve an independent perspective for the final decision. The delivery tail checks for a separate review pass at the required tier, giving the implementation author and merge authority distinct evidence surfaces.

## Post-merge proof

Prove the state users and downstream systems will receive. The merge commit is checked for ancestry on the base branch, then the smallest applicable test or verification command runs against the merged state. The report names the commit and command.

```text
merge=4e1d... ancestry=verified
post_merge_check=node --test test/retry.test.mjs exit=0
result=proven
```

## Focused quality gates

Spend verification effort where the change can fail. Docs-only changes use link and content scans. UI changes use the project's browser-visible quality gate. Native app work uses the isolated test integration when selected. Fleet work uses per-host readiness, trust, canary, and journal evidence.

```text
dispatch_gate=explicit-model pass
merge_settlement=threads-resolved window-passed
post_merge=ancestry+focused-check pass
```

Next: [reconstruct a run](/delivery/audit/) or [ship a change](/what-it-does/ship-a-change/).
