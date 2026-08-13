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

## Scope

Audit reads and reports. It provides evidence for the owner to interpret and leaves route changes to the owning workflow.

## Source

Ships in the `railyard` plugin.

## Proof point

The source skill defines a recap and retrospective as the closing surface for a substantial run.

Next: [read audit](/delivery/audit/).
