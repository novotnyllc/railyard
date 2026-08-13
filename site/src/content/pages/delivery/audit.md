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

The [Audit skill](/skills/audit/) reads evidence and presents it as a decision chain.

```text
railyard:model-routing status
{"contractVersion":"railyard/model-routing/v1","ok":true,"reason":"status","readiness":{},"reservations":[],"spend":{},"learning":{"enabled":true,"outcomes":0,"aggregates":0}}

railyard:model-routing inspect-claim --claim-id claim-opaque-01
{"contractVersion":"railyard/model-routing/v1","ok":true,"reason":"claim_verified","claim":{"claimId":"claim-opaque-01","reservationId":"reservation-opaque-01","state":"claimed","selected":{"carrierId":"codex-luna","carrierVersion":"v1","executionSurface":"codex"}}}

railyard:audit
recap=route+dispatches+checks
audit=primary-record sweep deviations=captured
retrospective=5 questions sink=local-learning
```

`inspect-claim` is an active-claim check; a settled outcome comes from the fixed-adapter `reconcile` receipt. The three audit depths share one anonymized run: the recap reports the terminal state, the audit reconstructs the decision chain, and the retrospective grades the run against its opening approach.

Next: [read lifecycle](/delivery/lifecycle/) or [inspect the fleet operating surface](/fleet/operating/).
