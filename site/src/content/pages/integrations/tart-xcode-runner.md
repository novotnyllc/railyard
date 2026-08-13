---
layout: default
title: Tart Xcode Runner
parent: Integrations
nav_order: 2
---

# Tart Xcode Runner

Tart Xcode Runner adds disposable macOS VMs for Xcode builds, simulator tests, and XCUITests; the core system operates fully without it.

## Easy path

```text
> Run the app build and UI tests in a clean macOS VM.
```

Delivery offers the runner when the work needs native Apple tooling. The app change, review, merge, and post-merge proof remain in the delivery lifecycle.

## What it adds

The VM supplies a separate execution boundary for the native build and test workload. Your host screen remains available while the test run progresses in its own environment.

## Source

Read the [Tart Xcode Runner repository](https://github.com/novotnyllc/tart-xcode-runner) for its own installation and runner details.

## Proof point

`railyard/docs/skills/deliver.md` names Tart Xcode Runner as the preferred path for Xcode builds and UI tests.

## Next

[Read the iOS and Mac apps scenario](/what-it-does/ios-and-mac-apps/) or [return to integrations](/integrations/).
