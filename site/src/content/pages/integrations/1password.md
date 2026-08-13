---
layout: default
title: 1Password
parent: Integrations
nav_order: 3
---

# 1Password integration

1Password adds controlled custody for auth-artifact references and verification commands; the core system operates fully without it.

## Easy path

```text
> Check the configured auth artifacts and show which ones need attention.
```

## What it adds

The configuration surface can record an `op://` reference, portability class, file mode, verification command, and reauthentication command. The fleet-auth flow reports presence and health while keeping secret values in the custody system.

## The seam

Auth-artifact records remain per machine or portable references according to their declared strategy. Delivery and fleet convergence consume the verified presence result while custody remains with the auth system.

## Proof point

The configuration source documents encrypted-install references, reauthentication flows, modes, size bounds, and verification commands. Source: `roundhouse/docs/config.md`.

## Next

[Read fleet configuration](/fleet/config/) or [see integrations](/integrations/).
