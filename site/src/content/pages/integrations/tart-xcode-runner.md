---
layout: default
title: Tart Xcode Runner
parent: Integrations
nav_order: 2
---

# Tart Xcode Runner

Run native Apple validation in a clean, disposable environment that preserves the developer's screen and produces a distinct execution receipt. This makes Xcode builds, simulator tests, and XCUITests repeatable while keeping them inside the same review and delivery lifecycle as the app change.

The optional Tart Xcode Runner integration supplies those macOS VMs; the core system remains fully operational on its own.

## Easy path

An app change is ready for native validation, and the developer needs the build and UI tests to run in a fresh macOS environment while the host display stays available:

```text
> Run the app build and UI tests in a clean macOS VM.
```

Delivery offers the runner when the work needs native Apple tooling. The app change, review, merge, and post-merge proof remain in the delivery lifecycle.

## The run

The operator asks for a native app change to receive clean Xcode and UI-test evidence while the host display stays available. Tart Xcode Runner owns the disposable macOS VM and test execution; Railyard keeps the app change, review, merge, and proof in one delivery. The turn is the execution-boundary decision: native validation moves off the workstation without moving delivery authority. The run closes when build and test receipts return from the VM to the settled change.

## What it adds

Use the VM as a separate execution boundary for the native build and test workload. Your host screen remains available while the test run progresses in its own environment.

## Source

Read the [Tart Xcode Runner repository](https://github.com/novotnyllc/tart-xcode-runner) for its own installation and runner details.

## Proof point

The [Deliver reference](/skills/deliver/) names Tart Xcode Runner as the preferred path for Xcode builds and UI tests.

## Next

[Read the iOS and Mac apps scenario](/what-it-does/ios-and-mac-apps/) or [return to integrations](/integrations/).
