---
layout: default
title: UniFi Network API
parent: Skills
nav_order: 19
---

# UniFi Network API

UniFi Network API turns a live controller description into one bounded network operation with an exact request, header-based authentication, and post-change verification.

## What it adds

The skill refreshes the controller's current OpenAPI description, selects the exact operation and schema, preserves only the requested fields, and keeps the API key in a header. The request and the verification result stay tied to the same operation digest.

## How it works

```text
> Read the live controller API description, plan the selected network change, and verify the result.
spec=refreshed operation=selected-from-live-spec
request=bounded fields=selected auth=header-only
apply=awaiting-explicit-consent
verify=controller+gateway state
```

The skill uses the live description as the operation contract, so a stale path or field produces a new planning result rather than a guessed request.

## Scope

UniFi Network API owns controller operations through the official Integration API. It preserves the selected operation boundary and returns controller and gateway state for verification; delivery, fleet trust, and remote transport retain their own ownership.

## Source

Ships in the `roundhouse` plugin.

## Proof point

```text
operation=selected-from-live-spec spec_digest=sha256:12af...
request_fields=3 auth=header
controller_result=accepted gateway_state=verified
result=verified
```

Next: [read the UniFi integration](/integrations/unifi/) or [administer remotely](/what-it-does/administer-remotely/).
