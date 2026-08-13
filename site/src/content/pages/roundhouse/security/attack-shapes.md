---
layout: default
title: Attack shapes
parent: Roundhouse
nav_order: 11
---

# What each control contains, detects, or refuses

Security becomes operational when every hostile path through an unattended fleet ends in an observable outcome: contained scope, a detected condition, a refused change, or a named residual for human judgment. Signed evidence and canary gates make those outcomes durable, so operators can automate confidently while staying precise about the authority facts they still own.

Roundhouse describes security through those outcomes. The operator can see which path an attack takes, which gate stops it, and which residual remains outside the technical model.

![Trust boundaries: owner instruction reaches a signing key, signed history crosses the store boundary, and every other host verifies before applying after canary evidence or holding with an alert.](/diagrams/m4-trust-boundaries.svg)

The boundary map keeps store custody and instruction integrity visible as the two authority facts; the repository transports history but does not authorize it.

## Compromised member enrolls an attacker

A compromised member proposes a roster edit for an attacker. Review, held hooks, canary evidence, removal caps, soak, and fleet-wide alerts contain the new authority and surface the attempt. The result is a named roster change for operator action.

## Stolen machine key

When one machine key is stolen, the blast radius is one machine's class and path scope. A one-edit retirement propagates within one fast interval; future commits lose roster membership while prior history remains attributable. The fleet keeps operating while the stolen key is retired.

## Replay or downgrade of older history

When older history returns, reviewed-reference ancestry and the monotonic generation mark hold a fetched head that travels backward. A published archive can authorize a legitimate re-root after ordinary ratchet verification; an absent or invalid archive produces hold plus alert. Replay buys persistence for an offline host, never new write entry.

## First-contact TOFU MITM

At genuine first contact, a durable enrollment receives a 72-hour soak and a loud, distinct alert class. The real machine does not join while an operator expects one to. An ephemeral runtime-authenticated leaf uses its channel binding and has no first-contact window.

## Hub credential theft

If hub credentials are stolen, the hub remains an outer boundary, never the authorization boundary. Every commit still needs a valid signer at its parent position and a permitted class. Credential theft can disclose or reduce availability, but it does not manufacture write authority.

## Named residuals

- Instruction-chain compromise has no technical mitigation: containment applies, detection does not.
- TOFU on genuine first contact is structurally open; the soak and alert make that exposure visible and slower.
- A host offline since before a revocation can retain persistence until it reconnects; reviewed-reference checks contain adoption when it returns.
- A same-user-writable roster without a privileged lane or passwordless sudo reduces the model to no effective root boundary.
- Availability is out of scope for authority: controls hold the item and alert the operator until host evidence proves convergence.

## Receipt

An operator retiring a stolen key needs a compact answer to five questions: what changed, how far it could reach, how quickly retirement propagated, what future history does, and whether the rest of the fleet continues. The receipt keeps those stakes together:

```text
shape=stolen-machine-key
retirement=commit-signed-and-published
future_commits=held
blast_radius=host-a-only
propagation=one-fast-interval
fleet_availability=continues
```

The receipt names the control outcome and residual separately, so a contained attack is not reported as a universal prevention claim.
