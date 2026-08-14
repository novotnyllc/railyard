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

## The run

The operator asks for a group default and one machine exception to resolve without hiding either intent. Roundhouse folds fleet, platform, group, and machine maps into one effective item value, then gives the receiving host the resolved digest to review. The turn is the fold: a more specific value replaces or removes only the addressed item while the readable source remains intact. The run closes when the host journal shows the effective digest and its `applied`, `satisfied`, or held outcome.

## What happens

The four-layer fold resolves one value per item. Maps merge by key, scalar values replace as a unit, and an explicit `absent` value removes an item from the effective set. Before applying it, each host reviews the resolved digest.

## Proof point

The [Roundhouse convergence guide](/roundhouse/convergence/) names the canary-to-downstream evidence flow and the `journal/<machine>/` plus `applied/<machine>.yaml` records that prove what each host did.

## Next

[See the standalone desired-state guide](/desired-state/) or [inspect the Roundhouse store](/roundhouse/store/).
