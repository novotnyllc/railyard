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

Orchestrate owns the requested placement, coordination, and synthesis. Routine local decomposition uses native children. A visible user-owned task requires an explicit request to create one; orchestration alone does not authorize it. Delivery coordinates implementation inside each software lane, with CE owning review settlement and CI; remote administration owns one-host operating work.

## Source

Ships in the `railyard` plugin.

## Proof point

An actual orchestrated run records each lane's selected model and effort, readiness, claim, returned evidence, and terminal state against the frozen contract. GPT-6 Sol at `medium` is the ordinary engineering candidate; use Astra when the lane needs stronger judgment. Another supported pair or deliberate inheritance needs an assignment-specific reason. Report unavailable routes without silent substitution.
