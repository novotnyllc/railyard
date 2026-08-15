---
layout: default
title: Fleet hosts
parent: Skills
nav_order: 16
---

# Fleet hosts

Make machine membership a witnessed lifecycle. Bind roster identity to transport identity during enrollment, carry prerequisite evidence into readiness, and publish revocation as a visible authority change so every later operation starts from current trust.

## What it adds

Fleet hosts provides that lifecycle. It records the machine entry, checks reachability, creates or verifies the machine key, handles explicit enrollment steps, and hands the final result to fleet readiness.

## How it works

Enrollment binds the roster identity to the configured transport identity. Revocation records the chain change, cleans the machine's managed state, and makes the resulting authority state visible across the fleet.

For the first member, `roundhouse fleet-enroll` mints the node key and makes the self-signed roster commit the genesis. Later durable members arrive through the witnessed `fleet-add` flow. Ephemeral leaves retain identity continuity with `roundhouse fleet-renew NAME [HOURS]`; orphaned leaves move under a current durable sponsor through `roundhouse fleet-reparent` without changing their signing key.

```text
> Add host-a through the trusted channel, verify key possession, and show its readiness handoff.
channel=trusted-ssh  prerequisites=ready
key=generated-on-target  possession_proof=verified
roster_commit=signed  publication=main@origin
handoff=fleet-readiness
```

## Scope

Fleet hosts owns membership lifecycle, identity, enrollment, revocation, and prerequisite handoff. Remote administration owns the bounded command channel after the host is selected.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
host=host-a class=durable
identity=verified transport=ready
roster=published soak=24h
result=ready-for-readiness
```
