---
layout: default
title: Declare desired state
parent: Practices
nav_order: 5
---

# Declare desired state

A development group needs one tool version while a particular machine needs a local exception. Express both as readable maps, resolve one value per item, and let each host converge through a canary and evidence trail. Operators can understand the final state before apply and prove what each host received afterward.

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

The four-layer fold resolves one value per item. Maps merge by key, scalar values replace as a unit, and an explicit `absent` value removes an item from the effective set. Before applying it, each host reviews the resolved digest.

## Proof point

The [Roundhouse convergence guide](/roundhouse/convergence/) names the canary-to-downstream evidence flow and the `journal/<machine>/` plus `applied/<machine>.yaml` records that prove what each host did.

## Next

[See the standalone desired-state guide](/desired-state/) or [inspect the Roundhouse store](/roundhouse/store/).
