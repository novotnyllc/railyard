---
layout: default
title: Trust
parent: Fleet
nav_order: 3
---

# Trust

The fleet trust model binds every store write to a machine key, a signed history, a roster position, and a permitted path class.

## The ratchet

`trust/signers.yaml` lists the keys that may write. A roster change is valid when a key already trusted by the parent history signs it. Every host derives the roster from each commit's parents, checks the signature principal against the committer identity, checks the current reviewed roster, and evaluates the key's class for the paths touched.

This parent-position rule gives membership a forward-only history. A signed addition extends the roster; a signed retirement removes future authority while preserving the validity of prior work.

## Two membership classes

| Class | Shared layers | Own evidence paths | Sponsorship |
| --- | --- | --- | --- |
| `durable` | write | write | may sponsor durable or ephemeral members |
| `ephemeral` | evidence scope | write | leaf class; sponsorship stays with durable members |

Path identity is part of the check: a journal entry under `journal/<machine>/` carries that machine's signing principal.

## Enrollment

`fleet-add <machine>` establishes a machine's identity, reads back its public key over the configured transport, records the roster change, publishes it, and requests a readiness proof. The sponsor's signed enrollment commit becomes an ancestor of the newcomer’s store work.

The enrollment record includes the channel class and a soak period for shared-layer authority. Evidence paths become available as the machine joins, while shared-layer authority becomes available when the roster history allows it.

## Revocation

`fleet-remove <machine>` moves the member to `retired`, records the revocation commit, and publishes the chain change. Future commits from the retired key lose roster membership at their parent; prior commits retain their historical validity. An emergency burn adds a key to the local revocation list and makes the effect immediate for that host.

## Privilege boundary

When a protected trust lane is installed, root-owned trust material carries the allowed-signers state, reviewed ref, generation, and revocation list. A hermetic broker re-derives the roster from signed history before materializing it. The ordinary setup flow and the privileged lane have separate explicit consent surfaces.

## What the model rests on

The outer boundary is custody of the private store and integrity of the instruction chain that asks a trusted machine to write. The ratchet provides authorship, the receiving-host review and canary gates provide containment, and the roster alert plus revocation path provide a fast operator response.

## Proof point

The trust source documents the parent roster rule, durable and ephemeral classes, enrollment, revocation, root-owned materialization, and the actor/capability matrix. Source: `roundhouse/docs/trust.md`.

Next: [read the reader-facing threat model](/security/threat-model/) or [follow convergence](/fleet/convergence/).
