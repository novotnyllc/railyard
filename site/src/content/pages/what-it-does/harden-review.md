---
layout: default
title: Harden review
parent: Practices
nav_order: 2
---

# Harden review

An orchestrator change touches many mechanical call sites and one gnarly concurrency seam where a flush can race shutdown. Freeze the diff, review it through correctness and code-health lenses, settle every real finding, and carry that evidence to merge. The resulting receipt shows why the change deserves trust.

## Easy path

```text
> Review this change deeply, settle findings, and merge it.
```

Compound Engineering (CE) owns review settlement and CI monitoring. Select the optional Thermos pair when its correctness and code-quality lenses help answer the review question.

## Illustrative workflow

The operator asks whether a wide migration and its concurrency seam are ready to merge. The selected review receives a frozen diff and relevant source context. Thermos can contribute a deduplicated findings packet to the CE owner; accepted findings return to implementation, and affected checks run after fixes. CE settles that evidence against the corrected head before the authorized merge proceeds.

## What happens

- The correctness lens traces breakage, security, developer experience, and feature-leak risks.
- The code-quality lens looks for duplicate helpers, structural drift, and avoidable complexity.
- Synthesis deduplicates findings, the implementation owner fixes accepted findings, and affected checks run again.
- The existing CE owner handles review settlement and CI monitoring without another Railyard watcher or mandatory review pass.

## Proof point

The review result identifies the diff, findings, dispositions, and affected checks. Use CE's current PR/CI result to continue the requested delivery; the [delivery gates](/delivery/gates/) describe that ownership boundary.

## Next

[Ship a change](/what-it-does/ship-a-change/) or [read the delivery gates](/delivery/gates/).
