---
layout: default
title: Anti-rollback
parent: Roundhouse
nav_order: 6
---

# History moves forward, including after a re-root

Each privileged host keeps two monotonic high-water marks: `generation` never decreases, and every adopted head descends from `reviewed-ref`. A fetched head that violates either mark is held and alerted before it can become desired state.

## Adoption decision

```text
head descends from reviewed-ref?  yes -> generation >= high-water? yes -> adopt
                                  no  -> archive ref exists?        yes -> verify archived reviewed-ref
                                                                                yes -> adopt
                                                                                no  -> hold + alert
                                                                  no  -> hold + alert
generation below high-water?      no  -> hold + alert
```

The checkpoint re-root protocol keeps a legitimate history migration byte-for-byte indistinguishable from a rollback attack except for one mandatory published archive ref. A host that was offline across the re-root verifies its own reviewed reference inside that archive using the ordinary trust ratchet. An absent archive produces hold plus alert; that refusal is the protection.

## Receipt

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

The mark is root-owned where the privileged lane exists. The store's ordinary signed history remains the source of the reviewed reference.

Next: [canary evidence](/roundhouse/security/canary-evidence/) or [trust ratchet](/roundhouse/security/trust-ratchet/).
