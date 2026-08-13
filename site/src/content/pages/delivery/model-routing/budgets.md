---
layout: default
title: Budgets, admission, and receipts
parent: Delivery
nav_order: 2
---

# Budgets, admission, and receipts

Treat budget as part of the design: forecast the work, reserve capacity at the right scope, and commit spend only when a specific carrier action is ready. This keeps model economics visible before execution and gives every task, run, and project an auditable constraint. Railyard expresses that practice through soft, `hardAdmission`, and `strict` meters; the carrier receives work only after the applicable forecast fits.

## Admission behavior

- `soft` records demand and lets the policy choose whether to proceed.
- `hardAdmission` checks the forecast before the work starts; a missing forecast blocks the action.
- `strict` requires the fixed carrier to attest enforcement for that meter. No current carrier declares `enforcedMeters`, so every strict meter fails closed with `strict_limit_unenforceable`; use `hardAdmission` for a limit meant to bind now.
- `admit` reserves every supplied scope atomically. Repeating the same request returns the original reservation; conflicting reuse of a request ID blocks.
- `claim-dispatch` is one-way and happens immediately before the one fixed carrier action. A claim does not authorize a retry spawn.
- `reconcile` accepts an imported fixed-adapter receipt bound to producer, adapter version, claim, frozen input digest, host, account, dispatch kind, session, tool, and tool version.

Preserve the meaning of each meter through the whole ledger. No-config admission returns `default_route_no_state`: a resolver can show the route and an applicable forecast can be `not_applicable` without inventing a reservation. Configured routes retain the forecast, reservation, actual, and charged facets separately. Meter types remain separate; a Z.ai Coding Plan credit is not converted into a USD total.

## Enforcement hooks

Bind every charged action to an explicit worker identity. The dispatch gate makes that rule operational. A Codex `spawn_agent` call without both fields produces:

```text
[railyard] Dispatch refused: spawn_agent must set model and reasoning_effort explicitly (no silent inheritance of the session tier). Retry with the fields set.
```

The corrected call is allowed and recorded as JSONL with the selected model and effort; it does not emit an invented console `ALLOWED` line:

```json
{"ts":"2026-08-13T09:12:05Z","event":"dispatch","harness":"codex","tool":"spawn_agent","model":"gpt-5.6-luna","effort":"max","label":"implementation"}
```

On Claude Code, a gpt-family worker also needs a literal `cross-harness` opt-in and its reason. The gate keeps provider boundaries and the resolver's carrier choice explicit at every harness switch.

Budget receipts belong to the same evidence chain as review and merge. The merge-settlement gate binds merge authority to review freshness. An unresolved thread produces:

```text
[railyard] Merge refused: PR #42 has 1 unresolved review thread(s). Reviews that arrive after CI turns green are still real findings. Address each one — fix it, or reply on the thread with the rationale for declining — then resolve the threads (resolveReviewThread via gh api graphql) and retry this merge. A tripped guard is waited out or fixed, never bypassed.
```

A fresh head with no review waits through the ten-minute settlement window. If the gate cannot determine the state, it fails open with a `DEGRADED` stderr notice and tells the operator that review settlement was not verified.

## Receipt shape

```text
2026-08-13T09:12:04Z decision route=codex-luna effort=max budget=hardAdmission forecast=relative:12
2026-08-13T09:12:04Z dispatch refused reason=missing_model_and_reasoning_effort
2026-08-13T09:12:05Z run-log event=dispatch harness=codex model=gpt-5.6-luna effort=max
2026-08-13T09:12:06Z claim-dispatch claim=claim_opaque_01
2026-08-13T09:18:44Z reconcile receipt=imported fixed_adapter=native-subagent status=settled
```

Read the receipt at the unit it actually proves. It reports a relative ledger unit only. The policy's rate record owns any monetary interpretation and includes its own source, freshness, model digest, carrier version, effort, and billing surface.

Next: [roles, tiers, and carriers](/delivery/model-routing/tiers/) or [two worked runs](/delivery/model-routing/worked-runs/).
