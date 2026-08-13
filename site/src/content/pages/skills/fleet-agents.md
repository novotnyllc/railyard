---
layout: default
title: Fleet agents
parent: Skills
nav_order: 13
---

# Fleet agents

Fleet agents keeps harnesses, plugins, skills, hooks, agents, MCP servers, and selected settings aligned with observable per-machine evidence.

## What it adds

The skill inventories the installed agent surface, refreshes managed plugin sources, compares desired and observed digests, and prepares the desired-state path when you opt into fleet convergence.

## How it works

Each artifact is handled by its owning installer or source. Plugin payloads flow through their source, local skills retain their source ownership, and configuration keys use an allowlist. The result records version, resolved bytes, and action outcome.

## Scope

Fleet agents owns agent-surface parity and its desired-state half. Package, project, auth, host, and transport details stay with their owning skills.

## Source

Ships in the `roundhouse` plugin. Source: `plugins/roundhouse/skills/fleet-agents/SKILL.md`.

## Proof point

The source skill defines per-artifact ownership, byte-level freshness, and desired-state sync with item evidence.

Next: [distribute a skill](/what-it-does/distribute-a-skill/).
