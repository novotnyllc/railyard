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

## Decision path

**Action arrives:** genesis, a sponsor, or a newcomer proposes a new fleet member. **Authority check:** the flow records channel class, key generation on the target, possession proof, sponsor authority, and any required out-of-band verification. **Propagation gate:** the signed roster edit and class-scoped soak determine when shared-layer authority can spread. **Outcome:** the receipt says `ready-for-soak`, keeps a newcomer request `inert`, or leaves the roster unchanged with the exact recovery reason. **Residual:** genuine first-contact TOFU remains visible through its 72-hour soak and alert class; ephemeral leaves avoid that window by staying channel-bound and unable to sponsor.

## Four flows

Choose the flow by the trust already available at the moment a machine joins:

1. **Genesis:** `roundhouse fleet-init` creates an unsigned, history-free store; `roundhouse fleet-enroll` mints the node key and makes the self-signed roster commit the genesis, then the store receives its verified-private remote.
2. **Sponsor-initiated `fleet-add`:** one instruction reaches a newcomer over an already-trusted channel. The sponsor confirms a resolvable SSH name, private remote, `jj`, `yq`, and `roundhouse`; the target has its agent harness, plugins, `tmux`, and `jq` ready. The newcomer mints its own key, returns a public key plus possession-proof signature, and the sponsor publishes the roster edit.
3. **Newcomer-initiated `fleet-join`:** the newcomer creates an inert request. An operator verifies it out of band; the request is never applied as a roster edit by itself.
4. **Ephemeral leaf:** `channel_auth: runtime` binds the leaf to the runtime channel, gives the strongest first-contact binding, and provides evidence paths without a first-contact policy window.

## Soak by class

Match the soak to the authority class. Durable enrollment over an already-trusted channel soaks shared-layer authority for 24 hours. Genuine first contact soaks for 72 hours. Ephemeral leaves get no soak because their class cannot write fleet layers or sponsor another member. Every roster change alerts on every host.

The delay gives an attacker a slower path when starting from a new key than when using an already-compromised member. It also gives the operator a distinct alert and an explicit review surface.

## Renew and reparent without changing identity

An ephemeral leaf whose window lapses keeps its previous signed history. `roundhouse fleet-renew NAME [HOURS]` gives the same key a fresh window for later host-owned evidence. `roundhouse fleet-reparent` lets a durable member adopt orphaned leaves; sponsorship remains cleanup metadata, so the operation changes the current relationship without rewriting the leaf's signing identity.

![Sponsor enrollment sequence: one owner instruction reaches an enrolled sponsor, which contacts the new host over a trusted channel, verifies key possession, and publishes the roster edit.](/diagrams/m9-enrollment.svg)

### Sequence

1. **Ask.** The owner sends one `fleet-add` instruction to an enrolled sponsor.
2. **Contact.** The sponsor reaches the newcomer over the already-trusted SSH lane.
3. **Prepare.** The sponsor installs prerequisites and starts `fleet-init` on the target.
4. **Key.** The newcomer mints its own key on the target.
5. **Prove.** The newcomer returns a public key and possession-proof signature.
6. **Return.** The sponsor sends the remote URL and store identity as data, never pasted authority.
7. **Publish.** The sponsor commits the roster line and pushes it.
8. **Arrive.** Enrollment is real only at `main@origin`; durable policy enters its soak while evidence paths are available immediately.

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
