---
layout: default
title: Cleanup Codex
parent: Skills
nav_order: 9
---

# Cleanup Codex

Cleanup Codex identifies and reclaims residue from a crashed or detached Codex session through identity-bound process evidence.

## What it adds

Inspection reports matching session servers, process age, descriptors, and launcher state. Reap uses the exact session identity, a host-local lock, paired snapshots, and proves final absence; recycle owns replacement and restart attestation.

## How it works

The cleanup path checks ownership, thread identity, process arguments, and launcher relationship before acting. The macOS SessionEnd hook uses the same identity-bound contract.

```text
> Inspect the detached Codex residue for this thread; reclaim it only when identity evidence is complete.
thread=opaque-thread-01
ownership=same-user  server=matched  launcher=matched
snapshot=paired  lock=acquired-for-read
recommendation=reap-safe
```

## Scope

Cleanup covers session residue tied to the selected Codex thread. Incomplete evidence produces a diagnostic result for operator review.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
thread=opaque-thread-01 action=reap
before_snapshot=matched
process_identity=verified
after_snapshot=absent
result=reclaimed
```

Next: [read doctor](/skills/doctor/).
