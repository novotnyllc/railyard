---
layout: default
title: Cleanup Codex
parent: Skills
nav_order: 9
---

# Cleanup Codex

Cleanup Codex identifies and reclaims residue from a crashed or detached Codex session through identity-bound process evidence.

## What it adds

Inspection reports matching session servers, process age, descriptors, and launcher state. Reap uses the exact session identity, a host-local lock, paired snapshots, and replacement attestation.

## How it works

The cleanup path checks ownership, thread identity, process arguments, and launcher relationship before acting. The macOS SessionEnd hook uses the same identity-bound contract.

## Scope

Cleanup covers session residue tied to the selected Codex thread. Incomplete evidence produces a diagnostic result for operator review.

## Source

Ships in the `railyard` plugin.

## Proof point

The source skill defines paired snapshots, same-user ownership, exact thread identity, and post-restart attestation.

Next: [read doctor](/skills/doctor/).
