---
name: orchestrate
description: "Coordinate explicitly requested fleet/account allocation or delegated remote-agent work across projects, hosts, and dependencies. Use when the user requests those capabilities or names this skill. Ordinary local implementation and parallel work use native tools and subagents without fleet intake. A bounded one-host admin operation uses its named CLI or roundhouse:remote-mac over SSH directly."
---

# Orchestrate

When `TYPESAFE_API_KEY` is available, use [Jev](../jev/SKILL.md) by default for
appropriate bounded decisions during orchestration: selecting model and
reasoning effort, prioritizing ready work, and choosing relevant evidence to
inspect. Filter candidates through existing dependencies, eligibility,
privacy, and authority first. Jev cannot admit or dispatch work, create visible
tasks, or attest host readiness; failed or uncertain advice falls back to
normal reasoning. Explicit choices and deterministic facts need no inference.

Coordinate the requested objective, assigning clear ownership and verifying
the combined result. Use this specialist workflow for explicitly requested
fleet/account allocation or delegated remote-agent work. A configured catalog,
multiple files, or useful local parallelism does not activate it automatically.
If the user names this skill for local work, use the same lightweight native
execution and delegation as ordinary delivery.

## Choose the execution surface

Use native tools for deterministic work and native subagents for ordinary
implementation, research, and review. The coordinator may perform unassigned
local work while children handle independent scopes. Keep one canonical writer
per shared file, and transfer ownership explicitly before another agent edits
it. Do not serialize independent work merely to preserve a controller-only role.

| Need | Codex | Claude Code |
| --- | --- | --- |
| Ordinary delegated work | `spawn_agent`, then `send_message` or `followup_task` | Native `Agent` subagent |
| Monitor ordinary children | Pushed results; `wait_agent` when blocked | Native completion notifications; supported event waits |
| A visible user-owned task | `create_thread` or `fork_thread`, only on explicit user direction | Use an exposed session/task capability only when requested |
| Monitor an explicitly requested visible task | `wait_threads` with cursors and a nonzero timeout | Exposed session/task completion events or waits |
| A delegated agent on another host | Supported destination-native agent carrier | Supported destination-native agent carrier |
| A bounded one-host admin operation | Named CLI or `roundhouse:remote-mac` over SSH | Named CLI or `roundhouse:remote-mac` over SSH |

Visible user-owned tasks require explicit user direction to create or fork
them. A request to use subagents, a fleet catalog, or a software implementation
request is not that direction. If a required remote carrier creates a visible
task, establish that authorization before using that carrier; complete any
independent local work meanwhile. Never substitute a user-owned task for an
ordinary native child just to obtain a different model.

When a needed tool is not eagerly listed, search the deferred capability
catalog before declaring it unavailable. Use the actual tool schema; do not
invent role, model, effort, placement, or per-child plugin controls. Report a
missing or unsupported carrier accurately, with a disclosed supported
alternative where one fits the user's scope.

Follow [agent completion and waiting](../../references/agent-coordination.md)
for every child and task: prefer completion notifications, do independent work,
then use a supported yield/resume path or a blocking event wait. Status polling
is a fallback for a missing event surface or a concrete recovery question.

## Allocate model and effort together

Before each agent assignment, use `railyard:model-routing` to deliberately
select model AND reasoning effort for the actual scope, risks, context, and
user constraints. Astra Max is the baseline candidate for substantive
engineering. Change that choice when comparable completed work, capability
needs, or an explicit latency preference supports it. Lower per-call cost does
not establish lower cost to an accepted result; include retries and repairs in
any efficiency comparison. Do not launch a cheap-model child for an operation
a deterministic tool can complete directly.

Deliberate inheritance is permitted. For a native Codex assignment, put
`Allocation: inherit model and reasoning effort; <reason>.` in the brief and
omit the override fields. Full-history forks (`fork_turns: "all"`, including
the default) reject model/effort overrides. When changing settings, use a
supported limited-history or no-history fork and a sufficient task brief.
Fixed specialist roles resolve their authoritative settings without forbidden
overrides. Report requested and observed allocation honestly; an unsupported
selection must not silently become a different model or effort.

Reuse an existing native child for a related continuation when its allocation
still fits. Reassess model and effort when scope or evidence changes. If the
tool cannot change an unsuitable allocation, use a supported fresh native
child rather than pretending a follow-up changed it. Status, clarification,
and cancellation messages are coordination, not a new implementation workflow.

## Keep ownership and handoffs small

1. Identify the requested result, persistent authorization, and stop condition.
   Preserve earlier authorization unless a later instruction changes it.
2. Split work only where scopes can proceed independently or a dependency
   requires a separate owner. Give shared integration files one writer.
3. State each child's objective, owned files or system, constraints,
   dependencies, and required verification. Use an isolated worktree when
   concurrent changes need it; preserve unrelated work.
