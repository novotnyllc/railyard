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

```text
> Inspect this machine, install the delivery surface, and show the proposed delta before any optional enrollment.
plugins=railyard:missing roundhouse:present
model_policy=default  signing=ready  auth_presence=checked
fleet_enrollment=not-requested
plan=install-railyard
```

## Scope

Setup handles initial presence and configuration. Doctor handles an installed surface whose observed state needs diagnosis.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
step=inventory result=complete
step=install action=railyard result=ready
step=readiness host=ready task=ready transport=ready
result=setup-complete
```

Next: [read first machine](/start/first-machine/).
