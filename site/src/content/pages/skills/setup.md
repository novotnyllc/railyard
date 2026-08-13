---
layout: default
title: Setup
parent: Skills
nav_order: 7
---

# Setup

Establish a delivery baseline by observing the machine first, proposing the exact delta, and applying one consented configuration path. Repeatable setup preserves operator choices and makes readiness a verified result.

## What it adds

Setup runs the machine from inventory to a validated delivery-ready baseline. It inventories installed plugins, marketplaces, tools, configuration, and credential presence, then proposes the missing pieces and writes only the answers you provide.

## How it works

Setup keeps local installation, optional fleet enrollment, model policy, auth artifact custody, and privileged lanes distinct. A repeat run reads the current state and proposes only the delta.

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

## Troubleshooting

- **The marketplace is missing:** return to [Install](/start/install/) and add the shared marketplace before asking Setup to inspect plugin state.
- **A plugin is present at the wrong version:** compare the marketplace identity and version, then update through the harness that owns the install.
- **A required tool or credential is absent:** keep the proposed delta visible, install or authenticate through the native owner, and rerun Setup.
- **A host is not ready:** use [Fleet readiness](/skills/fleet-readiness/) to separate project, agent, auth, and transport evidence before enrolling it.
