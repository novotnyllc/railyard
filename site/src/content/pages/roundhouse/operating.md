---
layout: default
title: Operating
parent: Roundhouse
nav_order: 3
---

# Run it

Roundhouse keeps routine convergence moving with one owned scheduler entry per host, then gives the operator focused verbs for explain, review, apply, membership, rollback, and doctor.

## Cadence and schedulers

The fast pass runs about every 20 minutes with ±5 minutes of name-seeded jitter. The full pass runs about every 12 hours with ±90 minutes of jitter. A prior autoupdate entry is absorbed into the owned scheduler entry so one host has one authority for each cadence.

The native shapes are:

```text
macOS   launchd user agent
Linux   systemd user timer
WSL     systemd user timer in the WSL environment
Windows Task Scheduler user task
```

The fast run polls, fetches, reconciles, reviews, applies, journals, publishes, and nudges peers. The full run adds marketplace refresh, package maintenance, evidence retention, and doctor rows.

## CLI reference

The owning skill resolves `CLI` to the installed script before use:

```sh
CLI="$SKILL_DIR/../../scripts/roundhouse"
```

Inspect and decide:

```sh
"$CLI" fleet-doctor
"$CLI" fleet-pending
"$CLI" fleet-explain host-a skills.my-review
"$CLI" fleet-review skills.my-review pass "receipt matches"
"$CLI" fleet-apply skills.my-review
```

```text
fleet-doctor
row=store                 state=ready       next=none
row=trust                 state=ready       reviewed_ref=main@sha256:2f4a...
row=convergence           state=ready       last_run=2026-08-13T09:21:04Z
row=transport             state=ready       evidence=host-task-transport
result=ready
```

```text
fleet-pending
item=hooks.review-gate   reason=hook-approval       host=host-a
item=packages.legacy-tool reason=review-required    host=host-a
count=2
```

Membership and lifecycle:

```sh
"$CLI" fleet-add host-a --job fleet-agent
"$CLI" fleet-remove host-a
"$CLI" fleet-rollback skills.my-review --now
"$CLI" fleet-reconstitute host-a
```

```text
fleet-add host-a --job fleet-agent
identity=created class=durable
possession_proof=verified
roster_commit=signed
published=main@origin
result=ready-for-soak
```

```text
fleet-remove host-a
roster=retired
future_authority=held
evidence_cleanup=scheduled
published=main@origin
result=removed
```

```text
fleet-rollback skills.my-review --now
revert=reviewed
canary=required
apply=held
result=journaled
```

## Operator bounds

A run removes at most 5 items or 25% of the current item set, whichever is smaller. A retirement is one signed edit; the fleet sees it within one fast interval. Reparenting and reconstitution preserve the reviewed history and create new evidence for the changed relationship.

Next: [read the trust and security controls](/roundhouse/security/) or [inspect the scaling breakpoints](/desired-state/scaling/).
