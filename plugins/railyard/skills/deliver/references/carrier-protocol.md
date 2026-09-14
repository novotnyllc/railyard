# Legacy carrier compatibility

This reference describes the optional receipt-based LFG carrier protocol for
an explicitly selected legacy integration. Ordinary Deliver and CE stages do
not require this protocol, a carrier subagent, or route receipts. It is not a
SessionStart or shipping prerequisite. Do not activate it merely because the
user asks to implement, fix, ship, or watch a PR.

An integration that explicitly enables the legacy route lifecycle may use the
label `railyard:route:lfg:v1` and the existing route-state helpers. Its states
are `pending_spawn`, `carrier_started`, stage receipts (`plan_complete`,
`work_complete`, `review_complete`, `pr_create_ready`), `babysit_settled`, and
terminal `lfg_complete`, `blocked`, or `failed`. Inspect the enabled hook and
route-state implementation for the integration's actual required transitions;
these helpers do not establish completion or merge authorization themselves.

CE still owns review settlement and CI monitoring. A legacy carrier must
consume that owner's result rather than run another watcher or independent
Railyard settlement gate. Use the requested terminal boundary and ordinary
verification to judge completion. Prefer the native/selected-CE route in
[Deliver](../SKILL.md) for new work.
