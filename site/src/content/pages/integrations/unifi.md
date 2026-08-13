---
layout: default
title: UniFi
parent: Integrations
nav_order: 4
---

# UniFi integration

UniFi adds repeatable network administration through the official Integration API; the core system operates fully without it.

## Easy path

```text
> Read the live controller API description, plan the network change, and verify the result.
```

## What it adds

The `unifi-network-api` skill refreshes the live OpenAPI description, selects the exact operation, applies a bounded request, and verifies controller and gateway state. The API key travels as a header and the request stays tied to the selected operation.

## Public reference

This integration page records the live-spec, bounded-operation, and verification contract. Read the [UniFi Network API skill reference](/skills/unifi-network-api/) for the worked invocation and receipt.

## Proof point

The source skill describes live-spec refresh, operation selection, header-based auth, bounded field preservation, and post-change verification.

## Next

[Administer remotely](/what-it-does/administer-remotely/) or [return to integrations](/integrations/).
