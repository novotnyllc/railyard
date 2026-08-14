---
layout: default
title: Distribute a skill
parent: Practices
nav_order: 4
---

# Distribute a skill

A review skill proves useful on one machine and now belongs on every enrolled development host. Declare it once, preserve its source ownership, and move the exact item through review, canary evidence, and a signed journal trail. Every receiver can prove which bytes arrived and how the rollout ended.

## Easy path

```text
> Add this skill to the desired agent surface, canary it, and show the rollout evidence.
```

Declare the skill as a desired item, then run the fleet convergence path.

## The run

The operator asks for one reviewed skill to reach every enrolled development host as the same item. Roundhouse folds its declaration through the desired-state layers, binds the marketplace SHA and version to the item identity, and lets the canary earn downstream propagation. The turn is the canary decision: aged liveness advances the exact digest, while incomplete evidence preserves the prior value. The run closes when every host journal shows that digest as `applied`, `satisfied`, or held with a named reason.

## What happens

The store folds the skill's desired value through fleet, platform, group, and machine layers. Each receiving machine checks the signed change, ownership, review decision, canary evidence, and apply result. For later inspection, the journal records the item digest and outcome.

## Proof point

The [skill-sync guide](/sync/) documents the manager-verb alignment, while [Roundhouse convergence](/roundhouse/convergence/) supplies the receiving-host gate order and canary condition for an exact item digest. The per-machine journal and applied record make the rollout observable.

## Next

[Declare desired state](/what-it-does/declare-desired-state/) or [read Roundhouse convergence](/roundhouse/convergence/).
