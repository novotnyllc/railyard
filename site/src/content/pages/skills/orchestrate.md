---
layout: default
title: Orchestrate
parent: Skills
nav_order: 2
---

# Orchestrate

Orchestrate turns a multi-lane objective into dependency-aware work placed on machines with current readiness evidence.

## What it adds

The skill classifies each turn, freezes an objective and acceptance contract, consults fleet readiness, creates bounded lanes, and tracks each lane to a terminal result.

## How it works

Host, task, and transport evidence feed placement. Dependency-ready lanes can start together, while handoffs carry the same scope, owner, constraints, and evidence contract.

```text
> Split this delivery into dependency-ready lanes and place each one only where readiness is complete.
objective=delivery-opaque-01 lanes=2
lane-a=mechanical-sites ready=host+task+transport
lane-b=flush-seam ready=host+task+transport
fanout=2  canonical_writer=integration
```

## Scope

Orchestrate owns decomposition, placement, coordination, and synthesis. Delivery owns implementation inside each software lane; remote administration owns one-host operating work.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
lane=lane-a carrier=codex-luna claim=claim-opaque-a result=settled
lane=lane-b carrier=codex-sol claim=claim-opaque-b result=settled
contract_digest=sha256:7c1a... synthesis=complete
```

Next: [run work on another machine](/what-it-does/run-work-on-another-machine/).
