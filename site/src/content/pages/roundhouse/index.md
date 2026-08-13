---
layout: default
title: Roundhouse
nav_order: 1
has_children: true
---

# Machines that converge on their own

Roundhouse gives an agent fleet a readable desired state, a signed store, a canary gate, and host-owned evidence. Declare what every machine should carry; each host pulls, reviews, applies through its owner, journals the result, and publishes the proof.

Roundhouse borrows the desired-state discipline of DSC-style tooling and narrows it to exactly what an agent toolchain needs — skills, plugins, and config as the managed unit, canary gating before wider convergence, and a lightweight signed trust ratchet in place of a certificate authority.

## The product surface

- [Store](/roundhouse/store/) — four readable layers, closed categories, definitions, and fold receipts.
- [Convergence](/roundhouse/convergence/) — pull, gate, apply, journal, publish, and rollback through one loop.
- [Operating](/roundhouse/operating/) — cadence, native schedulers, CLI verbs, lifecycle, and caps.
- [Security](/roundhouse/security/) — trust, enrollment, canary evidence, privilege boundaries, and honest residuals.
- [Scaling guide](/desired-state/scaling/) — evidence retention and the 30/50/75/100-machine breakpoints.

The delivery system consumes one thin interface: fleet-readiness go/no-go. Roundhouse remains useful on its own for any agent fleet, whether the work runs through Claude, Codex, or another managed harness.

## A small receipt

```text
roundhouse run item=skills.my-review
fold digest=sha256:7c1a... layers=4
review result=pass owner=skills canary=canary-1
apply result=applied host=host-a
journal result=applied publish=complete
```

Read the [Roundhouse repository](https://github.com/novotnyllc/roundhouse), [releases](https://github.com/novotnyllc/roundhouse/releases), and [review trail](https://github.com/novotnyllc/roundhouse/pulls) alongside the product guide.
