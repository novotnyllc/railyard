---
layout: default
title: Threat model
parent: Security
nav_order: 1
---

# Threat model

The fleet trust model protects desired-state integrity through private-store custody, signed machine history, host-local verification, and apply-time evidence.

## System model and assets

The fleet store is a private jj repository of hand-editable YAML. Each machine carries a complete clone. The store describes agent configuration that executes as the invoking user, so authorship, path ownership, and review evidence are first-class assets.

The protected assets are:

- store integrity and signed history
- per-machine signing keys
- the roster, reviewed reference, generation, and revocation state
- private-store custody and the instruction chain that authorizes a change

## Trust flow

```text
owner instruction
    -> enrolled machine signs a commit
    -> private store carries the history
    -> every machine derives the roster and verifies the commit
    -> root-owned trust lane materializes approved state
    -> host-local review, canary, apply, and journal evidence
```

Trust is established by the authorized instruction chain and private-store custody. Every receiving machine consumes that trust through independent signature and roster checks.

## Boundary 1: signed-history ratchet

A commit is accepted when its signature is good, the signing principal matches its committer identity, the principal belongs to the roster derived from every parent, the current reviewed roster still grants authority, the key is active, and the key class permits the touched paths.

The parent roster gives membership a monotonic history. A trusted member signs an addition; a retirement removes future authority while preserving the validity of prior commits.

## Boundary 2: private-store custody and instruction integrity

The private store controls participation. The instruction chain controls what an enrolled agent is asked to do. A correctly authorized instruction can produce a correctly signed commit, so the system makes that event observable through roster alerts, soak windows, receiving-host review, canary evidence, removal caps, and revocation.

## Boundary 3: user-to-root trust lane

Where the protected lane is installed, root-owned trust files carry the allowed-signers state, reviewed ref, generation, and revocation list. A hermetic broker re-derives the roster from signed history and writes the materialized state atomically. The same-user signing key remains a host identity; root ownership protects the persistence boundary after revocation.

## Boundary 4: receiving-host apply

The receiving host verifies the commit, resolves the item, checks ownership and review, waits for canary evidence, applies through the owning manager, and publishes a journal record. Held items keep their applied value and carry a reason for operator attention.

## Principal capabilities

| Principal | Capability surface |
| --- | --- |
| Durable member | shared layers, own evidence, sponsorship, checkpoint, re-root |
| Ephemeral member | own host-keyed evidence for its lifetime |
| Store reader | complete clone and history according to repository custody |
| Root process | local trust materialization under the hermetic broker |

Class is recorded in the roster and evaluated from signed history. A leaf's path scope remains a leaf scope even when the machine is active.

## Threat response

| Event | Observable control |
| --- | --- |
| Unrecognized signature | item hold and verification finding |
| Roster change | alert on every host and recap priority |
| New member | enrollment record and soak for shared-layer authority |
| Conflicting item values | item-level hold with both sides available for resolution |
| Excess removals | removal-set hold and alert |
| Retired key | future commits lose roster membership |
| Broker degradation | doctor finding and trust-lane status |

## Assumptions

The design assumes a single operator, a private store, complete peer clones, same-user readable signing keys, and a store whose desired content executes by design. Availability, physical custody, account recovery, and instruction intent remain operator responsibilities; the system provides signed attribution, scoped authority, containment, and evidence for those boundaries.

## Reader takeaway

Every change has an owner, a signed history position, a path scope, a receiving-host review, and an observable outcome. The result is a trust model that tells the operator who can write, what can apply, where the decision happened, and which evidence supports it.

Source basis: `roundhouse/docs/security/threat-model.md`, adapted for reader-facing current-state guarantees.

Next: [read the trust model](/fleet/trust/) or [follow convergence](/fleet/convergence/).
