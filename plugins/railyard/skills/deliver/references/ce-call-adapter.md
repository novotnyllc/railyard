# CE skill-frame adapter

Cross-skill "invoke" in Railyard means: resolve the callee SKILL.md, load it
as a procedure frame, execute it to its declared return contract, persist the
frame return, then resume the caller. It does NOT mean the host has a native
skill-call primitive.

## Semantics

`CALL_SKILL(X)` = resolve + load + execute + return + resume.

For the implementation-delivery route, the carrier is a spawned subagent
whose prompt names the carrier label. The SubagentStart hook injects route
context; the SubagentStop hook rejects premature return. Nested CE stages
(plan, work, simplify, review, etc.) run inline within the carrier's context
using the same skill-frame discipline.

## Digest binding

When a carrier starts, the route ledger records the LFG SKILL.md path and
SHA-256. On resume (after a continuation), if the digest changed, the carrier
must re-admit (reload the skill) rather than silently resuming an obsolete
procedure.
