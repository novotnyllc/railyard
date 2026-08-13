---
layout: default
title: Fleet update
parent: Skills
nav_order: 17
---

# Fleet update

Fleet update turns approved package and plugin maintenance into a sealed, fresh, evidence-backed apply plan.

## What it adds

The skill snapshots current state, selects native manager operations, calculates a bounded plan, validates preconditions, and records the result in the fleet journal.

## How it works

Updates are grouped by owner, platform, and action type. Protected package actions carry an exact payload and permission context; interactive privilege remains an explicit host decision. The next run rechecks the state before applying.

## Scope

Fleet update owns packages, marketplace refresh, and the fleet scheduler's maintenance path. Agent parity and project readiness remain with their owning skills.

## Source

Ships in the `roundhouse` plugin. Source: `plugins/roundhouse/skills/fleet-update/SKILL.md`.

## Proof point

The source skill defines sealed plans, fresh preconditions, native manager ownership, and per-item journal evidence.

Next: [keep machines current](/what-it-does/keep-machines-current/).
