---
layout: default
title: Two worked cost ledgers
parent: Delivery
nav_order: 2
---

# Two worked runs, with the ledger

Route by economic shape: give mechanical volume to the implementation tier, reserve stronger reasoning for subtle seams and hard review, and make the quality purchase legible in the ledger. The payoff is controlled spend with depth exactly where failure would hurt. Every number below is a representative relative cost unit on the contract's `relativeCostIndex` scale. Dollar rates remain catalog-owned, source-linked, rate-stamped, and meter-specific.

## Run 1 — Fleet-utility API migration

An operator owns a repository-wide logging migration with a production risk hiding in the async flush path. The request is: “replace the deprecated log wrapper with structured logging across the repo; the async flush path is subtle.” Intake resolves `implementation` to `gpt-5.6-luna` at `max` with `implementationEngine: {"mode":"prefer","target":"codex"}` and admits a run-scope `hardAdmission` forecast.

The operator splits the risk along its natural boundary. Lane A covers about 40 mechanical call sites and their fixes on `codex-luna`; the dispatch gate confirms model and effort. Lane B owns the async flush seam and is a deliberate escalation to a Claude worker on Opus at high effort, the fleet default for dispatched workers. Thermos runs correctness/security and quality in parallel. It returns four findings: two missed call sites and a format-string regression in lane A, plus a flush-order race under cancellation in lane B. Each lane re-dispatches its fix on the tier that produced it.

The migration earns its finish through settled evidence. The merge-settlement gate holds `gh pr merge` until every thread is resolved and the ten-minute settlement window passes. After merge, ancestry proof and the smallest routed verification run. The run log carries each route, claim, imported receipt, finding, and final outcome.

| Ledger (relative cost units) | Tier | Volume | Cost |
| --- | --- | --- | ---: |
| Lane A: 40 mechanical sites + fixes | cheap (`codex-luna`) | high token volume | 12 |
| Lane B: flush seam + fix | top (Opus worker, high effort) | low token volume | 18 |
| Thermos review pair + synthesis | review (`gpt-5.6-sol` high) | medium | 6 |
| **Total** | | | **36** |
| Counterfactual: everything on the top tier | top | same work | **~120** |

The saving comes from matching the 40 mechanical sites to the cheap tier while reserving the top tier for the seam that could deadlock production. The ledger also shows the quality purchase: the subtle lane received a stronger implementation path and two independent review lenses.

## Run 2 — Concurrency bug fix

A team is chasing a flaky deadlock in a shared cache, where a fast-looking fix could simply move the failure. Intake routes the report to the debug stage; `resolve` returns `implementation` → Luna at `max`. Lane A builds the reproducer and instrumentation on the cheap tier. Lane B owns the lock-ordering fix and escalates to the top tier. Because the work is flagged high or critical, independent review resolves `gpt-5.6-sol` at `max`, the policy's only `max` review case.

An admitted `oracle-browser` route adds a second-model review. The gates catch two findings with direct stakes: a missing memory fence could invalidate the reproducer assertion, and an unhandled cancellation path could preserve the deadlock in the fix. Settlement, merge, and post-merge proof complete; the reproducer runs green 500 times in CI, and the reconcile receipts retain the meter facts for every lane.

| Ledger (relative cost units) | Tier | Volume | Cost |
| --- | --- | --- | ---: |
| Lane A: reproducer + instrumentation | cheap | medium | 5 |
| Lane B: the fix | top | low | 15 |
| Independent review at `max` + Oracle pass | top review | low | 14 |
| **Total** | | | **34** |
| Counterfactual: single-lane, single review, mid tier | mid | same work | **~20** |

The quality purchase is deliberate: about 70% of this representative ledger sits in the hard seam and its review. The route records which line item purchased each finding, while the actual meter remains the policy's source-owned unit.

```text
run=fleet-utility-api-migration relative_cost_units=36 findings=4 outcome=proven
run=concurrency-bug-fix relative_cost_units=34 findings=2 ci_reproducer_runs=500 outcome=proven
```

Next: [read the sync surface](/sync/) or [return to delivery](/delivery/).
