---
layout: default
title: Attack shapes
parent: Roundhouse
nav_order: 11
---

# What each control contains, detects, or refuses

Roundhouse describes security by outcome. The operator can see which path an attack takes, which gate stops it, and which residual remains outside the technical model.

## Compromised member enrolls an attacker

The attacker can propose a roster edit, but review, held hooks, canary evidence, removal caps, soak, and fleet-wide alerts keep the new authority from spreading silently. The result is a named, contained roster change for operator action.

## Stolen machine key

The blast radius is one machine's class and path scope. A one-edit retirement propagates within one fast interval; future commits lose roster membership while prior history remains attributable. The fleet keeps operating while the stolen key is retired.

## Replay or downgrade of older history

Reviewed-reference ancestry and the monotonic generation mark hold a fetched head that travels backward. A published archive can authorize a legitimate re-root after ordinary ratchet verification; an absent or invalid archive produces hold plus alert. Replay buys persistence for an offline host, never new write entry.

## First-contact TOFU MITM

A genuine first-contact durable enrollment receives a 72-hour soak and a loud, distinct alert class. The real machine does not join while an operator expects one to. An ephemeral runtime-authenticated leaf uses its channel binding and has no first-contact window.

## Hub credential theft

The hub remains an outer boundary, never the authorization boundary. Every commit still needs a valid signer at its parent position and a permitted class. Credential theft can disclose or reduce availability, but it does not manufacture write authority.

## Named residuals

- Instruction-chain compromise has no technical mitigation: containment applies, detection does not.
- TOFU on genuine first contact is structurally open; the soak and alert make that exposure visible and slower.
- A host offline since before a revocation can retain persistence until it reconnects; reviewed-reference checks contain adoption when it returns.
- A same-user-writable roster without a privileged lane or passwordless sudo reduces the model to no effective root boundary.
- Availability is out of scope for authority: controls hold and alert rather than pretending an unavailable host has converged.

## Receipt

```text
shape=stolen-machine-key
retirement=commit-signed-and-published
future_commits=held
blast_radius=host-a-only
propagation=one-fast-interval
fleet_availability=continues
```

The receipt names the control outcome and residual separately, so a contained attack is not reported as a universal prevention claim.

Next: [security hub](/roundhouse/security/) or [anti-rollback](/roundhouse/security/anti-rollback/).
