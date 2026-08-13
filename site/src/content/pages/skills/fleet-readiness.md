---
layout: default
title: Fleet readiness
parent: Skills
nav_order: 11
---

# Fleet readiness

Fleet readiness gives placement a current readiness result from host, task, and transport evidence.

## What it adds

The skill checks configuration, projects, agent surface, inventory, authentication, and transport prerequisites for the selected machine and work unit.

## How it works

Readiness stays separate for execution host and target platform. The result is `ready`, `blocked`, or `unknown` with evidence for each required row; the dispatcher consumes the complete result before placement.

## Scope

Fleet readiness synthesizes prerequisite evidence. Inventory, agent parity, project checks, auth, and remote administration own their detailed mechanics.

## Source

Ships in the `roundhouse` plugin. Source: `plugins/roundhouse/skills/fleet-readiness/SKILL.md`.

## Proof point

The source skill defines a readiness table with separate host, task, and transport surfaces.

Next: [run work on another machine](/what-it-does/run-work-on-another-machine/).
