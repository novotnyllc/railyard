# Native model and effort allocation

Choose the model and reasoning effort together for each assignment. A skill
cannot change the current session's model. It can guide a supported child
selection or deliberately keep the parent's settings.

Use **GPT-6 Sol at `medium` as the baseline candidate for ordinary substantive
engineering when the active execution surface exposes it**. Raise Sol to
`high` when task complexity, ambiguity, or the verification burden warrants
it. Use GPT-6 Luna at `low` or `medium` for bounded, repetitive work. Escalate
to Astra only for clearly hard or high-risk work, or when accepted-outcome
evidence shows Sol is insufficient. The native tool schema and routing source
advertise Sol and Luna selectors; backend execution remains unverified until
observed. Preserve an explicit user selection. Run deterministic tools directly for mechanical
operations; do not create a model worker merely because its per-token rate
looks lower. `max` is an explicit escalation, not an ordinary default.

Judge cost and elapsed time through acceptance of the whole assignment,
including child agents, unsuccessful attempts, repeated reads, retries, and
repairs. Per-call prices, tokens per minute, and quota per hour do not establish
cost per accepted task. Higher effort can reduce wasted actions; it can also
cost more on short work. Use existing outcomes and logs when available, without
adding a benchmarking framework or mandatory artifacts to ordinary delivery.

## GPT-6 family and current Codex native controls

OpenAI's API guidance describes `gpt-6-sol` as its demanding coding and
agentic-work model and `gpt-6-luna` as its focused, high-volume model. Sol and
Luna support `none`, `low`, `medium`, `high`, `xhigh`, and `max`; Astra does
not support `none` and otherwise supports `low` through `max`. These published
API capabilities do not prove that a particular native dispatch surface exposes
the same selectors. Check the active schema before dispatch.

