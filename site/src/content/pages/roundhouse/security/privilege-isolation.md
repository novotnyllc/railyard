---
layout: default
title: Privilege isolation
parent: Roundhouse
nav_order: 9
---

# Privileged actions use a sealed semantic surface

Privilege in an unattended fleet should enter only after signed evidence and canary gates resolve it to a named, bounded action; the root boundary then executes sealed meaning. Unattended maintenance runs against an inspectable catalog, explicit grants, and protected trust state.

Roundhouse enforces this boundary with two root-owned components. `roundhouse-trustd` materializes roster, reviewed reference, generation, and KRL state by re-deriving the roster from signed history. The privilege broker executes only a fixed catalog of sealed semantic actions.

Invoking the trust daemon cannot inject a caller-supplied hostile roster: the daemon computes the materialized state from the signed store. The broker receives an action name and bounded data, not an arbitrary root shell.

## Shared hardening pattern

Keep every path to privilege narrow and independently inspectable:

- sudoers grants the exact binary, not a directory or interpreter.
- The invocation uses a hermetic `env -i … sudo -n` environment.
- Every sourced library verifies its ownership before execution.
- The root lane carries the reviewed reference, generation, roster, and revocation list as separately protected state.

## Unattended update gates

Earn unattended privilege through two explicit flags: the catalog flag and the per-binding grant. The binding also needs three provenance anchors:

1. channel-bound, root-anchored provenance;
2. publisher-bound signed payloads with stapled notarization, or a fail-closed result;
3. byte-pinned payloads reserved for attended-only use.

Every unattended binding carries a mandatory version floor and canary gate. For Homebrew, root executes only from a root-owned attested tap snapshot, never a user-owned path.

## Receipt

When a package binding reaches root, the operator needs evidence that trust material came from signed history and the install request satisfied catalog, grant, provenance, version, canary, and payload gates:

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
