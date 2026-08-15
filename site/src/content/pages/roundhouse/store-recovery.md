---
layout: default
title: Store recovery
parent: Roundhouse
nav_order: 4
---

# Recover relationships and history deliberately

Use a small recovery verb for a small continuity event and a checkpointed protocol for a new history root. Expired leaves, orphaned relationships, and long-lived store history are different problems; keeping their mechanisms separate preserves the evidence each one needs.

## The run

The operator sees aging history after routine leaf churn. Roundhouse first renews the leaf that still owns the same key, reparents orphaned leaves to a durable member, and takes a signed checkpoint at the reviewed head. The turn is deciding that history itself needs a new root. The run closes only after `fleet-reroot` publishes the mandatory archive reference and every returning host can distinguish the deliberate new root from rollback.

## Renew identity continuity

```sh
roundhouse fleet-renew NAME [HOURS]
```

Renewal keeps the same key and records a fresh ephemeral window. Past commits remain valid at their position in history; the new window authorizes later host-owned evidence without turning a stopped container into a new identity ceremony.

## Reparent orphaned leaves

```sh
roundhouse fleet-reparent
```

Any durable member can adopt leaves whose former sponsor departed. Sponsorship fields are cleanup metadata rather than signature authority, so reparenting restores an operational relationship without rewriting the leaf's signed identity or invalidating its earlier evidence.

## Checkpoint before re-rooting

```sh
roundhouse fleet-checkpoint
roundhouse fleet-reroot
```

`fleet-checkpoint` writes one ordinary ratchet-valid record and tags the signed roster-and-state commit. The tag makes the checkpoint and its ancestors immutable under the store's `jj` policy; a bookmark does not carry that property.

`fleet-reroot` starts from that selected tagged checkpoint, publishes the old line under the mandatory archive reference, and then establishes the new root. It requires local `main` and fetched `main@origin` to agree with the checkpoint and refuses a sibling reviewed line it cannot prove. A delegated invocation can bind an optional one-use `--authority-receipt` to the exact checkpoint and instruction.

The archive is protocol evidence. An offline host returning after the operation sees its previous reviewed reference outside the new root's ancestry; the archive proves that the break was deliberate and preserves the line it used to trust.

```text
renew leaf=job-opaque key=unchanged window=8h
reparent adopted=3 signer=durable-host-a
checkpoint=change-2f4a tag=checkpoint-opaque
archive_ref=published old_line=preserved
new_root=established rollback_explanation=verified
```

Evidence retention stays independent: expired leaf entries and host evidence age on the full cadence, while trust checkpointing remains a deliberate months-scale operation. Read [anti-rollback](/roundhouse/security/anti-rollback/) for the returning-host decision and [operating](/roundhouse/operating/) for normal lifecycle verbs.
