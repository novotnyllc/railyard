---
layout: default
title: Security
parent: Roundhouse
nav_order: 4
has_children: true
---

# Trust that keeps converging changes contained

Roundhouse reduces fleet authority to two operator-held facts: custody of the private store and integrity of the instruction chain. Signed history, parent-position checks, canary evidence, redaction, privilege isolation, and explicit residuals turn those facts into controls that contain, detect, or refuse a change.

Roundhouse's signed trust ratchet answers the same “is this genuinely what it claims to be” question MCP provenance proposals are reaching for, but ships it today as a pull-based convergence loop across a whole personal fleet, not a one-time check at connection time.

## Security map

- [Trust ratchet](/roundhouse/security/trust-ratchet/) — parent-position signatures, membership classes, and revocation.
- [Anti-rollback](/roundhouse/security/anti-rollback/) — reviewed references, generations, and checkpoint re-rooting.
- [Canary evidence](/roundhouse/security/canary-evidence/) — the 41-hour wait, liveness, and blast-radius cap.
- [Redaction](/roundhouse/security/redaction/) — per-commit secret scanning with an entropy floor and 400-byte cap.
- [Privilege isolation](/roundhouse/security/privilege-isolation/) — root-owned trust material and sealed semantic actions.
- [Enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/) — four enrollment flows and class-scoped soak.
- [Attack shapes](/roundhouse/security/attack-shapes/) — outcomes and named residuals.

The outer boundary remains operator custody and instruction intent. Availability is handled as a hold-and-alert concern; the controls below make authorship, scope, review, and propagation observable.

```text
authority = store custody + instruction-chain integrity
commit    = signed identity + parent roster + path class
apply     = review + canary evidence + owner manager
outcome   = journaled result or named hold
```
