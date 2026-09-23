---
name: model-routing
description: "Choose a model and reasoning effort for native delegation or a requested allocation review. Use the strict resolver only for configured fleet, budget, provider, or adapter decisions."
---

# Model routing

Choose model and reasoning effort together for the bounded assignment. Keep
native execution lean; this skill does not create tasks, dispatch workers, or
replace the selected delivery/review workflow. There is no mandatory routing
CLI intake for every software turn.

## Native allocation

When `TYPESAFE_API_KEY` is present, use [Jev](../jev/SKILL.md) as the default
model-and-reasoning-effort selector for substantive assignments. Supply the
locally compatible, eligible pairs with task context and available outcome
evidence; use its recommended pair after the checks below. Respect explicit
user choices, fixed roles, and offline/privacy restrictions first. Map the
returned ID through that same local list and recheck availability before
dispatch. Missing key, uncertainty, or service failure leaves the ordinary
allocation procedure below in charge. Jev is an adviser,
not an execution carrier, capability attestation, or budget decision.

1. Preserve explicit user model/effort choices and applicable repository
   constraints. Identify the work, acceptance condition, and need for parallel
   execution or specialization.
2. In Codex, use **GPT-6 Sol at `medium` as the baseline candidate for
   ordinary substantive engineering**. Raise Sol to `high` when the task's
   complexity, ambiguity, or verification burden requires it. Use GPT-6 Luna
   at `low` or `medium` for bounded, repetitive work. Escalate to Astra only
   for clearly hard or high-risk work, or when the accepted outcome evidence
   shows that Sol is insufficient. Preserve an explicit user selection and
   use deterministic tools directly for mechanical work. Do not make `max`
   the default. In Claude Code, consider Fable 5.1 for substantial work and
   choose its effort deliberately; do not copy Codex's effort defaults across
   models.
   Native creation currently lacks GPT-6 Sol and Luna selectors. Those requests
   fail visibly. Select Astra deliberately only when the work warrants it;
   otherwise use suitable inheritance or work in the current task.
3. Check the active dispatch tool's model selectors, effort values, history
   constraints, and any authoritative fixed-role binding. A provider catalog
   or working CLI route is not proof of a native override.
4. Request the selected model and effort with a compatible history mode, or
   deliberately inherit both. Record that decision and reason once in the
   brief; dispatch without an extra acknowledgement.
5. Evaluate the accepted result and the whole assignment's cost/time, including
   all children, failed attempts, retries, and repairs. Lower per-call prices
   or quota per hour do not establish better task efficiency. Use existing
   outcomes and logs; no routine benchmark, charter, or retrospective artifact
   is required.

Published token rates are a routing input, not accepted-outcome evidence. Use
them as a heuristic only within the same billing surface, then compare the
whole assignment's accepted cost and elapsed time. Inheritance is an explicit
allocation choice, not a substitute for considering the assignment.

The [native invocation reference](../../references/harness-model-invocation.md)
contains the dated roster and dispatch examples. The active tool schema wins
if it changes. For current Codex `spawn_agent`:

- Explicit `model` and `reasoning_effort` overrides require
  `fork_turns:"none"` or a supported positive history-count string. Supply a
  sufficient brief for that context boundary.
- Full history (`fork_turns` omitted or `"all"`) disallows either override.
  For deliberate inheritance through the lean gate, use explicit
  `fork_turns:"all"`, omit both overrides, and put
  `Allocation: inherit model and reasoning effort; <reason>.` in the brief.
- No role parameter is currently exposed. Use a fixed specialist binding only
  when authoritative configuration and an actual role parameter support it;
  never invent a native role selector or conflicting overrides.
- Native spawn has no arbitrary per-child plugin controls. Narrowing history
  and scoping skills are separate actions.

For Claude Code, use the [Claude allocation controls](../../references/harness-model-invocation.md#claude-code-allocation)
for Fable 5.1's exact selector, supported efforts, and the distinction between
session CLI flags and inherited or configured subagent effort. A moving alias
does not prove a requested model version ran.

If a requested model, effort, history mode, or adapter is unsupported, disclose
the incompatibility. Do not silently fall back, omit a requested override, or
claim the unavailable selection ran. Dispatch arguments document intent;
worker banner echoes do not verify actual execution. Use runtime metadata when
available, otherwise label actual model/effort as unverified.

Internal subtasks use native subagents. A user-visible task requires an
explicit user request to create one; routing or orchestration alone does not
authorize it. A native subagent follow-up has no effort control. An existing
Codex task may expose `model` and `thinking` on its supported continuation
surface; inspect that live schema before using it. Neither native continuation
control is the Responses API's GPT-6 `configuration_update` mechanism.

## Optional strict resolver

Use `railyard/model-routing/v1` when the assignment needs configured fleet,
budget, privacy, provider, or fixed-adapter controls. Read the relevant parts
of the [contract](../../references/model-routing.md) for request shapes,
catalog schema, admission, state, and transport rules. This is the operational
contract for that configured path, not an additional router for native work.

Resolve `SKILL_DIR` from the skill being used, then invoke the bundled script:

```bash
ROUTER="$SKILL_DIR/../../scripts/model-routing.mjs"
printf '%s\n' '<request JSON>' | node "$ROUTER"
```

Every request carries `"contractVersion":"railyard/model-routing/v1"`.
Requests remain content-free: no prompts, task titles, paths, source, files,
credentials, endpoints, or command text.

For this path:

1. Classify the bounded work and `resolve` its model/effort, transport, and
   policy. Preserve requested selections; missing availability evidence is
   not permission to manufacture it.
2. For configured work-starting actions, `admit` with the required stable
   request identity, frozen digest, and scopes; `claim-dispatch` immediately
   before the single authorized dispatch. A claim does not authorize a retry.
3. The owning workflow invokes the selected supported adapter and reconciles
   its trusted receipt. Caller JSON and model output are not receipts.
4. Use the contract's status, steering, settlement, and learning controls only
   as needed. Disclose configured fallbacks and unsupported transports;
   explicit user requirements remain authoritative.

Configured visible-task creation also needs the contract's fixed attestation
of explicit user authority. Public stdin and environment variables cannot
mint it. Advanced cross-harness and Oracle routes retain their own supported
adapters, permissions, and accounting; configuration alone does not prove
availability.

## Workflow ownership and completion

Keep one delivery/review owner and its useful mechanisms. Preserve requested
Compound Engineering workflows, including its commit/PR, feedback resolution,
review, and watch behavior. Allocation does not replace CE with a parallel
runner or transfer its approval, writer, review, or terminal authority.

When a configured route needs `build-work-contract`, preserve its semantic
invariants and apply only the supported presentation overlay. Direct user and
repository instructions win. A CE mechanism replacement is valid only at a
supported, attested seam under the contract; unsupported carrier/adapter pairs
remain unsupported.

`offline_implementation_ready`, `host_capability_attested`, and
`live_carrier_verified` are distinct. Offline tests do not establish a live
route, and the public CLI cannot mint positive capability evidence from JSON.
Complete the requested work and its relevant verification before reporting
success; a routing decision alone is not completion.
