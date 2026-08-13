---
layout: default
title: Convergence
parent: Fleet
nav_order: 2
---

# Convergence

One edit travels through signed history, host-local review, canary evidence, apply, and a journal record before the next machine adopts it.

## 1. Snapshot

An edit to a layer file becomes a signed working-copy commit when the store runs its next jj operation. The reconcile point is the reviewed commit, which gives every host a stable input.

## 2. Promote

Changed layer files are parsed and described before the reviewed bookmark moves. A parseable snapshot becomes the next reviewed line; a parse issue produces a focused alert and leaves the previous reviewed state available for convergence.

## 3. Propagate

The hub carries the shared history. A fast cadence checks the remote head, local publication, working-copy state, and completed-run state before fetching. A full cadence adds marketplace refresh, package maintenance, evidence retention, and doctor rows.

## 4. Gate on the receiving host

Each changed item moves through this order:

1. resolved-value divergence
2. signed-history integrity
3. an item-specific local review decision
4. ownership and applied digest
5. re-review for a reverted value
6. canary evidence for the exact digest
7. provenance review and apply

The journal and applied record are written after the outcome, then the host publishes its evidence.

## 5. Conflict resolution

jj stores a conflict as readable state with both parents. The run compares resolved item values, holds the contested keys, and continues with items whose values agree. An agent can resolve a real disagreement from signed content, journal evidence, and commit history; the resolution becomes an ordinary reviewed commit.

## 6. Offline return

An offline machine resumes from its last reviewed state, fetches the available history, reviews the changed items, and publishes its own evidence when it reconnects. A source parse issue or open conflict keeps the affected items at their applied values and records the reason.

## 7. Rollback

Rollback is a signed change through the same review, canary, and apply gates. The store preserves evidence directories so the fleet can see the change sequence and the resulting state.

## Proof point

This page describes the receiving-host gate order, canary evidence, item-level divergence, offline return, and rollback flow.

Next: [read trust](/fleet/trust/) or [inspect the operating commands](/fleet/operating/).
