---
layout: default
title: Fleet hosts
parent: Skills
nav_order: 16
---

# Fleet hosts

Fleet hosts establishes and retires machine membership with identity, transport, prerequisite, and readiness evidence.

## What it adds

The skill records the machine entry, checks reachability, creates or verifies the machine key, handles explicit enrollment steps, and hands the final result to fleet readiness.

## How it works

Enrollment binds the roster identity to the configured transport identity. Revocation records the chain change, cleans the machine's managed state, and makes the future authority result visible across the fleet.

## Scope

Fleet hosts owns membership lifecycle, identity, enrollment, revocation, and prerequisite handoff. Remote administration owns the bounded command lane after the host is selected.

## Source

Ships in the `roundhouse` plugin.

## Proof point

The source skill defines enrollment ceremony, key possession evidence, target prerequisites, and readiness verification.

Next: [read trust](/fleet/trust/) or [bring up a first machine](/start/first-machine/).
