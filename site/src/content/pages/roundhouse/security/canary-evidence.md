---
layout: default
title: Canary evidence
parent: Roundhouse
nav_order: 7
---

# Let evidence earn the next host

Let one host in an unattended fleet prove the exact signed digest under real operation, require that evidence to age, and confirm the canary is still speaking before widening the rollout. This turns fleet velocity into a paced, observable decision with a bounded blast radius.

For each item, a downstream host applies the exact digest only after the canary result has aged through the configured wait, stayed free of a later hold or revert, and remained live by publishing a later record.

## The liveness term

For item X at digest D, the downstream gate earns promotion through four checks:

- canary journaled `applied` or `satisfied` for D at `t0`;
- `t0` is at least the configured `canary_wait_hours` old, with a 24-hour default and fallback;
- no later `held` or `reverted` record covers D;
- the canary published any record after `t0 + canary_wait_hours`.

The last condition closes the silenced-canary case. A canary that stops publishing cannot silently authorize further spread. `satisfied` counts because the desired identity is still observed; `held` carries a refusal and keeps the prior applied value.

![Canary evidence sequence: a canary applies a digest, waits for the configured canary_wait_hours with a 24-hour default and fallback, publishes liveness, and either authorizes application or causes a hold.](/diagrams/m8-canary-evidence.svg)

The sequence keeps silence explicit: evidence without a later record or alive heartbeat is a hold, never a pass.

The wait plus the per-run removal cap bounds blast radius. An operator sees a named hold before another host applies the affected item.

## Receipt

In the successful story, `canary-1` applies the review skill, stays healthy through the configured 24-hour default window, and publishes again; only then does `host-a` apply the same digest:

```text
canary-1 item=skills.my-review digest=sha256:7c1a... result=applied at=t0
gate wait=24h(default/fallback) later_hold=none later_revert=none liveness=published
host-a item=skills.my-review digest=sha256:7c1a... result=applied
```

```text
canary-1 item=hooks.review-gate digest=sha256:12af... result=applied at=t0
gate wait=24h(default/fallback) later_hold=none later_revert=none liveness=silent
host-a item=hooks.review-gate digest=sha256:12af... result=held reason=canary-silent
```

In the second story, the canary goes silent after applying a review hook. The downstream host preserves its current state and records `canary-silent`, making missing liveness an actionable result.
