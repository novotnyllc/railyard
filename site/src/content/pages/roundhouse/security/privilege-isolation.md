---
layout: default
title: Privilege isolation
parent: Roundhouse
nav_order: 9
---

# Privileged actions use a sealed semantic surface

Two root-owned components protect the privileged boundary. `roundhouse-trustd` materializes roster, reviewed reference, generation, and KRL state by re-deriving the roster from signed history. The privilege broker executes only a fixed catalog of sealed semantic actions.

Invoking the trust daemon cannot inject a caller-supplied hostile roster: the daemon computes the materialized state from the signed store. The broker receives an action name and bounded data, not an arbitrary root shell.

## Shared hardening pattern

- sudoers grants the exact binary, not a directory or interpreter.
- The invocation uses a hermetic `env -i … sudo -n` environment.
- Every sourced library verifies its ownership before execution.
- The root lane carries the reviewed reference, generation, roster, and revocation list as separately protected state.

## Unattended update gates

An unattended privileged binding needs both flags: the catalog flag and the per-binding grant. It also needs three provenance anchors:

1. channel-bound, root-anchored provenance;
2. publisher-bound signed payloads with stapled notarization, or a fail-closed result;
3. byte-pinned payloads reserved for attended-only use.

Every unattended binding carries a mandatory version floor and canary gate. For Homebrew, root executes only from a root-owned attested tap snapshot, never a user-owned path.

## Receipt

```text
roundhouse-trustd action=materialize-roster
source=signed-history reviewed_ref=main@change-2f4a generation=18
caller_roster=ignored
result=ready

privilege-broker action=install-binding binding=package.tool
catalog_flag=true grant_flag=true provenance=channel-rooted
version_floor=4.2 canary=passed payload=attested
result=allowed
```

Next: [enrollment and TOFU](/roundhouse/security/enrollment-and-tofu/) or [attack shapes](/roundhouse/security/attack-shapes/).
