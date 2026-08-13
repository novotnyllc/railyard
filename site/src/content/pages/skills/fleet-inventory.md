---
layout: default
title: Fleet inventory
parent: Skills
nav_order: 12
---

# Fleet inventory

Fleet inventory gives the operator an evidenced view of platform, tools, harnesses, plugins, skills, projects, startup tasks, and auth presence.

## What it adds

The inventory gathers observed and desired values per machine, reports an `in_sync` result where the check applies, and preserves partial evidence when a row needs attention.

## How it works

It validates the machine configuration, collects native facts through the platform-appropriate lane, and hands findings to fleet readiness, agents, projects, auth, or updates according to ownership.

## Scope

Inventory observes and compares. It leaves changes to the skill that owns the item category.

## Source

Ships in the `roundhouse` plugin.

## Proof point

The source defines cross-platform inventory, per-machine evidence, hash checks, and ownership-aware routing.

Next: [keep machines current](/what-it-does/keep-machines-current/).
