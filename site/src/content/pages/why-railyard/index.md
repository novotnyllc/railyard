---
layout: default
title: Why Railyard
nav_order: 6
---

# Why Railyard

Agent work needs a finish line that names what changed, who examined it, what it cost, and where the result arrived.

## The failure modes without it

Green CI can still leave an unreviewed merge. A successful model call can still hide unaudited spend. A ready-looking machine can still carry fleet drift. Without one delivery contract, each handoff turns a claim into another manual question.

## The mechanism in one screen

Railyard keeps one chain visible:

```text
route decision → review gates → merge settlement → receipt → audit
```

The route prices the work, the gates challenge the risk, settlement waits for current evidence, the receipt proves arrival, and the audit reconstructs the decisions afterward. [Delivery lifecycle](/delivery/lifecycle/) carries the full sequence.

## Proof case study

The fleet-DSC landmark build put the mechanism under pressure: four design directions, seven adversarial review rounds, and a 19-reviewer swarm caught two real production bugs. A published threat model records the residuals using anonymized, generalized counts rather than private topology.

That proof is useful because it shows the system doing work at the boundary where optimistic claims fail: multiple designs, repeated hostile review, and a final public explanation of what the controls do and do not guarantee.

## Start with a real change

Use the [Start guide](/start/) to install the surface and carry one useful delivery through its first receipt.
