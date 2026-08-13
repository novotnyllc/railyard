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

## Scope

Doctor diagnoses and reports. Mutation belongs to the approved owning workflow.

## Source

Ships in the `railyard` plugin. Source: `plugins/railyard/skills/doctor/SKILL.md`.

## Proof point

The doctor source defines read-only diagnostics, explicit credential presence checks, and re-checks after a routed fix.

Next: [read setup](/skills/setup/) or [inspect fleet readiness](/skills/fleet-readiness/).
