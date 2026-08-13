---
layout: default
title: Scaling
parent: Desired state
nav_order: 2
---

# Scaling desired state

The fold and pull-based convergence keep per-machine work bounded while evidence volume sets the first scaling breakpoint.

## What stays bounded

- The four-layer fold resolves one machine's state from a constant number of layers.
- Host-keyed journals, alerts, findings, and applied files give each machine one writer.
- Canary release keeps the changed-item blast radius tied to the canary wait.
- Jitter spreads scheduled runs across the cadence.

## First breakpoint

Around 30 machines, long-lived journal data becomes the first meaningful repository cost because every machine carries the shared history. The recommended next build is signed journal compaction with a retention floor at the canary wait.

## Later breakpoints

Around 75 machines, roster replay and the aggregate “which machines carry this item?” view become read-side costs. Around 50 simultaneous enrollments, batching roster additions reduces repeated publication work. Around 100 machines, per-group store sharding reduces shared-bookmark contention while preserving host-keyed evidence.

## Design rules for the next tier

- Keep evidence paths independently attributable to their machine.
- Keep derived aggregate indexes out of apply decisions.
- Keep the canary window intact during compaction.
- Keep shard boundaries compatible with history-preserving projections.

## Proof point

The scaling design identifies evidence retention as the first breakpoint, gives journal compaction as the next build, and names sharding, aggregation, and batched enrollment as later levers. This page presents that design as reader guidance.

Next: [read the fleet store](/fleet/store/) or [follow convergence](/fleet/convergence/).