OpenAI's published GPT-6 API rates are $2 input / $10 output per million
tokens for Sol, and $0.10 input / $0.50 output for Luna. The release labels
both as 50% lower than the prior promotional prices. Luna's published output
change, $1.20 to $0.50, is actually 58.3% lower; an exact half would be $0.60.
Record the published cells without treating that label as exact output-rate
arithmetic. Sources: [GPT-6 Sol and Luna release](https://openai.com/index/introducing-gpt-6-sol-and-luna/),
[model guidance](https://developers.openai.com/api/docs/guides/latest-model).

Do not encode a broad GPT-5.5-over-Fable-5.1 rule. OpenAI's GPT-5.5 release
does not compare against Fable 5.1. The later GPT-6 release reports targeted
results: Sol at xhigh scores 33.2% on AutomationBench versus 31.4% for Fable
5.1 with Opus 5 fallback, and says Sol matches Fable 5.1 xhigh on FrontierCode
at lower cost. Those are vendor-reported, workload-specific comparisons, not a
universal family ranking.

The current routing policy permits these exposed native `spawn_agent` selectors:

| Model selector | Supported reasoning efforts |
| --- | --- |
| `gpt-6-sol` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-6-luna` | `low`, `medium`, `high`, `xhigh`, `max` |
| `gpt-6-astra` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |
| `gpt-daybreak-blue-latest` | `low`, `medium`, `high`, `xhigh`, `max`, `ultra` |

Recheck the active tool schema before dispatch: this is a capability snapshot,
not an availability promise for every account, host, or harness.
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

If the local hook snapshot lags a model release, include
`Allocation: model update override; <reason>.` in the brief with explicit
`model` and `reasoning_effort` and compatible limited/no history. This bypasses
only the hook's unknown-model or unsupported-effort snapshot checks. It does
not enable retired routes, bypass history constraints, or verify backend
support. The native tool schema and backend remain authoritative; report a
rejected pair without silently substituting another allocation.

A native follow-up exposes no effort field. When the next assignment warrants
lower or higher effort, the current child can spawn a successor with the chosen
pair and enough context; its parent can also make that handoff. Use no or
limited history for an explicit new pair. Finish or interrupt the old child
before giving the successor the same write scope. This changes the allocation
for the continuing work without claiming that the original child changed its
own effort.

A deliberately selected Astra child for difficult investigation can use:

```json
{
  "task_name": "investigate_importer",
  "message": "Investigate the importer concurrency failure and return a causal explanation with focused verification. Allocation: gpt-6-astra at high; the failure spans multiple concurrency boundaries. Include the concrete failure and file scope in this brief.",
  "model": "gpt-6-astra",
  "reasoning_effort": "high",
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

Re-evaluate continuations under the current routing rules. Native subagent
follow-up has no model or effort control, so a changed allocation requires a
fresh dispatch. For an existing Codex task, use explicit `model` and `thinking`
controls on `send_message_to_thread` when its current schema supports the
resolved pair. See [continuation routing](model-routing.md#continuing-after-a-policy-change)
for saved-route authentication and stale-claim handling.

In a standard, single-agent GPT-6 Responses API conversation, append a
`configuration_update` input item before the next user message to change
reasoning effort without changing the request-level `reasoning.effort`; the
latest update remains effective until replaced. Do not put two updates adjacent
to each other. Automatic compaction and automatic truncation are incompatible
with this feature; after explicit compaction, append a new update before the
next user message. See [Change reasoning mid-conversation](https://developers.openai.com/api/docs/guides/reasoning).

## Claude Code allocation

Verified against Claude Code 2.1.270 and the official
[model configuration](https://code.claude.com/docs/en/model-config) and
[subagent configuration](https://code.claude.com/docs/en/sub-agents) references
on 2026-09-15:

- Fable 5.1's exact Anthropic model ID is `claude-fable-5-1`; it requires
  Claude Code 2.1.257 or later. The `fable` alias usually resolves to 5.1,
  but provider mappings, user pins, and the Claude apps gateway can resolve
  it differently. Preserve intentional aliases; use the exact ID when 5.1
  is required and verify the observed model.
- Fable 5.1 supports `low`, `medium`, `high`, `xhigh`, and `max`. Choose for
  the assignment. These names are model-specific; Astra's `ultra` is not a
  Claude effort, and `ultracode` is a separate workflow setting. Neither a
  smaller model nor lower effort proves lower total task cost.
- The CLI selects both controls with `--model claude-fable-5-1 --effort LEVEL`.
  The installed `Agent` tool's model choices are `sonnet`, `opus`, `haiku`,
  and `fable`; full model IDs and `[1m]` suffixes are not tool parameters.
  A subagent definition can set the exact `model` and `effort`; otherwise
  effort inherits from the session. Select that definition with
  `subagent_type` and `Allocation: role configuration; <reason>.` in the
  prompt, omitting model overrides. Do not invent per-call `effort` or
  `reasoning_effort` fields.
- `subagent_type:"fork"` inherits the parent and ignores model overrides.
  Declare deliberate inheritance and omit overrides. When
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` removes the model control, use the
  authoritative binding rather than claiming a caller override. Check the
  current tool schema and respect managed policy.
- For other Claude subagents, omitting `model` uses the definition and
  configured subagent default before falling back to the parent. A definition
  with `model: inherit` explicitly selects the parent. An inheritance marker
  in the prompt records intent; it does not change those controls. The hook's
  outer effort field belongs to the caller and cannot verify a child's effort.
- A model ID, allowed dispatch, or prompt banner is not runtime verification.
  Check native model and effort metadata when available. Managed effort caps,
  alias mappings, or runtime substitutions can change the requested pair;
  report a mismatch instead of calling it the selected allocation.

Keep explicit model requirements on the selected route. Where an authorized
Claude CLI invocation must refuse instead of switching models after a flagged
request, use `switchModelsOnFlag:false` in that invocation's settings and do
not supply a fallback chain. Do not overwrite global user settings or bypass
managed policy. A refusal is not permission to change model or provider.

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
