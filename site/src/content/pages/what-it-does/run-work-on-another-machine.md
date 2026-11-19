---
layout: default
title: Run work on another machine
parent: Practices
nav_order: 8
---

# Run work on another machine

A delivery needs a native Apple build, while some lint and tests are portable. Deliver can place only the Apple stage on an authorized Mac with the required Xcode and SDK. Other stages can run on any eligible platform with the right toolchain and access. Explicit local-only requests stay local.

## Easy path

```text
> Build and test this change, including the iOS simulator check.
```

Deliver uses `railyard:orchestrate` and `roundhouse:fleet-readiness` when its configured placement permissions cover the stage. It checks the eligible Mac before launch. A bounded build or test can run over approved SSH under the delivery owner's control.

## The run

Roundhouse verifies relevant readiness. Railyard checks current load when capacity matters. Eligible environments on the same physical host share capacity. CE owns PR review and CI while the delivery owner integrates results and verifies the authorized endpoint.

## What happens

Pick a separate worker for independent reasoning or a needed account. A new visible user-owned task requires an explicit request. Keep optional work local when there is no gain. Surface a required stage without a verified compatible host.

## Proof point

For a long job, record the host, checkout, job ID, reconnect command, and remote log and exit-status locations before launch. Reconnect to the same job before retrying and collect its final status and artifacts. The [fleet-readiness reference](/skills/fleet-readiness/) describes host eligibility.

## Next

[Administer a remote machine](/what-it-does/administer-remotely/) or [read the fleet readiness reference](/skills/fleet-readiness/).
