# Native model and effort allocation

Choose the model and reasoning effort together for each assignment. A skill
cannot change the current session's model. It can guide a supported child
selection or deliberately keep the parent's settings.

Use **Astra at `max` as the baseline candidate for substantive engineering**.
This is a starting hypothesis, not a claim that Max is always cheapest or
best. Preserve an explicit user selection. Choose another supported model or
effort when comparable completed work supports the tradeoff, the work needs a
specialist, or the user prioritizes latency. Run deterministic tools directly
for mechanical operations; do not create a model worker merely because its
per-token rate looks lower.

Judge cost and elapsed time through acceptance of the whole assignment,
including child agents, unsuccessful attempts, repeated reads, retries, and
repairs. Per-call prices, tokens per minute, and quota per hour do not establish
cost per accepted task. Higher effort can reduce wasted actions; it can also
cost more on short work. Use existing outcomes and logs when available, without
adding a benchmarking framework or mandatory artifacts to ordinary delivery.

## Current Codex native controls

The native `spawn_agent` tool exposed for this update (2026-09-14) advertises:

| Model selector | Supported reasoning efforts |
| --- | --- |
| `gpt-6-astra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-daybreak-blue-latest` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-terra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-5.6-luna` | `low`, `medium`, `high`, `xhigh`, `max` |
| `combo/grok-unified-4.6` | `low`, `medium`, `high`, `xhigh` |

Recheck the active tool schema before dispatch: this is a dated capability
snapshot, not an availability promise for every account, host, or harness.
Daybreak is a candidate for relevant defensive security work when the active
surface exposes it; it is not an automatic replacement for a user-selected
model. Model names do not establish a universal implementation/review ranking.

The native tool exposes `model`, `reasoning_effort`, and `fork_turns`. Its fork
constraints are part of allocation:

- A full-history fork, with `fork_turns` omitted or `"all"`, inherits the
  parent's model and effort and cannot carry either override.
- Explicit model and effort overrides require `fork_turns:"none"` or a
  supported positive history-count string. Supply enough task context for the
  child to work correctly with that history.
- Deliberate inheritance is a valid choice. For the lean dispatch gate, set
  `fork_turns:"all"`, omit both override fields, and include
  `Allocation: inherit model and reasoning effort; <reason>.` in the brief.
  This records intent; it does not reveal otherwise unknown parent settings.

A substantive bounded assignment can request Astra Max explicitly:

```json
{
  "task_name": "repair_importer",
  "message": "Repair the importer retry bug in the assigned files, run the relevant checks, and return the result. Allocation: gpt-6-astra at max for substantive debugging. Include the concrete failure and file scope in this brief.",
  "model": "gpt-6-astra",
  "reasoning_effort": "max",
  "fork_turns": "none"
}
```

A child that needs the same policy judgment and full conversation can instead
inherit deliberately:

```json
{
  "task_name": "review_policy",
  "message": "Allocation: inherit model and reasoning effort; this review needs the same policy judgment and full conversation context.\nReview the assigned policy change for contradictions and report actionable findings.",
  "fork_turns": "all"
}
```

These illustrate tool fields, not complete work briefs. Preserve the actual
objective, assigned files, constraints, and acceptance checks in a dispatch.
Do not send overrides with `"all"`, even when they repeat the parent's values.
If required settings and history are incompatible, disclose that constraint;
do not silently change settings, drop required context, or retry on another
model.

## Roles, providers, and skill scope

A fixed specialist role may determine model and effort only when authoritative
configuration defines that binding and the active tool exposes a role
parameter. Resolve the binding and use that parameter without conflicting
model/effort overrides. The current native `spawn_agent` tool has no role
parameter: a role name in a prompt or catalog is not a supported native
selector.

A provider catalog, a working CLI route, or an App Server model list does not
prove that native `spawn_agent` accepts the same model override. Use only the
selectors and combinations supported by the active dispatch surface. Do not
invent a provider parameter, claim an unavailable route works, or silently
substitute a model when selection fails.

Native spawn has no arbitrary per-child plugin enablement control. A smaller
history fork changes conversation context; it does not disable inherited
skills or install a specialist tool. Use supported project/global skill scope
or an actually exposed role configuration when needed, separately from history
selection. Do not claim a narrower brief removed capabilities.

## Delegation and reporting

Delegate bounded work when parallel execution or specialization improves the
accepted result. Apply the same model/effort decision at each depth, respecting
the active tool's limits. Avoid a child that merely forwards an unchanged
assignment. The parent retains coordination and acceptance; each child receives
a clear scope and returns useful findings or verification evidence.

Use subagents for internal subtasks. Create a user-visible task only when the
user explicitly requests a new task. An orchestrator workflow or a desire to
select another model does not supply that authorization.

Record the intended allocation once in the brief or normal progress record.
Tool arguments show what was requested; runtime metadata or a trusted adapter
receipt may show what actually ran. A worker echoing a dispatch banner cannot
verify its own model or effort. If actual settings are not observable, report
the request or deliberate inheritance and say actual values are unverified.
No banner, extra acknowledgement, or separate audit artifact is required for
ordinary native work.

A follow-up message does not itself change a running agent's model or effort.
Use a supported new dispatch or an explicitly exposed continuation control for
a change, and disclose the changed selection. Do not invent a mid-task switch.

## Optional configured and cross-harness routes

Use the strict [`railyard/model-routing/v1` contract](model-routing.md) when a
configured fleet, budget, privacy boundary, provider, or fixed adapter requires
it. Its frozen decisions, admission, claims, and reconciliation apply to that
path; they are not prerequisites for ordinary direct native delegation.
Unsupported selections or adapter failures must remain visible. A configured
fallback must be authorized by the applicable policy and disclosed, and cannot
override an explicit user requirement silently.

For Claude Code, inspect its active `Agent`/CLI controls and authoritative role
configuration. Do not map Codex effort labels onto Claude by analogy or claim
that effort text in a prompt configures a missing tool parameter. Cross-harness
work changes capabilities and accounting; use it only when authorized and
supported, preserving the user's permissions and required tools.

Keep the chosen workflow's real mechanisms and ownership. A Compound
Engineering Claude review uses its supported adapter and review process; model
allocation is not permission to replace it with a parallel runner. Railyard's
configured replacement seams apply only where the exact carrier and adapter
are supported. Oracle retains its own invocation rules. GLM or another
external provider requires its separately supported configured route, not a
model name copied into native spawn.

A catalog entry, passing offline tests, and live execution are different
facts. Do not call a route live-verified without relevant runtime evidence;
never manufacture availability from configuration or worker output.
