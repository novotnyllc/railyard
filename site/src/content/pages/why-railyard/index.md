---
layout: default
title: Why Railyard
nav_order: 6
---

# Five machines, one converged agent surface

Five configured hosts—three macOS, one WSL, and one native Windows—had to expose the same Claude and Codex surface before work could land anywhere with confidence. The operator treated every harness and operating-system boundary as its own receipt, routed each correction to the manager that owned it, and kept WSL evidence distinct from native Windows proof. This historical bring-up is separate from the four enrolled reference hosts used elsewhere in this guide.

## The run

The operator asks for one dependable agent surface across the five configured hosts. Roundhouse inventories plugins, skills, hooks, agents, MCP servers, configuration, projects, and authentication presence, then routes each difference to its source owner or native manager. The turn is evidence staying native to its boundary: each harness is checked independently, and WSL never stands in for native Windows. The run closes when every host/provider pair proves its installed version and source identity through the manager that owns it.

## What the bring-up surfaced

The useful evidence came from concrete breaks in the path:

- Raw non-login SSH hid user-local `codex`, `claude`, and `gh`; the fleet path moved execution through the target's configured login shell.
- One plugin root failed its writable-path integrity check; a restrictive reinstall and executor verification restored the boundary.
- Version metadata advanced while Codex still pointed at an older marketplace source SHA; the source pin joined the release ledger and installed-state verification.
- Four POSIX results initially looked like five-host completion; native Windows remained open until its own PowerShell and harness evidence arrived.

The closing ledger kept installed version, pinned source, operating-system boundary, and provider result distinct:

```text
os=macOS          count=3 claude=enabled codex=enabled version=verified executor=verified result=ready
os=WSL            count=1 claude=enabled codex=enabled version=verified executor=verified result=ready
os=Windows-native count=1 claude=enabled codex=enabled version=verified executor=verified result=ready
fleet=5 providers=2 source-pin=verified outcome=converged
```

The proof is intentionally anonymized to count and OS mix; machine identity is irrelevant to the operating lesson.

## The mechanism in one screen

Railyard keeps one chain visible:

```text
route decision → review gates → merge settlement → receipt → audit
```

The route prices the work, the gates challenge the risk, settlement waits for current evidence, the receipt proves arrival, and the audit reconstructs the decisions afterward. [Delivery lifecycle](/delivery/lifecycle/) carries the full sequence; [Sync](/sync/) and [Roundhouse](/roundhouse/) show how the same receipt habit reaches machines and agent items.

## Start with a real change

Use the [Start guide](/start/) to install the surface and carry one useful delivery through its first receipt.
