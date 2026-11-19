---
layout: default
title: Orchestrate
parent: Skills
nav_order: 2
---

# Orchestrate

Use Orchestrate for explicitly requested fleet/account allocation or delegated remote-agent work. It coordinates bounded lanes under one acceptance contract when the work needs those placement and transport controls.

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

Orchestrate owns requested fleet placement, coordination, and synthesis. Use native children for local parallel units and [CE for code implementation across engines](/what-it-does/work-across-harnesses/). Use the named CLI or Roundhouse for mechanical host changes. Create a visible user-owned task only when the user explicitly requests one. CE owns review settlement and CI for each applicable software lane.

## Source

Ships in the `railyard` plugin.

## Proof point

An actual orchestrated run records each lane's placement, readiness, returned evidence, and terminal state against the agreed acceptance criteria. Record the model and effort when the destination provides them.
