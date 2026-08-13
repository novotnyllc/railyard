---
layout: default
title: Audit
parent: Skills
nav_order: 6
---

# Audit

Audit reconstructs how a run moved from its opening approach to its terminal evidence.

## What it adds

The report groups route decisions, dispatches, checks, review rounds, retries, Git state, pull-request state, merge state, and retrospective outcomes.

## How it works

Audit reads the primary run log, maps planned items and workarounds to captured evidence, and marks the boundary between observed fact and unresolved state. It preserves the reason for deviations through metadata events.

```text
> Reconstruct this delivery run and show the decision chain, checks, review rounds, and terminal proof.
route=codex-luna/max
dispatches=3  parallel_rounds=1  retries=0
checks=content-audit(exit=0), diff-check(exit=0)
terminal=local-verified  merge=owner-action-required
```

## Scope

Audit reads and reports. It provides evidence for the owner to interpret and leaves route changes to the owning workflow.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
decision approach captured=true
outcome=delivery-terminal-proof captured=true
deviations=0 captured=true
retrospective questions=5 sink=local-learning
```

Next: [read audit](/delivery/audit/).
