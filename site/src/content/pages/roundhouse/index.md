---
layout: default
title: Roundhouse
nav_order: 1
has_children: true
---

# Roundhouse

Run an agent fleet from declared intent and durable proof. Give every machine a readable desired state, require signed changes to earn their way through a canary, and let each host publish its own evidence. The fleet can move unattended while operators can still explain exactly why any item applied or held.

Roundhouse is one working expression of the desired-state model. It borrows the discipline of DSC-style tooling and narrows it to exactly what an agent toolchain needs: skills, plugins, and config as the managed unit, canary gating before wider convergence, and a lightweight signed trust ratchet in place of a certificate authority. Each host pulls, reviews, applies through its owner, journals the result, and publishes the proof.

## The run

The operator asks for one machine to adopt the declared agent surface without surrendering the ability to explain each item. Roundhouse pulls signed history, folds readable desired state, checks local authority and canary evidence, then applies through the owning manager. The turn is the host's go-or-hold decision: complete evidence advances the exact digest, while a named hold keeps the last reviewed value. The run closes when the local journal and published proof show `applied`, `satisfied`, or the residual decision that still needs operator attention. [Read the five-host bring-up](/why-railyard/).

## The product surface

- [Store](/roundhouse/store/) — four readable layers, closed categories, definitions, and fold receipts.
- [Convergence](/roundhouse/convergence/) — pull, gate, apply, journal, publish, and rollback through one loop.
- [Operating](/roundhouse/operating/) — cadence, native schedulers, CLI verbs, lifecycle, and caps.
- [Security](/roundhouse/security/) — trust, enrollment, canary evidence, privilege boundaries, and honest residuals.
- [Scaling guide](/desired-state/scaling/) — evidence retention and the 30/50/75/100-machine breakpoints.

The delivery system consumes one thin interface: fleet-readiness go/no-go. Roundhouse remains useful on its own for any agent fleet, whether the work runs through Claude, Codex, or another managed harness.

Follow the same operating system through [one work request](/delivery/) or [one agent item reaching every machine](/sync/).

## A small receipt

An operator needs to check whether a review skill truly reached an anonymized host after a fleet change. This compact receipt carries the answer from the four-layer fold through review, apply, and publication:

```text
roundhouse run item=skills.my-review
fold digest=sha256:7c1a... layers=4
review result=pass owner=skills canary=canary-1
apply result=applied host=host-a
journal result=applied publish=complete
```

Read the [Roundhouse repository](https://github.com/novotnyllc/roundhouse), [releases](https://github.com/novotnyllc/roundhouse/releases), and [review trail](https://github.com/novotnyllc/roundhouse/pulls) alongside the product guide.
