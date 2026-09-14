---
layout: default
title: Forty mechanical sites, one hard seam
parent: Delivery
nav_order: 2
---

# Forty mechanical sites, one hard seam

Consider a structured-logging migration with forty similar call sites and one subtle async flush path. This is an illustrative allocation example, not a measured run or a cost-saving benchmark.

## Separate mechanical work from reasoning

Use deterministic searches and transformations where the replacement is fully specified. Native agents can independently inspect the affected behavior and the flush seam while one owner integrates shared changes.

For substantive agent work, consider Astra Max first and choose both model and reasoning effort deliberately. The mechanical-looking lane still needs judgment if log semantics differ across sites; the flush lane needs enough context to reason about cancellation and ordering. Neither the number of files nor a model's per-token rate establishes the best allocation.

| Work | Allocation decision | Acceptance evidence |
| --- | --- | --- |
| Exact call-site replacements | Direct tools where the transformation is deterministic | Search for old calls, inspect the diff, run relevant checks |
| Behavioral differences between call sites | Native bounded child with a deliberate model and effort choice | Relevant behavior verified and exceptions handled |
| Async flush and cancellation seam | Substantive engineering candidate; inherit explicitly if suitable | Reproducer or focused checks cover ordering and cancellation |
| Review | Select a relevant CE review; add a specialist only for a concrete question | Real findings resolved in the same CE review loop |
| PR and merge | Required CE commit/push/PR workflow; one settlement and CI owner | Authorized merge and post-merge result verified |

Model or effort overrides use a supported limited-history or no-history fork. Native full-history children inherit. No visible tasks, fleet placement, budget ledger, or paired review is required simply because the change has several parts.

## Learn from the whole outcome

If comparing allocations, keep acceptance criteria comparable and include every child, retry, repair, review, and verification cost. Record elapsed time and available usage in their actual units. Missing measurements remain missing.

A stronger effort setting may avoid repeated actions; it may also spend more on a simple task. This example establishes no numeric saving for either choice. Adjust the next comparable assignment from observed accepted outcomes, not an invented cheap-to-hard table.

For explicit accounting, use [budgets and receipts](/delivery/model-routing/budgets/). For an optional retrospective, use [audit](/delivery/audit/).
