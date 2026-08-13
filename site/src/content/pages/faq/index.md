---
layout: default
title: FAQ
nav_order: 5
---

# FAQ

The short answers below point to the pages that carry the full operating contract.

## Railyard vs Roundhouse: do I need both?

Railyard is the delivery system for routing, review, merge, and proof. Roundhouse is the fleet convergence layer for inventory, readiness, and remote administration. A delivery-only path works with Railyard alone; add Roundhouse when placement or fleet state earns its place. See the [Start decision matrix](/start/).

## Claude Code vs Codex: which harnesses are supported?

Both are supported. Same-harness execution is the default. Cross-harness dispatch is an opt-in seam and requires the destination Codex CLI to be set up separately. The [cross-harness practice](/what-it-does/work-across-harnesses/) shows where the handoff is recorded.

## Does this work on Windows and WSL?

Yes. The documented support surface includes macOS, Linux, Windows, and WSL. Windows work keeps native Windows evidence distinct from WSL evidence; the [installation compatibility notes](/start/install/#compatibility-and-cost) state the CLI and tooling assumptions.

## Is a GitHub remote required? What if there is no test suite?

A GitHub remote is required for a published pull request, but a local delivery can still run its checks and report the missing publish step. When no test suite exists, the route uses the smallest applicable verification command and records that no focused check was available.

## What does it cost?

Railyard itself is free and open source (MIT); you pay only your own Claude/Codex usage, billed exactly as any other session in that harness. The [model routing guide](/what-it-does/control-model-cost/) explains how the route records the budget decision.

## What else gets installed?

Railyard depends on [Compound Engineering (EveryInc)](https://github.com/EveryInc/compound-engineering-plugin) for the workflow engine and [ponytail (DietrichGebert)](https://github.com/DietrichGebert/ponytail) for the efficiency discipline used in implementation and verification. The grouped marketplace install is the consent step for those dependencies.

## What is a receipt, a run log, or Thermos?

- A [receipt](/delivery/lifecycle/) is the evidence chain from intent through merge and post-merge proof.
- A [run log](/delivery/audit/) is the decision chain that explains how the result arrived.
- [Thermos](/skills/thermos/) is the paired review skill invoked during delivery.
