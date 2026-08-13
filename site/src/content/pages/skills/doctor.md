---
layout: default
title: Doctor
parent: Skills
nav_order: 8
---

# Doctor

Doctor turns delivery-system drift into a read-only health table with an owner and a routed next action.

## What it adds

The skill checks harness parity, plugin and skill state, marketplaces, routing policy, credential presence, fleet readiness, store state, and runtime health.

## How it works

Each row names the observed condition, evidence source, and owning fix surface. A follow-up fix routes through the skill that owns the affected surface, then the row is checked again.

```text
> Run the read-only doctor pass and group each finding by its owning fix surface.
row=routing-policy       state=ready     owner=model-routing
row=plugin-bytes         state=ready     owner=fleet-agents
row=github-auth          state=present   owner=delivery-tail
row=fleet-readiness      state=unknown   owner=fleet-readiness
next=collect readiness evidence
```

## Scope

Doctor diagnoses and reports. Mutation belongs to the approved owning workflow.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
finding=fleet-readiness before=unknown after=ready
mutation=performed-by-owner
recheck=complete
result=ready
```

Next: [read setup](/skills/setup/) or [inspect fleet readiness](/skills/fleet-readiness/).
