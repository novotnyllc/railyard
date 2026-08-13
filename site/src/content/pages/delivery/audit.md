---
layout: default
title: Audit
parent: Delivery
nav_order: 4
---

# Audit

Audit turns a delivery run into a compact decision chain: route, dispatches, checks, review rounds, retries, and terminal evidence.

## The record

The run log records metadata for the approach, route decisions, outcomes, and deviations. It keeps prompts, diffs, and provider output outside the metadata record while preserving why each action happened.

## The report

An audit report sweeps the primary run record, then maps each planned item and workaround to captured evidence. It separates:

- route selected and actual carrier
- active lanes and dispatch count
- checks run, input scope, and exit status
- review findings and fix rounds
- Git, pull request, merge, and post-merge state
- deviations and reusable lessons

## The retrospective

A substantial run closes with questions graded against its opening approach: which check carried the proof, which work ran in parallel, which input stayed unchanged, and where the route changed. The answer becomes a reusable suggestion when the skill or process can improve.

## Useful commands

```text
railyard:model-routing status
railyard:model-routing inspect-claim
railyard:audit
```

The audit skill reads evidence and presents it as a decision chain. Source: `railyard/docs/skills/audit.md`.

Next: [read lifecycle](/delivery/lifecycle/) or [inspect the fleet operating surface](/fleet/operating/).
