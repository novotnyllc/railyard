---
layout: default
title: Enrollment and TOFU
parent: Roundhouse
nav_order: 10
---

# Enroll a machine with the narrowest useful authority

New members should enter an unattended fleet through the narrowest authority that can do their job, with key possession and channel trust recorded before signed evidence can spread through canary gates. Useful automation keeps first contact, sponsorship, and fleet-layer reach visible to every operator.

TOFU means trust-on-first-use: the first contact receives a bounded policy window and remains visible until the operator verifies the new identity.

Roundhouse enrolls new members through four flows. Each one records key possession, channel class, roster history, and the exact authority class that the new member receives.

## Four flows

Choose the flow by the trust already available at the moment a machine joins:

1. **Genesis:** the first store creates the root history, owner key, roster, and reviewed reference.
2. **Sponsor-initiated `fleet-add`:** one instruction reaches a newcomer over an already-trusted channel. The sponsor confirms a resolvable SSH name, private remote, `jj`, `yq`, and `roundhouse`; the target has its agent harness, plugins, `tmux`, and `jq` ready. The newcomer mints its own key, returns a public key plus possession-proof signature, and the sponsor publishes the roster edit.
3. **Newcomer-initiated `fleet-join`:** the newcomer creates an inert request. An operator verifies it out of band; the request is never applied as a roster edit by itself.
4. **Ephemeral leaf:** `channel_auth: runtime` binds the leaf to the runtime channel, gives the strongest first-contact binding, and provides evidence paths without a first-contact policy window.

## Soak by class

Match the soak to the authority class. Durable enrollment over an already-trusted channel soaks shared-layer authority for 24 hours. Genuine first contact soaks for 72 hours. Ephemeral leaves get no soak because their class cannot write fleet layers or sponsor another member. Every roster change alerts on every host.

The delay gives an attacker a slower path when starting from a new key than when using an already-compromised member. It also gives the operator a distinct alert and an explicit review surface.

![Sponsor enrollment sequence: one owner instruction reaches an enrolled sponsor, which contacts the new host over a trusted channel, verifies key possession, and publishes the roster edit.](/diagrams/m9-enrollment.svg)

The diagram covers the sponsor-initiated flow; newcomer requests remain inert until out-of-band verification, and ephemeral leaves remain channel-bound.

## Sponsor receipt

An operator adding an anonymized durable host over already-trusted SSH needs proof that the key was generated on the target, possession was verified, and shared authority entered its soak. The receipt keeps that chain intact:

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

For a newcomer-initiated request, the stakes change: the request remains inert and makes the required out-of-band verification explicit.

## Failure and recovery

- **Enrollment expired or was rejected:** leave the roster unchanged, inspect the receipt reason, and repeat the flow after the sponsor and target prerequisites are current.
- **The sponsor channel is unreachable:** restore the already-trusted channel and retry the same enrollment flow; do not fall back to an unverified first contact.
- **Key generation failed:** generate the key on the newcomer, keep its private key there, and restart possession proof before publishing a roster edit.
