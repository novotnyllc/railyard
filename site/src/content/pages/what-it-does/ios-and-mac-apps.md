---
layout: default
title: iOS and Mac apps
parent: What it does
nav_order: 7
---

# iOS and Mac apps

An XCUITest suite needs a clean Mac and control of the screen while the developer is still working. Put the native workload in a disposable macOS VM, keep the delivery lifecycle intact, and return build plus test evidence from a pristine execution boundary. The app gets credible native validation while the working screen stays available.

## Easy path

```text
> Run the app build and XCUITests in an isolated macOS test environment.
```

The delivery route offers `tart-xcode-runner` for work that needs Xcode or UI tests.

## What happens

The optional runner supplies a clean Tart VM for the build and test commands. Delivery keeps the app change, review gates, and merge proof in the same lifecycle; the VM provides the execution boundary for the native test workload.

## Proof point

The [Deliver skill](/skills/deliver/) names the Tart runner as the preferred path for Xcode builds, simulator tests, and XCUITests.

## Next

[Read the Tart integration](/integrations/tart-xcode-runner/) or [ship a change](/what-it-does/ship-a-change/).
