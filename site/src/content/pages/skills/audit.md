---
layout: default
title: Audit
parent: Skills
nav_order: 6
---

# Audit

Treat every delivery run as a decision record: start with the intended approach, follow each consequential turn, and finish with evidence that another operator can inspect. That discipline makes a run explainable, resumable, and honest about anything still unresolved.

## What it adds

Audit reports route decisions, dispatches, checks, review rounds, retries, Git state, pull-request state, merge state, and retrospective outcomes in one place.

## How it works

The skill reads the primary run log, maps planned items and workarounds to captured evidence, and marks the boundary between observed fact and unresolved state. Metadata events preserve the reason for each deviation.

```text
> Reconstruct this delivery run and show the decision chain, checks, review rounds, and terminal proof.
route=codex-luna/max
dispatches=3  parallel_rounds=1  retries=0
checks=content-audit(exit=0), diff-check(exit=0)
terminal=local-verified  merge=owner-action-required
```

## Scope

Audit reads and reports. It gives the owner evidence to interpret, while the owning workflow retains route-change authority.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
decision approach captured=true
outcome=delivery-terminal-proof captured=true
deviations=0 captured=true
retrospective questions=5 sink=local-learning
```