4. Start dependency-ready work in parallel. Consume completion notifications;
   when blocked, yield with a verified resume path or use a blocking event wait.
   Do not repeatedly reread unchanged output or duplicate the child's work.
   Answer child questions, resolve dependencies, and redirect failed work.
5. Verify the combined result against the user's acceptance surface. Continue
   authorized delivery and needed repairs until complete or concretely blocked.

A useful brief is enough for ordinary delegation:

```text
Objective: <one owned result>
Scope: <files, repository, system, or decision; writer boundary>
Constraints: <behavior, authorization, exclusions, and relevant dependencies>
Allocation: <model and reasoning effort, or deliberate inheritance, with reason>
Verify: <observable result and required checks>
Endpoint: <caller's final delivery target and this child's owned handoff>
Report: <changes, evidence, and remaining blocker or integration handoff>
Coordination: Report completion, blockers, or dependencies needing attention; use completion events or a supported wait, not repeated status checks. End/yield only with a verified resume path when work remains. Pass this rule to descendants.
```

Do not forward unrelated history or require a separate plan, admission receipt,
ledger, digest, goal, recap, or retrospective artifact for every child.
Create user-owned goals or visible tasks only when explicitly requested.
Internal checklists or task tracking remain optional. Titles follow user and
repository conventions; retitle only when focus or resume state changes. Read
optional title guidance only when needed.

## Fleet/account and remote work

Load these specialist contracts only when the requested scope needs them:

- For a delegated remote agent, read [remote execution](references/remote-execution.md).
  Verify the assigned host's exact repository, runtime, capabilities, and required
  authentication through the relevant Roundhouse skills before dispatch.
- For explicit fleet/account allocation, use the configured
  `railyard/model-routing/v1` admission, budget, transport, and accounting
  contracts from [model routing](../../references/model-routing.md). Honor its
  applicable reservations and receipts; do not copy its policy into a prompt.
- For an explicitly selected provider bridge, read
  [provider task routing](../../references/provider-task-routing.md). Keep its
  transport authority, secret-free handoff, and returned-output trust boundary.
  Provider routing does not authorize creating a visible task.

Check only prerequisites for the assigned scope. Fleet-wide parity requires
checking every requested node; one remote assignment does not require a whole
fleet reconciliation. Missing readiness is a concrete prerequisite to repair
within existing authorization, not permission to mutate unrelated hosts.
A bounded SSH admin command uses the direct route and skips agent-readiness
ceremony. When the user names a CLI, inspect that exact CLI first. A correction
such as "just SSH" or "use the CLI" cancels unconsumed orchestration work and
reclassifies the operation immediately.

## Delivery, review, and monitoring

A software-delivery owner uses native execution and the selected CE stages,
coordinated by `railyard:deliver` when useful. Use
`compound-engineering:ce-commit-push-pr` when creating a PR or pushing
user-requested commits to an existing PR; use `gh-stack` for related dependent
PRs when appropriate. Give integration and each affected repository a named
owner. Push or publish only within the requested boundary.

An explicit user Deliver implementation/fix request defaults to the full lifecycle,
including required release or deployment and consumer verification. Pass that
endpoint into child briefs. A child's bounded handoff does not complete the
caller's delivery; the coordinator continues the remaining owned stages.

CE alone owns review settlement and CI/PR monitoring. Reuse the lane's active
CE watcher, including LFG's watcher, and its bounded continuations. The
orchestrator monitors child completion and dependencies; it does not launch a
second PR watcher or impose another Railyard review gate. Route useful reviewer
findings into the same CE settlement owner.

Run checks that prove the changed behavior and the repository's required final
gates. Reuse valid evidence; rerun when a change, failure, or unresolved concern
invalidates it. Distinguish the execution host from the target platform: a
Linux or WSL pass alone does not prove native Windows behavior. Inspect the
actual reported artifacts before accepting completion.

Explicit plan-only, diagnosis-only, review-only, local-only, and PR-only requests
end at their stated result. Authorized delivery continues through CE settlement,
merge, required release or deployment, and proof at the actual consumer.
Keep monitoring active children until each owned scope is complete, handed off
as requested, or blocked by a concrete unmet prerequisite. Report results and
blockers without inventing a mandatory process recap.

## Preserve resumable work

A stopped, idle, or completed-turn signal is not proof that the objective is
done. Preserve active worktrees, branches, and user-owned tasks. Archiving,
worktree removal, runtime inspection, and process cleanup are separate
on-demand operations with their own authorization and safety checks; they are
not automatic delivery gates. If explicitly asked to clean up, establish that
the target is inactive, its output is integrated or preserved, and the exact
owned target is safe before using the supported removal/archive operation.
Never reset, discard, or delete unrelated or dirty work without authorization.
