---
layout: default
title: Anti-rollback
parent: Roundhouse
nav_order: 6
---

# History moves forward, including after a re-root

Every host in an unattended fleet needs a durable memory of the newest trusted position, so signed evidence and canary results continue to govern current intent. Forward-only adoption keeps autonomous recovery useful and turns a downgrade attempt into a visible operator decision.

Roundhouse gives each privileged host two monotonic high-water marks: `generation` never decreases, and every adopted head descends from `reviewed-ref`. A fetched head that violates either mark is held and alerted before it can become desired state.

## Decision path

**Action arrives:** a host fetches a signed head that proposes the next desired-state position. **Authority check:** signed history must still connect to the host's reviewed reference. **Propagation gate:** ancestry and the monotonic generation mark advance together; a legitimate re-root also supplies the published archive that contains the prior reference. **Outcome:** the host records `result: adopted`, or preserves reviewed state with `result: held` and `alert: anti-rollback`. **Residual:** an operator still authorizes genuine history migration by publishing and retaining the archive evidence.

## Adoption decision

![Anti-rollback decision: ancestry and generation checks adopt and advance marks; a re-root requires a published archive and ordinary ratchet verification, otherwise the host holds and alerts.](/diagrams/m10-anti-rollback.svg)

Read the diagram as the operator's recovery decision: a missing archive is itself a hold plus alert, which is the rollback protection.

The checkpoint re-root protocol keeps a legitimate history migration byte-for-byte indistinguishable from a rollback attack except for one mandatory published archive ref. A host that was offline across the re-root verifies its own reviewed reference inside that archive using the ordinary trust ratchet. An absent archive produces hold plus alert; that refusal is the protection.

## Receipt

After a routine fetch, the host can show that generation 18 descends from its reviewed reference and was adopted:

```yaml
reviewed_ref: main@change-2f4a
fetched_head: main@change-2f4a
generation: 18
high_water_generation: 18
descends_from_reviewed_ref: true
result: adopted
```

```yaml
reviewed_ref: main@change-1a00
fetched_head: main@change-0f00
generation: 17
high_water_generation: 18
archive_ref: absent
result: held
alert: anti-rollback
```

In the higher-stakes case, an anonymized host sees generation 17 after it has already trusted generation 18. An absent archive leaves the re-root unauthorized, so the host preserves the reviewed state and raises `anti-rollback`.

The mark is root-owned where the privileged lane exists. The store's ordinary signed history remains the source of the reviewed reference.
