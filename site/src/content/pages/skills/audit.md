---
layout: default
title: Audit
parent: Skills
nav_order: 6
---

# Audit

Use Audit when reconstructing a run would help explain a decision, resume work, or investigate an unresolved result. Routine completion needs a proportionate result and verification report; an audit or retrospective is optional.

## What it adds

Audit brings available route decisions, dispatches, checks, review rounds, retries, Git state, PR state, and merge evidence into one report. Include retrospective findings when they add useful learning.

## How it works

The skill reads available run logs and workflow evidence, maps planned items and workarounds to captured observations, and marks the boundary between observed fact and unresolved state. Include the recorded reason for each material deviation.

Illustrative audit fields, populated from observed evidence:

```text
> Reconstruct this delivery run and show the decision chain, checks, review rounds, and terminal proof.
allocation=<selected model and effort or deliberate inheritance>
observed_allocation=<runtime metadata or unverified>
dispatches=<count> retries=<count>
checks=<commands and results>
terminal=<observed delivery boundary>
```

## Scope

Audit reads and reports. It gives the owner evidence to interpret, while the owning workflow retains route-change authority.

## Source

Ships in the `railyard` plugin.

## Proof point

Tie each material conclusion to captured evidence and name missing observations. A retrospective can use the run's actual outcomes; no fixed question count or learning artifact is required for ordinary delivery.
