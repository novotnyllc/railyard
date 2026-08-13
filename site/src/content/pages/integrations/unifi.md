---
layout: default
title: UniFi
parent: Integrations
nav_order: 4
---

# UniFi integration

Drive network changes from the controller's live contract, bind each request to one exact operation, and verify the resulting controller and gateway state. Operators gain repeatable administration that respects the current device surface and produces evidence at the real consumer.

The optional UniFi integration supplies that workflow through the official Integration API; the core system remains fully operational on its own.

## Easy path

An operator needs to change live network state and wants the request shaped by the controller's current API description before any mutation occurs:

```text
> Read the live controller API description, plan the network change, and verify the result.
```

## What it adds

Start with the live control surface. The `unifi-network-api` skill refreshes the live OpenAPI description, selects the exact operation, applies a bounded request, and verifies controller and gateway state. The API key travels as a header and the request stays tied to the selected operation.

## Public reference

Use this integration page for the live-spec, bounded-operation, and verification contract. Read the [UniFi Network API skill reference](/skills/unifi-network-api/) for the worked invocation and receipt.

## Proof point

The source skill describes live-spec refresh, operation selection, header-based auth, bounded field preservation, and post-change verification.

## Next

[Administer remotely](/what-it-does/administer-remotely/) or [return to integrations](/integrations/).
