---
layout: default
title: Chezmoi
parent: Integrations
nav_order: 1
---

# Chezmoi integration

Treat personal configuration as maintained source with explicit rendering, history, and per-path intent. Reconcile only the files in scope, compare semantic content before choosing a direction, and prove both preconditions and postconditions. The result is portable configuration that can converge across machines while preserving the operator's authorship trail.

The optional Chezmoi integration connects a source repository to live files on configured machines through deliberate, path-scoped dotfile reconciliation; the core system remains fully operational on its own.

## Easy path

An operator sees the same selected dotfile drifting across several machines and needs a plan that respects both source history and host-specific rendering:

```text
> Compare the selected dotfiles on every machine and prepare the right reconciliation plan.
```

## What it adds

Build the decision from native evidence. The integration gathers status and diff evidence, maps rendered files to source paths, compares semantic content and history, and produces a scoped plan. Approved applies use sealed arguments, immediate preconditions, and postconditions for the selected paths.

## The seam

Keep ownership crisp. The fleet store owns machine desired state. Chezmoi remains the source and renderer for personal dotfiles. The integration connects the two surfaces through an explicit plan, target list, and verification result.

## Public reference

Use this page as the single public reference for the integration. The source and renderer remain owned by Chezmoi; the fleet surface records only the selected paths and their verification result.

## Proof point

The source skill describes per-target evidence, semantic reconciliation, sealed apply plans, and pre/post status checks.

## Next

[Read the Roundhouse store](/roundhouse/store/) or [see the other integrations](/integrations/).
