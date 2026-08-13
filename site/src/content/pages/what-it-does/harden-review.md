---
layout: default
title: Harden review
parent: What it does
nav_order: 2
---

# Harden review

An orchestrator change touches many mechanical call sites and one gnarly concurrency seam where a flush can race shutdown. Freeze the diff, review it through correctness and code-health lenses, settle every real finding, and carry that evidence to merge. The resulting receipt shows why the change deserves trust.

## Easy path

```text
> Review this change deeply, settle findings, and merge it.
```

The delivery route uses the Thermos pair against the same frozen diff and relevant source context.

## What happens

- The correctness lens traces breakage, security, developer experience, and feature-leak risks.
- The code-quality lens looks for duplicate helpers, structural drift, and avoidable complexity.
- Findings are synthesized, real findings are fixed, and the affected checks run again.
- The merge-settlement hook keeps merge authority aligned with the latest review evidence.

## Proof point

`plugins/railyard/hooks/merge-settlement-gate.js` is the observable merge gate, with companion tests in `plugins/railyard/hooks/merge-settlement-gate.test.mjs`.

## Next

[Ship a change](/what-it-does/ship-a-change/) or [read the delivery gates](/delivery/gates/).
