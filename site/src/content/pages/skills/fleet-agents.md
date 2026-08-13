---
layout: default
title: Fleet agents
parent: Skills
nav_order: 13
---

# Fleet agents

Manage the agent surface as declared, inspectable state on every machine. Give each artifact one source owner, compare its resolved bytes, and record the action outcome so the fleet stays aligned with its provenance intact.

## What it adds

Fleet agents implements that practice for harnesses, plugins, skills, hooks, agents, MCP servers, and selected settings. It inventories the installed surface, refreshes managed plugin sources, compares desired and observed digests, and prepares the desired-state path when you opt into fleet convergence.

## How it works

Each artifact moves through its owning installer or source. Plugin payloads flow through their source, local skills retain source ownership, and configuration keys use an allowlist. The result records version, resolved bytes, and action outcome.

```text
> Compare the desired agent surface with host-a and prepare the smallest sync plan.
item=plugins.review-tools desired_sha=sha256:12af... observed_sha=sha256:12af...
item=skills.my-review desired_version=2.4.0 observed_version=2.3.0
manager=codex action=update hook_approval=rerun
plan_items=1  held_items=0
```

## Scope

Fleet agents owns agent-surface parity and its desired-state half. Package, project, auth, host, and transport details stay with their owning skills.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
item=skills.my-review desired_sha=sha256:7c1a... observed_sha=sha256:7c1a...
version=2.4.0 manager=codex
hook_approval=passed result=applied
journal=host-a/2026-08-13.yaml
```

Go deeper: [sync and state alignment](/sync/).

Next: [distribute a skill](/what-it-does/distribute-a-skill/).
