---
layout: default
title: Declare desired state
parent: What it does
nav_order: 5
---

# Declare desired state

Describe the machine surface as readable maps, then let each host converge it with a canary and evidence trail.

## Easy path

```text
fleet.yaml
os/macos.yaml
groups/development.yaml
machines/<machine>.yaml
```

```text
> Apply the approved desired state and show the item-level journal.
```

## What happens

The four-layer fold resolves one value per item. Maps merge by key, scalar values replace as a unit, and an explicit `absent` value removes an item from the effective set. Each host reviews the resolved digest before applying it.

## Proof point

The [fleet convergence guide](/fleet/convergence/) names the canary-to-downstream evidence flow and the `journal/<machine>/` plus `applied/<machine>.yaml` records that prove what each host did.

## Next

[See the standalone desired-state guide](/desired-state/) or [inspect the store](/fleet/store/).
