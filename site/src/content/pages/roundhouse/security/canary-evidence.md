---
layout: default
title: Canary evidence
parent: Roundhouse
nav_order: 7
---

# Let evidence earn the next host

Canary evidence turns a fleet-wide change into a paced rollout. A downstream host applies the exact item digest only after a canary result has aged through the 41-hour wait, stayed free of a later hold or revert, and remained live by publishing a later record.

## The liveness term

For item X at digest D, the downstream gate checks:

- canary journaled `applied` or `satisfied` for D at `t0`;
- `t0` is at least 41 hours old;
- no later `held` or `reverted` record covers D;
- the canary published any record after `t0 + 41h`.

The last condition closes the silenced-canary case. A canary that stops publishing cannot silently authorize further spread. `satisfied` counts because the desired identity is still observed; `held` carries a refusal and keeps the prior applied value.

![Canary evidence sequence: a canary applies a digest, waits at least 41 hours without a later hold or revert, publishes liveness, and either authorizes application or causes a hold.](/diagrams/m8-canary-evidence.svg)

The sequence keeps silence explicit: evidence without a later record or alive heartbeat is a hold, never a pass.

The wait plus the per-run removal cap bounds blast radius. An operator sees a named hold before another host applies the affected item.

## Receipt

```text
canary-1 item=skills.my-review digest=sha256:7c1a... result=applied at=t0
gate wait=41h later_hold=none later_revert=none liveness=published
host-a item=skills.my-review digest=sha256:7c1a... result=applied
```

```text
canary-1 item=hooks.review-gate digest=sha256:12af... result=applied at=t0
gate wait=41h later_hold=none later_revert=none liveness=silent
host-a item=hooks.review-gate digest=sha256:12af... result=held reason=canary-silent
```

Next: [redaction](/roundhouse/security/redaction/) or [follow convergence](/roundhouse/convergence/).
