---
layout: default
title: 1Password
parent: Integrations
nav_order: 3
---

# 1Password integration

Keep authentication material in a custody system and let delivery consume only references and verified health. This gives operators a practical way to move work across machines while secret values remain governed, local strategy stays explicit, and readiness can still be proven.

The optional 1Password integration supplies controlled custody for auth-artifact references and verification commands; the core system remains fully operational on its own.

## Easy path

An operator preparing a remote delivery channel needs to know which configured artifacts are healthy before work starts while their values stay inside the custody system:

```text
> Check the configured auth artifacts and show which ones need attention.
```

## The run

The operator asks which authentication artifacts are ready for a placed delivery while their values remain in custody. 1Password owns the secret references and reauthentication path; Roundhouse records portability, mode, verification command, and health for the receiving machine. The turn is the readiness decision made from presence and verification rather than exposed values. The run closes when the fleet-auth receipt reports each configured artifact as healthy or names the bounded attention it needs.

## What it adds

Record exactly what the fleet needs to verify. The configuration surface can carry an `op://` reference, portability class, file mode, verification command, and reauthentication command. The fleet-auth flow reports presence and health while keeping secret values in the custody system.

## The seam

Keep custody and readiness as separate responsibilities. Auth-artifact records remain per machine or portable references according to their declared strategy. Delivery and fleet convergence consume the verified presence result while custody remains with the auth system.

## Proof point

The [Roundhouse store reference](/roundhouse/store/) documents the configuration fold that carries encrypted-install references, reauthentication flows, modes, size bounds, and verification commands.

## Next

[Read the Roundhouse store](/roundhouse/store/) or [see integrations](/integrations/).
