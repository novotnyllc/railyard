---
layout: default
title: iOS and Mac apps
parent: Practices
nav_order: 7
---

# iOS and Mac apps

An XCUITest suite needs a clean Mac and control of the screen while the developer is still working. Put the native workload in a disposable macOS VM, keep the delivery lifecycle intact, and return build plus test evidence from a pristine execution boundary. The app gets credible native validation while the working screen stays available.

## Easy path

```text
> Run the app build and XCUITests in an isolated macOS test environment.
```

The delivery route offers `tart-xcode-runner` for work that needs Xcode or UI tests.

## The run

The operator asks for an app change to receive credible Xcode and UI-test evidence without taking over the working screen. Railyard keeps the change inside its ordinary delivery lifecycle while Tart Xcode Runner supplies a clean, disposable macOS execution boundary. The turn is the native test route: the workload moves offscreen, but review, merge, and proof stay with the delivery. The run closes when build and test receipts return from the VM and the merged result passes its focused post-merge proof.

## What happens

The optional runner supplies a clean Tart VM for the build and test commands. Delivery keeps the app change, review gates, and merge proof in the same lifecycle; the VM provides the execution boundary for the native test workload.

## Proof point

The [Deliver skill](/skills/deliver/) names the Tart runner as the preferred path for Xcode builds, simulator tests, and XCUITests.

## Next

[Read the Tart integration](/integrations/tart-xcode-runner/) or [ship a change](/what-it-does/ship-a-change/).
