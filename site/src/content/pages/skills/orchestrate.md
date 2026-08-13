---
layout: default
title: Orchestrate
parent: Skills
nav_order: 2
---

# Orchestrate

Decompose a large objective around real seams, then let dependency-ready lanes move together under one frozen acceptance contract. A typical delivery may have dozens of mechanical call sites and one gnarly concurrency seam; giving each a bounded owner accelerates the whole run while protecting the integration boundary.

## What it adds

Orchestrate coordinates work across machines with current readiness evidence. It classifies each turn, freezes an objective and acceptance contract, consults fleet readiness, creates bounded lanes, and tracks each lane to a terminal result.

## How it works

Host, task, and transport evidence feed placement. Dependency-ready lanes can start together, while every handoff carries the same scope, owner, constraints, and evidence contract.

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
