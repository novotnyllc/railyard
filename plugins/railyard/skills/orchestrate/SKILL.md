---
name: orchestrate
description: "Coordinate explicitly requested fleet/account allocation or delegated remote-agent work across projects, hosts, and dependencies. Use when the user requests those capabilities or names this skill. Ordinary local implementation and parallel work use native tools and subagents without this skill. A bounded one-host admin operation uses its named CLI or roundhouse:remote-mac over SSH directly."
---

# Orchestrate

Coordinate the requested objective: assign clear ownership, monitor
dependencies, and verify the combined result. This workflow activates only for
explicitly requested fleet/account allocation or delegated remote-agent work.
A configured fleet catalog, many files, or useful local parallelism does not
activate it. If the user names this skill for local work, use the same native
execution and delegation as ordinary delivery.

## Execution surfaces

Use native tools for deterministic work and native subagents for ordinary
implementation, research, and review. The coordinator may do unassigned local
work while children handle independent scopes. Keep one writer per shared
file and transfer ownership explicitly before another agent edits it.

| Need | Codex | Claude Code |
| --- | --- | --- |
| Ordinary delegated work | `spawn_agent`, then `send_message` or `followup_task` | Native `Agent` subagent |
| Monitor ordinary children | Pushed results; `wait_agent` when blocked | Native completion notifications; supported event waits |
| A visible user-owned task | `create_thread` or `fork_thread`, only on explicit user direction | An exposed session/task capability, only when requested |
| Monitor an explicitly requested visible task | `wait_threads` with cursors and a nonzero timeout | Exposed session/task completion events or waits |
| A delegated agent on another host | Supported destination-native agent carrier | Supported destination-native agent carrier |
| A bounded one-host admin operation | Named CLI or `roundhouse:remote-mac` over SSH | Named CLI or `roundhouse:remote-mac` over SSH |

Visible user-owned tasks require explicit user direction to create or fork
them; a request to use subagents, a fleet catalog, or an implementation
request is not that direction. If a required remote carrier would create a
visible task, get that authorization first and do independent local work
meanwhile. Never substitute a user-owned task for a native child to obtain a
different model.

Search the deferred tool catalog before declaring a capability unavailable,
and use the actual tool schema. Report a missing carrier accurately, with a
supported alternative when one fits the user's scope. Coordinate completion as
described in [agent completion and waiting](../../references/agent-coordination.md).

Choose model and reasoning effort for each assignment with
`railyard:model-routing`. Reuse an existing child for a related continuation
when its allocation still fits; if the tool cannot change an unsuitable
allocation, start a fresh child.

## Ownership and handoffs

1. Identify the requested result, persistent authorization, and stop
   condition. Preserve earlier authorization unless a later instruction
   changes it.
2. Split work only where scopes can proceed independently or a dependency
   needs a separate owner. Give shared integration files one writer.
3. Brief each child with its objective, owned scope, constraints,
   dependencies, and verification. Use an isolated worktree when concurrent
   changes need it; preserve unrelated work.
4. Start dependency-ready work in parallel. Answer child questions, resolve
   dependencies, and redirect failed work without duplicating it.
5. Verify the combined result against the user's acceptance surface and
   continue authorized delivery and repairs until complete or concretely
   blocked.

A brief like this is enough:

```text
Objective: <one owned result>
Scope: <files, repository, system, or decision; writer boundary>
Constraints: <behavior, authorization, exclusions, and relevant dependencies>
Verify: <observable result and required checks>
Endpoint: <caller's final delivery target and this child's owned handoff>
Report: <changes, evidence, and remaining blocker or integration handoff>
Coordination: Report completion, blockers, or dependencies needing attention; use completion events or a supported wait, not repeated status checks. Pass this rule to descendants.
```

Forward only the context the child needs. Titles follow user and repository
conventions; [task-title guidance](../../references/task-titles.md) is the
default.

## Fleet/account and remote work

- For a delegated remote agent, read [remote execution](references/remote-execution.md)
  and verify the assigned host's repository, runtime, capabilities, and
  required authentication through the relevant Roundhouse skills before
  dispatch.
- For fleet/account allocation, place work using the user-owned fleet
  configuration and Roundhouse readiness evidence; choose each assignment's
  model and effort with `railyard:model-routing`.
- For an explicitly selected provider bridge, read
  [provider task routing](../../references/provider-task-routing.md). It does
  not authorize creating a visible task.

Check only prerequisites for the assigned scope; fleet-wide parity is the only
case that requires every node. Missing readiness is a prerequisite to repair
within existing authorization, not permission to change unrelated hosts. When
the user names a CLI, inspect that CLI first. A correction such as "just SSH"
or "use the CLI" cancels unconsumed orchestration work and reclassifies the
operation immediately.

## Delivery, review, and monitoring

Software delivery uses native execution and selected CE stages, coordinated by
`railyard:deliver`. Use `compound-engineering:ce-commit-push-pr` when creating
a PR or pushing user-requested commits to an existing PR, and `gh-stack` for
related dependent PRs. Name an owner for integration and for each affected
repository. Publish only within the requested boundary.

An explicit Deliver request defaults to the full lifecycle, including required
release or deployment and consumer verification; pass that endpoint into child
briefs. A child's bounded handoff does not complete the caller's delivery.
Explicit plan-only, diagnosis-only, review-only, local-only, and PR-only
requests end at their stated result.

CE alone owns review settlement and CI/PR monitoring. Reuse the lane's active
CE watcher, including LFG's; the orchestrator monitors children and
dependencies and does not start a second PR watcher or review gate. Route
reviewer findings to that CE owner.

Verify with checks that prove the changed behavior plus the repository's
required gates. Distinguish the execution host from the target platform: a
Linux or WSL pass does not prove native Windows behavior. Inspect the actual
artifacts before accepting completion.

## Preserve resumable work

A stopped, idle, or completed-turn signal does not prove the objective is
done. Preserve active worktrees, branches, and user-owned tasks. Archiving,
worktree removal, and process cleanup happen only on explicit request, after
confirming the target is inactive and its output is integrated or preserved.
Never reset, discard, or delete unrelated or dirty work without authorization.
