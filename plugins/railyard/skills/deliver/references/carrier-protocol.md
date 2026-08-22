# Route-carrier protocol

The implementation-delivery route dispatches a typed LFG carrier subagent.
The carrier label `railyard:route:lfg:v1` is the machine-recognizable marker
that hooks use to create an authoritative route in the route ledger.

## State machine

```
pending_spawn ── SubagentStart ──► carrier_started
                                        │
                    plan_complete receipt
                                        ▼
                                 work_complete receipt
                                        ▼
                                 review_complete receipt
                                        ▼
                          pr_create_ready @ HEAD + branch
                                        ▼
                                    babysit_settled
                                        ▼
                                  lfg_complete (terminal)
```

Legitimate alternative terminal: `blocked` (record with reason).
Failure terminal: `failed` (continuation budget exhausted).

## Shipping boundaries

| Action | Required state | Gate |
|---|---|---|
| git push | ≥ carrier_started | PreToolUse |
| gh pr create | pr_create_ready bound to current HEAD and branch, no HEAD mutation in same call | PreToolUse |
| gh pr merge | lfg_complete | PreToolUse |

A blocked gate response names the exact missing state. Repair the route;
never bypass the gate.

## Receipts

The carrier records stage receipts via:
```bash
node <plugin>/hooks/route-state.js receipt <route-id> <event> [--key value]
```

Stage events: `plan_complete`, `work_complete`, `review_complete`,
`pr_create_ready --head-sha <sha> --branch <branch>`.

Terminal transitions:
```bash
node <plugin>/hooks/route-state.js transition <route-id> lfg_complete
node <plugin>/hooks/route-state.js transition <route-id> blocked
```

## Premature termination

SubagentStop blocks a carrier that stops at any non-terminal state,
returning a continuation message that names the current state and the
next expected receipt. After 10 continuations the route transitions to
`failed` and the stop is allowed.

## TOCTOU protection

A single shell call that both mutates HEAD (commit/merge/etc.) and creates
a PR is refused. Split into: commit → record receipt for new HEAD → create PR.
