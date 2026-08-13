---
layout: default
title: Chezmoi
parent: Integrations
nav_order: 1
---

# Chezmoi integration

Chezmoi adds deliberate, path-scoped dotfile reconciliation between a source repository and live files on configured machines; the core system operates fully without it.

## Easy path

```text
> Compare the selected dotfiles on every machine and prepare the right reconciliation plan.
```

## What it adds

The optional `fleet-chezmoi` skill gathers native status and diff evidence, maps rendered files to source paths, compares semantic content and history, and produces a scoped plan. Approved applies use sealed arguments, immediate preconditions, and postconditions for the selected paths.

## The seam

The fleet store owns machine desired state. Chezmoi remains the source and renderer for personal dotfiles. The integration connects the two surfaces through an explicit plan, target list, and verification result.

## Skill reference

This page is the single public reference for the integration skill.

- Ships in the `roundhouse` plugin.
- Source: `plugins/roundhouse/skills/fleet-chezmoi/SKILL.md`.

## Proof point

The source skill describes per-target evidence, semantic reconciliation, sealed apply plans, and pre/post status checks.

## Next

[Read the fleet store](/fleet/store/) or [see the other integrations](/integrations/).
