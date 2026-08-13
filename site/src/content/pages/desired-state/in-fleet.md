---
layout: default
title: In a fleet
parent: Desired state
nav_order: 1
---

# Desired state in a fleet

The fleet store gives desired state a shared home, a signed history, and a per-machine apply record.

## Declare

Use the four layers:

```text
fleet.yaml
os/<platform>.yaml
groups/<group>.yaml
hosts/<machine>.yaml
```

Each item resolves to one effective value for the machine. Maps merge by key; scalar values replace as units; `absent` removes an item from the effective set.

## Review

The receiving host reviews the resolved digest and its provenance. Canary members adopt a changed digest first; downstream members read the canary's signed journal outcome after the policy wait.

## Apply

The host applies the item through its owning manager, writes `applied/<machine>.yaml`, and records the result in `journal/<machine>/`. A held item keeps its prior applied value and carries a named alert.

## Explain

```text
roundhouse fleet-explain <machine> plugins.<name>
```

The output shows the winning layer and the value that produced the digest.

## Proof point

The store and convergence sources describe the four-layer fold, canary release, item digest, journal outcome, and `fleet-explain` path. Sources: `roundhouse/docs/store.md` and `roundhouse/docs/convergence.md`.

Next: [see fleet scaling](/desired-state/scaling/) or [read trust](/fleet/trust/).
