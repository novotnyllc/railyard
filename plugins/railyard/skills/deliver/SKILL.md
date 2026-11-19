---
name: deliver
description: "Handle implementation, fix, and pull request creation requests, including plain-language requests. For authorized repository work, follow the PR through review, CI, confirmed merge, and any required release, deployment, and consumer verification. Honor explicit narrower endpoints and repository protections."
---

# Deliver

Act as the codebase maintainer for the authorized change. Own scope,
integration, verification, and completion. Use native tools or Compound
Engineering (CE).

## Endpoint

For authorized repository work, a plain implementation, fix, or open-PR
request includes review, CI, and confirmed merge through the repository's
normal process. Use this intent without a separate merge or shipping request.
Complete required release or deployment and verify the actual consumer.
Installing or updating Railyard grants no privileges or approval.

Honor explicit plan-only, diagnosis-only, review-only, local-only, push-only,
PR-only, and no-merge requests. For a push-only or PR-only endpoint, apply the
[publication hold rules](references/ce-call-adapter.md#merge-authorization-at-publication)
before a new head can trigger automatic landing. Advice and investigation
requests carry no publication authority. A child inherits the caller's
endpoint and cannot expand it.
Respect draft status, holds, branch rules and required human approvals.

## Stages

| Work | Execution |
| --- | --- |
| Bounded, understood fix or mechanical edit | Native edit and focused verification within Deliver |
| Consequential design choice | `compound-engineering:ce-brainstorm` |
| Substantial planning with dependencies or unclear implementation | `compound-engineering:ce-plan` |
| Difficult diagnosis | `compound-engineering:ce-debug` |
| Implementation that benefits from a structured work stage | `compound-engineering:ce-work` |
| Coordinated planning, implementation, review, and shipping | `compound-engineering:lfg` |
| Review a PR before settlement | [End-of-PR review](#end-of-pr-review) |
| Create a PR or push user-requested commits to an existing PR | `compound-engineering:ce-commit-push-pr` |
| Watch or drive an existing PR, including review and CI repairs | `compound-engineering:ce-babysit-pr` |
| Resolve one bounded batch of review feedback | `compound-engineering:ce-resolve-pr-feedback` |

A stage result is a handoff, not the endpoint, when the delivery request
includes later stages. Use `compound-engineering:ce-commit-push-pr` whenever
creating a PR or pushing user-requested commits to an existing PR, including
inside another workflow. Use `gh-stack` for related dependent PRs; keep
unrelated PRs independent. LFG fits when its combined stages suit the change or
the user asks for it; do not wrap an active LFG run in another plan/work
sequence. Running a CE stage means reading and executing its `SKILL.md`; see
[CE call semantics](references/ce-call-adapter.md).

Discover each installed CE skill before use. If a stage is missing, report it,
continue independent work, and use the supported manager within existing
authorization. Keep installed skill sources and caches untouched.

## Before every push

Pass the [local review policy](../../references/whole-candidate-review.md) to
every publisher, including CE feedback and CI repair stages. The default
`light` level requires repository checks and one independent local review of
the complete change before the first push. A completed CE review of the same
candidate can fulfill it. Apply the shared policy’s severity and focused verification rules.

For a repair batch, review the changes since the last reviewed head and the
behavior they affect, then run the required checks and push once. Repeat the
whole-change review when the design or risk materially changes or prior review
coverage cannot be established. Keep receipts, the delivery ledger, and the
paired specialist passes for explicitly selected `full` review. Honor an
explicit `checks` selection.

## One review and CI owner

CE alone owns review settlement and CI/PR monitoring. Use the
[CE pipeline handoff](references/ce-call-adapter.md) when delivering a single
PR directly. Include its [local repair handoff](references/ce-call-adapter.md#repairs-during-the-ce-watch)
when starting the watcher. When LFG already runs
`ce-babysit-pr`, consume its result and continuations; for an existing PR
outside LFG, `ce-babysit-pr` owns that loop; Railyard adds no watcher. Feed
every reviewer's findings to that owner with the
[review feedback settlement policy](../../references/review-feedback-settlement.md)
as a project settlement requirement.

Keep that owner watching until the requested endpoint. Batch available review
fixes into one verified repair push. Act on CI failures for the current head;
refresh the checks when a repair or another contributor changes it. For each comment,
fix a blocker, explain a decline, or link an issue for work the PR can safely
ship without. Honor the policy's single routine repair batch across automated
reviewers and hand a ready PR to the repository's merge process promptly.

## End-of-PR review

For each `full`-level publication candidate, run these two in parallel against its base
and hand the combined findings and coverage receipt to the CE owner before
pushing and before settlement. Reuse a pre-push review at settlement only
when its complete candidate and relevant inputs still match:

- `railyard:thermos`
- `codex review --base <base>` using the configured Codex review settings

These reviews produce findings only; CE still settles review and CI.

## Delivery tail

After CE settles or the adapter verifies that only an optional reviewer remains, complete the remaining work only through the user's
selected authorized endpoint:

1. Refresh the PR before landing. Confirm its repository, base, and reviewed
   head, plus authorization, draft and hold status, required checks and
   approvals, and review resolution. If the head has changed, return to local
   review and CE settlement for that head. Resolve unknown readiness before
   landing.
2. Follow the repository's merge policy. With an automatic queue such as
   Mergify, satisfy the queue's rules and observe it land. With GitHub's
   merge queue, enqueue the ready PR with `gh pr merge <number> --repo
   <owner/repo> --match-head-commit <reviewed-sha>`. For a direct merge, use
   the same command with the repository's configured merge strategy. Follow
   `gh-stack` in dependency order for managed stacks. A race or refusal
   calls for a fresh PR read and resolution through the configured path.
3. Verify GitHub reports the PR merged to the intended base. Fetch the base
   and confirm it contains the merge commit. Run the smallest applicable
   post-merge source check.
4. Complete the release or deployment steps required by the selected endpoint
   within the assigned target. For plugins, publish required marketplace pins
   and update the intended installation through its supported manager. Do not
   expand one target into unrelated fleet work or edit installed cache files.
5. When the selected endpoint requires a deployed or installed result, verify
   the newly deployed result at the actual consumer after completing the
   required release, deployment, or installation. For plugins, check the
   installed files and relevant runtime behavior. For configuration and
   settings, consumer verification is reading the value back where it is
   consumed (the config file, or a CLI readback of the effective value). Live-process adoption,
   restarts, inference canaries, and testing third-party tools' internals are
   out of scope unless the user asks.
6. Report the result, PR/merge and release links, relevant checks, and any
   remaining concrete blocker.

Verify at the requested acceptance surface. Keep ownership through handoffs
and waits. Continue independent work around a blocker and stop when the
endpoint is reached or a prerequisite requires user or external action.

## Shape and pace

Keep each PR focused on one concern, aiming for roughly 500 changed lines or
fewer when practical. When review finds work the change can
safely ship without, use a linked follow-up. A worker verifies its own edits;
the delivery owner uses the selected local review level at publication. Reuse
applicable review findings and checks across handoffs. Confirm the reviewed
head and target before landing.

Tests never take more than 10 minutes: the full local suite and every CI
test job. Shorter is better. A slower suite is a defect to fix (parallelize,
shard, cut slow fixtures), never a limit to raise or a reason to skip it.

## Delegation

Give each subagent an objective, scope, constraints, dependencies, and checks.
For concurrent writers and task-created cleanup, follow
[worktree ownership](../../references/agent-coordination.md#worktree-ownership).
Use the same reference for [completion and waiting](../../references/agent-coordination.md#when-the-coordinator-has-nothing-else-to-do).
Create visible user-owned tasks only on explicit user direction. Fleet/account
allocation or a remote agent goes through `railyard:orchestrate` only when the
user explicitly asks for it.

## Verification and reporting

Run focused checks that prove the changed behavior, then the repository's
required final checks. Rerun only when a change, failure, or unresolved concern
invalidates the evidence, and inspect the real result rather than a worker's
claim. Report what changed, how it was verified, and the delivery state.
