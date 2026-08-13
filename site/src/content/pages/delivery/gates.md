---
layout: default
title: Gates
parent: Delivery
nav_order: 3
---

# Delivery gates

The delivery path makes quality and completion observable through focused gates owned by the stage they protect.

## Thermos

Thermos runs two lenses against one frozen packet:

- `thermo-nuclear-review` covers correctness, security, breakage, developer experience, and feature-leak risk.
- `thermo-nuclear-code-quality-review` covers structure, duplication, maintainability, and complexity.

The synthesis deduplicates findings. Real findings are fixed before the chunk commits, and affected checks run again.

The dispatch gate keeps the worker identity explicit. A Codex child missing both fields returns:

```text
[railyard] Dispatch refused: spawn_agent must set model and reasoning_effort explicitly (no silent inheritance of the session tier). Retry with the fields set.
```

## Merge settlement

The merge-settlement hook connects review evidence to merge authority. A new branch head receives review evidence before merge; unresolved review threads remain part of the settlement state.

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

The delivery tail checks for a separate review pass at the required tier. The implementation author and the merge authority therefore have distinct evidence surfaces.

## Post-merge proof

The merge commit is checked for ancestry on the base branch, then the smallest applicable test or verification command runs against the merged state. The report names the commit and command.

```text
merge=4e1d... ancestry=verified
post_merge_check=node --test test/retry.test.mjs exit=0
result=proven
```

## Focused quality gates

Docs-only changes use link and content scans. UI changes use the project's browser-visible quality gate. Native app work uses the isolated test integration when selected. Fleet work uses per-host readiness, trust, canary, and journal evidence.

```text
dispatch_gate=explicit-model pass
merge_settlement=threads-resolved window-passed
post_merge=ancestry+focused-check pass
```

Next: [reconstruct a run](/delivery/audit/) or [ship a change](/what-it-does/ship-a-change/).
