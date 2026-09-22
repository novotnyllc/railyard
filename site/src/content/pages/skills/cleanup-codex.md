---
layout: default
title: Cleanup Codex
parent: Skills
nav_order: 9
---

# Cleanup Codex

Reclaim detached session residue only after the process, launcher, and thread all prove the same identity. This turns a risky cleanup into a precise recovery and leaves the machine ready for a trustworthy restart.

## What it adds

Cleanup Codex owns recovery. Inspection reports matching session servers, process age, descriptors, and launcher state. Reap uses the exact session identity, a host-local lock, paired snapshots, and proves final absence; recycle owns replacement and restart attestation.

## How it works

The cleanup path checks ownership, thread identity, process arguments, and launcher relationship before acting. Automatic cleanup is off by default; the plugin does not register a SessionEnd cleanup hook. The retained opt-in hook uses the same identity checks.

Illustrative inspection fields:

```text
> Inspect the detached Codex residue for this thread; reclaim it only when identity evidence is complete.
thread=<selected thread>
ownership=<observed identity> server=<match result> launcher=<match result>
snapshot=<paired evidence> lock=<observed state>
recommendation=<inspection result>
```

## Scope

Cleanup covers session residue tied to the selected Codex thread. Incomplete evidence produces a diagnostic result for operator review.

## Source

Ships in the `railyard` plugin.

## Proof point

A completed cleanup must retain its matched identity evidence and verify that the exact selected residue is absent. Report incomplete evidence or refusal as observed; cleanup is not a routine delivery closing step.
