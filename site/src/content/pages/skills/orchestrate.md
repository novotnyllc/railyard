---
layout: default
title: Orchestrate
parent: Skills
nav_order: 2
---

# Orchestrate

Deliver invokes Orchestrate when authorized fleet placement could help a stage. It coordinates bounded lanes under one acceptance contract. Routine and local-only work stay local.

## What it adds

Within that requested scope, Orchestrate freezes an objective and acceptance contract, consults fleet readiness, places bounded lanes, and tracks each lane to a terminal result.

## How it works

Host, task, and transport evidence feed placement. Dependency-ready lanes can start together, while every handoff carries the same scope, owner, constraints, and evidence contract.

Illustrative request and placement outline:

```text
> Run this delivery across the configured fleet; place each lane only where readiness is complete.
objective=delivery-opaque-01 lanes=2
lane-a=mechanical-sites ready=host+task+transport
lane-b=flush-seam ready=host+task+transport
fanout=2  canonical_writer=integration
```

## Scope

Orchestrate owns authorized fleet placement, coordination, and synthesis. Use an approved SSH command for bounded remote execution. Use a separate worker for independent reasoning or an authorized account. Use native children for local parallel units and [CE for code implementation across engines](/what-it-does/work-across-harnesses/). Create a visible user-owned task only when the user explicitly requests one. CE owns review settlement and CI for each applicable software lane.

## Source

Ships in the `railyard` plugin.

## Proof point

An actual orchestrated run records each lane's placement, readiness, returned evidence, and terminal state against the agreed acceptance criteria. Record the model and effort when the destination provides them.
