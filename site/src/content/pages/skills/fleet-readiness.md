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

```text
> Prove whether host-a can run this delivery and show host, task, and transport separately.
host=ready evidence=inventory+projects+agents
task=ready evidence=scope+capabilities
transport=ready evidence=ssh+identity
execution_host=host-a target_platform=linux
result=ready
```

## Scope

Fleet readiness synthesizes prerequisite evidence. Inventory, agent parity, project checks, auth, and remote administration own their detailed mechanics.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
host=host-a state=ready
task=delivery-opaque-01 state=ready
transport=ssh state=ready
placement=allowed
```

Next: [run work on another machine](/what-it-does/run-work-on-another-machine/).
