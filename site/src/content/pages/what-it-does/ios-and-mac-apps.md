---
layout: default
title: iOS and Mac apps
parent: What it does
nav_order: 7
---

# iOS and Mac apps

Run Xcode builds and UI tests in disposable macOS VMs while your working screen stays available for you.

## Easy path

```text
> Run the app build and XCUITests in an isolated macOS test environment.
```

The delivery route offers `tart-xcode-runner` when the work needs Xcode or UI tests.

## What happens

The optional runner supplies a clean Tart VM for the build and test commands. Delivery keeps the app change, review gates, and merge proof in the same lifecycle; the VM is the execution boundary for the native test workload.

## Proof point

The [Deliver skill](/skills/deliver/) names the Tart runner as the preferred path for Xcode builds, simulator tests, and XCUITests.

## Next

[Read the Tart integration](/integrations/tart-xcode-runner/) or [ship a change](/what-it-does/ship-a-change/).
