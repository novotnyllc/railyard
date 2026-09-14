---
layout: default
title: Budgets, admission, and receipts
parent: Delivery
nav_order: 2
---

# Budgets, admission, and receipts

Use the stateful budget path when explicit account or fleet work needs admission control and accounting. Routine native work does not need a reservation, delivery contract, or imported carrier receipt before it can start.

Evaluate complete assignments, including children, retries, repairs, and verification. Low per-token cost, low reasoning effort, or low quota use per minute does not establish a lower cost per accepted result.

## Admission behavior

- `soft` records demand and lets the configured policy determine whether to proceed.
- `hardAdmission` checks the required forecast before work starts; a missing forecast blocks the action.
- `strict` requires the fixed carrier to attest enforcement for that exact meter. A carrier without this capability returns `strict_limit_unenforceable`.
- `admit` reserves supplied scopes atomically. Identical reuse returns the original reservation; conflicting reuse blocks.
- `claim-dispatch` is one-way and binds one fixed carrier action. It does not authorize a retry spawn.
- `reconcile` accepts an imported fixed-adapter receipt bound to the route, claim, producer, host, account, and dispatch identity.

No-config admission returns `default_route_no_state` without inventing a reservation. Configured routes keep forecast, reservation, actual, and charged values distinct. Unknown cost stays unknown; different meters are not summed without an explicit valid conversion.

## Allocation and live evidence

The narrow native dispatch gate checks deliberate model and reasoning-effort selection. Explicit suitable inheritance is allowed. A full-history fork inherits settings; changing model or effort requires a supported limited-history or no-history fork. Fixed roles use their authoritative controls.

A selected route and an actual dispatch are different facts. A resolver or test fixture may establish offline readiness; a live carrier result needs its required identity-bound evidence. No fabricated usage or completion receipt can fill that gap.

## Review ownership

Budget accounting does not create another delivery workflow. CE owns review settlement, feedback, CI, and the watch loop when its PR workflow is selected. Railyard's optional merge guard can supply a narrow backstop; it does not become an additional watcher.

See [delivery gates](/delivery/gates/) for required repository checks and authorized post-merge proof, and [optional audit](/delivery/audit/) for comparing outcomes.
