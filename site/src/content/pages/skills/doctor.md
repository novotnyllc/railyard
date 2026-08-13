---
layout: default
title: Doctor
parent: Skills
nav_order: 8
---

# Doctor

Diagnose the delivery system as an ownership map: observe each surface, attach evidence, and route every finding to the workflow that can resolve it. Operators gain a clear next action while preserving the health check as a trustworthy baseline.

## What it adds

Doctor expresses that practice as a read-only health table. It checks harness parity, plugin and skill state, marketplaces, routing policy, credential presence, fleet readiness, store state, and runtime health.

## How it works

Each row names the observed condition, evidence source, and owning fix surface. A follow-up fix travels through the skill that owns the affected surface, followed by a fresh check of the row.

```text
> Run the read-only doctor pass and group each finding by its owning fix surface.
row=routing-policy       state=ready     owner=model-routing
row=plugin-bytes         state=ready     owner=fleet-agents
row=github-auth          state=present   owner=delivery-tail
row=fleet-readiness      state=unknown   owner=fleet-readiness
next=collect readiness evidence
```

## Scope

Doctor diagnoses and reports. The approved owning workflow performs any mutation.

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
