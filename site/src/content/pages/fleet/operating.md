---
layout: default
title: Operating
parent: Fleet
nav_order: 4
---

# Operating a fleet

The scheduler keeps routine convergence moving; the operator reaches for explain, review, apply, membership, rollback, and doctor when a decision needs attention.

## Inspect and decide

```text
roundhouse fleet-explain [MACHINE] ITEM
roundhouse fleet-pending
roundhouse fleet-review ITEM pass|hold REASON
roundhouse fleet-apply ITEM
roundhouse fleet-hold ITEM REASON
roundhouse fleet-finding SLUG SUMMARY
roundhouse fleet-journal ENTRY.json|-
roundhouse fleet-rollback ITEM [--now]
```

A verdict binds to the item digest. Editing the item produces a fresh digest and a fresh review surface.

## Membership

```text
roundhouse fleet-add MACHINE [--ephemeral] [--job JOB] [--ttl HOURS]
roundhouse fleet-join REMOTE
roundhouse fleet-remove MACHINE [--burn]
roundhouse fleet-renew NAME [HOURS]
roundhouse fleet-reconstitute MACHINE
```

## Store lifecycle

```text
roundhouse fleet-init
roundhouse fleet-enroll
roundhouse fleet-set-remote URL
roundhouse fleet-verify-remote
roundhouse fleet-seed
roundhouse fleet-run --fast
roundhouse fleet-run --full
```

The fast run handles the poll floor, fetch, reconcile, review, apply, journal, publication, and peer nudge. The full run adds refresh, package maintenance, retention, and doctor.

## Policy

Cadence, jitter, canary group, canary wait, removal caps, peer nudge, and evidence retention live in the store's `fleet.yaml` policy block. One scheduler entry per machine invokes `fleet-run` through the host's native scheduler.

## Doctor

`roundhouse fleet-doctor` reports prerequisite, trust, store, convergence, and transport rows. It gives the operator a current table of observed state and the next action for each finding.

## Evidence

Journals, applied records, alerts, findings, and upstream records carry the machine's own outcome and digest. `fleet-pending` gathers open replicated alerts for the operator.

## Proof point

The operating source documents the command surface, cadence, policy keys, doctor rows, and audit paths. Source: `roundhouse/docs/operating.md`.

Next: [read configuration](/fleet/config/) or [inspect the store](/fleet/store/).
