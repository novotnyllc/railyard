---
layout: default
title: Security
parent: Roundhouse
nav_order: 4
has_children: true
---

# Security

Trust has to travel with every unattended fleet change, earn wider propagation through signed evidence and canary results, and leave a receipt on each host. That operating discipline lets a fleet move at machine speed while keeping authority, blast radius, and operator intervention explicit.

Roundhouse reduces fleet authority to two operator-held facts: custody of the private store and integrity of the instruction chain. Signed history, parent-position checks, canary evidence, redaction, privilege isolation, and explicit residuals turn those facts into controls that contain, detect, or refuse a change.

Its signed trust ratchet gives every adopted host a pull-based answer to “is this genuinely what it claims to be,” carrying provenance from reviewed enrollment through fleet-wide convergence while keeping genuine first contact inside its documented TOFU soak and alert boundary.

## The run

The operator asks whether a signed fleet action has enough authority and evidence to propagate. Roundhouse checks store custody and instruction-chain integrity, verifies the signer at the parent position, applies the path-class and canary gates, and leaves the owner manager in control of the final action. The turn is the named decision: `applied` advances the reviewed value, while `held` or `refused` preserves it and identifies the missing evidence. The run closes when the host journal separates that outcome from the residual risk the operator still owns.

## Security map

- [Trust ratchet](/roundhouse/security/trust-ratchet/) — parent-position signatures, membership classes, and revocation.
- [Anti-rollback](/roundhouse/security/anti-rollback/) — reviewed references, generations, and checkpoint re-rooting.
- [Canary evidence](/roundhouse/security/canary-evidence/) — the configured canary wait, 24 hours by default and fallback, plus liveness and blast-radius caps.
- [Marketplace trust](/roundhouse/security/marketplace-trust/) — public catalog review, version pinning, and dependency disclosure.
- [Redaction](/roundhouse/security/redaction/) — per-commit secret scanning with an entropy floor and 400-byte cap.
- [Privilege isolation](/roundhouse/security/privilege-isolation/) — root-owned trust material and sealed semantic actions.
- [Enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/) — four enrollment flows and class-scoped soak.
- [Attack shapes](/roundhouse/security/attack-shapes/) — outcomes and named residuals.

The outer boundary remains operator custody and instruction intent. Availability is handled as a hold-and-alert concern; the controls below make authorship, scope, review, and propagation observable.

The [marketplace trust page](/roundhouse/security/marketplace-trust/) names the public catalog as a reviewable trust surface and discloses the dependencies included in the grouped install.

```text
authority = store custody + instruction-chain integrity
commit    = signed identity + parent roster + path class
apply     = review + canary evidence + owner manager
outcome   = journaled result or named hold
```
