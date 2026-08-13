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

## Merge settlement

The merge-settlement hook connects review evidence to merge authority. A new branch head receives review evidence before merge; unresolved review threads remain part of the settlement state.

Source files: `plugins/railyard/hooks/merge-settlement-gate.js` and `plugins/railyard/hooks/merge-settlement-gate.test.mjs`.

## Independent review

The delivery tail checks for a separate review pass at the required tier. The implementation author and the merge authority therefore have distinct evidence surfaces.

## Post-merge proof

The merge commit is checked for ancestry on the base branch, then the smallest applicable test or verification command runs against the merged state. The report names the commit and command.

## Focused quality gates

Docs-only changes use link and content scans. UI changes use the project's browser-visible quality gate. Native app work uses the isolated test integration when selected. Fleet work uses per-host readiness, trust, canary, and journal evidence.

Next: [reconstruct a run](/delivery/audit/) or [ship a change](/what-it-does/ship-a-change/).
