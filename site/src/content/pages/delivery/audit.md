---
layout: default
title: Audit
parent: Delivery
nav_order: 4
---

# Audit

Keep enough evidence to explain why the run deserved to finish. A compact audit turns routes, dispatches, checks, review rounds, retries, and terminal proof into an operating asset: the next delivery can reuse sound decisions and improve the expensive ones.

## The record

Record the approach before the work starts, then append route decisions, outcomes, and deviations as metadata. The run log preserves why each action happened while prompts, diffs, and provider output stay outside the metadata record.

## Write the decision chain

Open every substantial run with the decision that will later grade it: `what:"approach"` and a `because` value naming the loop, isolation boundary, done evidence, and long pole. Append only three doctrine events after that—`decision`, `outcome`, and `deviation`—through the installed run-log helper:

```sh
node <railyard-plugin-root>/hooks/run-log.js note \
  '{"event":"decision","what":"approach","because":"isolate one writer; prove build, review, merge, and live result"}'

node <railyard-plugin-root>/hooks/run-log.js note \
  '{"event":"decision","what":"fix batch","because":"review found one shared gap","fed_by":"independent review","led_to":"second focused check"}'

node <railyard-plugin-root>/hooks/run-log.js note \
  '{"event":"outcome","what":"second focused check","result":"passed","fed_by":"fix batch"}'
```

`fed_by` and `led_to` use plain labels, so a human can reconstruct what caused what without an ID scheme. The helper stamps the current session and keeps labels bounded. Mechanical hook lines add allowed dispatches and session anchors; a refused dispatch does not masquerade as work that ran.

## The report

Read the primary run log as a decision chain, then map each planned item and workaround to captured evidence. The audit report separates:

- route selected and actual carrier
- active lanes and dispatch count
- checks run, input scope, and exit status
- review findings and fix rounds
- Git, pull request, merge, and post-merge state
- deviations and reusable lessons

## The retrospective

Grade a substantial run against its opening approach: which check carried the proof, which work ran in parallel, which input stayed unchanged, and where the route changed. The answers become reusable suggestions when the skill or process can improve.

Route repository-specific lessons through `compound-engineering:ce-compound`. Cross-repository routing lessons live in the human-editable `~/.config/railyard/learnings.md`; issue-ready upstream improvements land as one file under `~/.config/railyard/suggestions/`. A suggestion remains a prepared artifact until the operator authorizes publication.

## Useful commands

```text
railyard:model-routing status
railyard:model-routing inspect-claim
railyard:audit
```

The [Audit skill](/skills/audit/) is the working mechanism that reads this evidence and presents it as a decision chain.

```text
railyard:model-routing status
{"contractVersion":"railyard/model-routing/v1","ok":true,"reason":"status","readiness":{},"reservations":[],"spend":{},"learning":{"enabled":true,"outcomes":0,"aggregates":0}}

railyard:model-routing inspect-claim --claim-id claim-opaque-01
{"contractVersion":"railyard/model-routing/v1","ok":true,"reason":"claim_verified","claim":{"claimId":"claim-opaque-01","reservationId":"reservation-opaque-01","state":"claimed","selected":{"carrierId":"codex-luna","carrierVersion":"v1","executionSurface":"codex"}}}

railyard:audit
recap=route+dispatches+checks
audit=primary-record sweep deviations=captured
retrospective=5 questions sink=local-learning
```

`inspect-claim` is an active-claim check; a settled outcome comes from the fixed-adapter `reconcile` receipt. The three audit depths share one anonymized run: the recap reports the terminal state, the audit reconstructs the decision chain, and the retrospective grades the run against its opening approach.
