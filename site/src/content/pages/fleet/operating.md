---
layout: default
title: Operating
parent: Fleet
nav_order: 4
---

# Operating a fleet

The scheduler keeps routine convergence moving; the operator reaches for explain, review, apply, membership, rollback, and doctor when a decision needs attention.

## Inspect and decide

Resolve `CLI` to the installed Roundhouse plugin's `scripts/roundhouse` before running these examples. The plugin does not assume a bare `roundhouse` executable on `PATH`; the owning skills use `CLI="$SKILL_DIR/../../scripts/roundhouse"`.

```sh
CLI="<roundhouse>/scripts/roundhouse"
"$CLI" fleet-explain [MACHINE] ITEM
"$CLI" fleet-pending
"$CLI" fleet-review ITEM pass|hold REASON
"$CLI" fleet-apply ITEM
"$CLI" fleet-hold ITEM REASON
"$CLI" fleet-finding SLUG SUMMARY
"$CLI" fleet-journal ENTRY.json|-
"$CLI" fleet-rollback ITEM [--now]
```

A verdict binds to the item digest. Editing the item produces a fresh digest and a fresh review surface.

## Membership

```text
"$CLI" fleet-add MACHINE [--ephemeral] [--job JOB] [--ttl HOURS]
"$CLI" fleet-join REMOTE
"$CLI" fleet-remove MACHINE [--burn]
"$CLI" fleet-renew NAME [HOURS]
"$CLI" fleet-reconstitute MACHINE
```

## Store lifecycle

```text
"$CLI" fleet-init
"$CLI" fleet-enroll
"$CLI" fleet-set-remote URL
"$CLI" fleet-verify-remote
"$CLI" fleet-seed
"$CLI" fleet-run --fast
"$CLI" fleet-run --full
```

The fast run handles the poll floor, fetch, reconcile, review, apply, journal, publication, and peer nudge. The full run adds refresh, package maintenance, retention, and doctor.

## Policy

Cadence, jitter, canary group, canary wait, removal caps, peer nudge, and evidence retention live in the store's `fleet.yaml` policy block. One scheduler entry per machine invokes `fleet-run` through the host's native scheduler.

## Doctor

`"$CLI" fleet-doctor` reports prerequisite, trust, store, convergence, and transport rows. It gives the operator a current table of observed state and the next action for each finding.

## Evidence

Journals, applied records, alerts, findings, and upstream records carry the machine's own outcome and digest. `fleet-pending` gathers open replicated alerts for the operator.

## Proof point

The operating source documents the command surface, cadence, policy keys, doctor rows, and audit paths. Source: `roundhouse/docs/operating.md`.

Next: [read configuration](/fleet/config/) or [inspect the store](/fleet/store/).
