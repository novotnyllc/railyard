---
layout: default
title: Fleet inventory
parent: Skills
nav_order: 12
---

# Fleet inventory

Inventory a machine before deciding what it needs. Capture native facts, compare them with declared intent, and preserve partial evidence so operators can route each drift item directly to its owner.

## What it adds

Fleet inventory gathers observed and desired values across platform, tools, harnesses, plugins, skills, projects, startup tasks, and auth presence. It reports an `in_sync` result where the check applies and preserves partial evidence when a row needs attention.

## How it works

The skill validates the machine configuration, collects native facts through the platform-appropriate channel, and hands findings to fleet readiness, agents, projects, auth, or updates according to ownership.

```text
> Inventory host-a, compare the installed agent surface, and show the rows that need an owner.
platform=macos  transport=ssh  config=valid
plugins=12/12  skills=24/24  projects=2/2
agent_surface=drift item=skills.my-review
handoff=fleet-agents
```

## Scope

Inventory observes and compares. It leaves changes to the skill that owns the item category.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
host=host-a os=macos
item=skills.my-review desired_sha=sha256:7c1a... observed_sha=sha256:7c1a...
result=in_sync evidence=inventory/host-a.yaml
```
