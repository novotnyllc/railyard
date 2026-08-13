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

```text
> Add host-a through the trusted channel, verify key possession, and show its readiness handoff.
channel=trusted-ssh  prerequisites=ready
key=generated-on-target  possession_proof=verified
roster_commit=signed  publication=main@origin
handoff=fleet-readiness
```

## Scope

Fleet hosts owns membership lifecycle, identity, enrollment, revocation, and prerequisite handoff. Remote administration owns the bounded command lane after the host is selected.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
host=host-a class=durable
identity=verified transport=ready
roster=published soak=24h
result=ready-for-readiness
```

Next: [read the trust ratchet](/roundhouse/security/trust-ratchet/) or [bring up a first machine](/start/first-machine/).
