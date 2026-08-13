---
layout: default
title: Distribute a skill
parent: What it does
nav_order: 4
---

# Distribute a skill

Write a skill once and move it across enrolled machines through item-level review, canary evidence, and a signed journal trail.

## Easy path

```text
> Add this skill to the desired agent surface, canary it, and show the rollout evidence.
```

Declare the skill as a desired item, then run the fleet convergence path.

## What happens

The store folds the skill's desired value through fleet, platform, group, and machine layers. Each receiving machine checks the signed change, ownership, review decision, canary evidence, and apply result. The journal records the item digest and outcome for later inspection.

## Proof point

The [skill-sync guide](/sync/) documents the manager-verb alignment, while [Roundhouse convergence](/roundhouse/convergence/) supplies the receiving-host gate order and canary condition for an exact item digest. The per-machine journal and applied record make the rollout observable.

## Next

[Declare desired state](/what-it-does/declare-desired-state/) or [read fleet convergence](/fleet/convergence/).
