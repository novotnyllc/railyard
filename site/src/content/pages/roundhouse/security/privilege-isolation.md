---
layout: default
title: Privilege isolation
parent: Roundhouse
nav_order: 9
---

# Privileged actions use a sealed semantic surface

Privilege in an unattended fleet should enter only after signed evidence and canary gates resolve it to a named, bounded action; the root boundary then executes sealed meaning. Unattended maintenance runs against an inspectable catalog, explicit grants, and protected trust state.

Roundhouse enforces this boundary with two root-owned components. `roundhouse-trustd` materializes roster, reviewed reference, generation, and KRL state by re-deriving the roster from signed history. The privilege broker executes only a fixed catalog of sealed semantic actions.

The shipped default catalog is 12 lines: one `policy|1|catalog=1` header plus 11 sorted action records. It names four APT actions, two macOS actions, two Windows profile actions, and three WinGet actions:

```text
apt.autoremove.v1
apt.install-package-version.v1
apt.update-metadata.v1
apt.upgrade-package.v1
macos.apply-system-setting.v1
macos.install-signed-pkg.v1
profile.apply-managed-bundle.v1
profile.inventory-managed-state.v1
winget.install-machine-package.v1
winget.inventory-machine.v1
winget.upgrade-machine-package.v1
```

Each record pins action ID, execution context, enabled state, constraint kind, and constraint digest. Policy can enable a known action and bind its exact constraints; it cannot turn the broker into an arbitrary command surface.

## Decision path

**Action arrives:** a resolved item requests one cataloged privileged operation. **Authority check:** `roundhouse-trustd` derives roster, reviewed reference, generation, and KRL state from signed history rather than caller data. **Propagation gate:** catalog flag, per-binding grant, provenance anchors, version floor, canary evidence, and payload attestation must agree. **Outcome:** the broker executes the sealed action and records `result=allowed`, or refuses the binding without opening an arbitrary root shell. **Residual:** a host without a genuinely root-owned lane retains a same-user trust boundary, which the operator must treat as a different security class.

Invoking the trust daemon cannot inject a caller-supplied hostile roster: the daemon computes the materialized state from the signed store. The broker receives an action name and bounded data, not an arbitrary root shell.

## Shared hardening pattern

Keep every path to privilege narrow and independently inspectable:

- sudoers grants the exact binary, not a directory or interpreter.
- The invocation uses a hermetic `env -i … sudo -n` environment.
- Every sourced library verifies its ownership before execution.
- The root lane carries the reviewed reference, generation, roster, and revocation list as separately protected state.

## Enroll the platform boundary

On POSIX hosts, the owner-operated `enroll-privilege-posix` ceremony installs the fixed broker, policy, constraints, dispatcher, and root-owned trust paths after preview. On Windows, `enroll-privilege-windows.ps1` installs the Administrator-owned broker generation; `privilege-broker-windows.ps1` runs sealed machine actions as LocalSystem. `register-profile-task-windows.ps1` and `profile-worker-windows.ps1` create the separate `RoundhouseProfileV1` ordinary-user S4U lane for managed profile bundles.

These enrollments are local owner boundaries. Agent workflows prepare public identity and policy inputs, inspect status, and submit already-sealed requests; the password or UAC confirmation remains with the person at the host.

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
