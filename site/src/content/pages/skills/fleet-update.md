---
layout: default
title: Fleet update
parent: Skills
nav_order: 17
---

# Fleet update

Apply maintenance from a fresh, sealed plan that names every package, manager, precondition, and permission boundary. Operators get predictable updates, attended privilege stays visible, and the fleet journal records what actually happened.

## What it adds

Fleet update handles approved package and plugin maintenance. It snapshots current state, selects native manager operations, calculates a bounded plan, validates preconditions, and records the result in the fleet journal.

## How it works

Updates are grouped by owner, platform, and action type. Protected package actions carry an exact payload and permission context; interactive privilege remains an explicit host decision. Each new run rechecks the state before applying.

```text
> Prepare the approved update for host-a, show the sealed plan, and wait at the apply boundary.
owner=package-manager platform=macos
item=packages.tool from=4.1 to=4.2
precondition=sha256:12af... permission=attended
plan=sealed apply=awaiting-explicit-consent
```

## Scope

Fleet update owns packages, marketplace refresh, and the fleet scheduler's maintenance path. Agent parity and project readiness remain with their owning skills.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
item=packages.tool desired=4.2 precondition=passed
manager=native action=update
journal=host-a/2026-08-13.yaml result=applied
```
