---
layout: default
title: Setup
parent: Skills
nav_order: 7
---

# Setup

Setup takes a machine from inventory to a validated delivery-ready baseline through one consented configuration path.

## What it adds

The skill inventories installed plugins, marketplaces, tools, configuration, and credential presence, then proposes the missing pieces and writes only the answers you provide.

## How it works

Setup separates local installation, optional fleet enrollment, model policy, auth artifact custody, and privileged lanes. A repeat run reads the current state and proposes only the delta.

## Scope

Setup handles initial presence and configuration. Doctor handles an installed surface whose observed state needs diagnosis.

## Source

Ships in the `railyard` plugin. Source: `plugins/railyard/skills/setup/SKILL.md`.

## Proof point

The source starts with a read-only inventory and finishes with a readiness table.

Next: [read first machine](/start/first-machine/).
