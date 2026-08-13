---
layout: default
title: Enrollment and TOFU
parent: Roundhouse
nav_order: 10
---

# Enroll a machine with the narrowest useful authority

Roundhouse has four enrollment flows. Each one records key possession, channel class, roster history, and the exact authority class that the new member receives.

## Four flows

1. **Genesis:** the first store creates the root history, owner key, roster, and reviewed reference.
2. **Sponsor-initiated `fleet-add`:** one instruction reaches a newcomer over an already-trusted channel; the sponsor installs prerequisites, the newcomer mints its own key, returns a public key plus possession-proof signature, and the sponsor publishes the roster edit.
3. **Newcomer-initiated `fleet-join`:** the newcomer creates an inert request. An operator verifies it out of band; the request is never applied as a roster edit by itself.
4. **Ephemeral leaf:** `channel_auth: runtime` binds the leaf to the runtime channel, gives the strongest first-contact binding, and provides evidence paths without a first-contact policy window.

## Soak by class

Durable enrollment over an already-trusted channel soaks shared-layer authority for 24 hours. Genuine first contact soaks for 72 hours. Ephemeral leaves get no soak because their class cannot write fleet layers or sponsor another member. Every roster change alerts on every host.

The delay gives an attacker a slower path when starting from a new key than when using an already-compromised member. It also gives the operator a distinct alert and an explicit review surface.

![Sponsor enrollment sequence: one owner instruction reaches an enrolled sponsor, which contacts the new host over a trusted lane, verifies key possession, and publishes the roster edit.](/diagrams/m9-enrollment.svg)

The diagram covers the sponsor-initiated flow; newcomer requests remain inert until out-of-band verification, and ephemeral leaves remain channel-bound.

## Sponsor receipt

```text
fleet-add host-a --job fleet-agent
channel=already-trusted-ssh
key=generated-on-target
possession_proof=verified
roster_edit=durable-signer
published=main@origin
policy_authority=soak-24h
evidence_paths=available-now
result=ready-for-soak
```

```text
fleet-join request=join-opaque-01
verification=out-of-band-required
apply=not-authorized
result=inert-request
```

Next: [attack shapes and residuals](/roundhouse/security/attack-shapes/) or [trust ratchet](/roundhouse/security/trust-ratchet/).
