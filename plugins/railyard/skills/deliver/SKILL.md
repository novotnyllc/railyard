---
name: deliver
description: "Deliver an implementation or fix through review, merge, required release or deployment, and consumer verification unless the user sets a narrower endpoint. Use when the user requests delivery or names this skill, or when coordinating selected Compound Engineering stages helps. Internal skill selection does not expand user authorization."
---

# Deliver

Complete the requested change with the smallest workflow that proves its
result. Native tools and native subagents can implement directly. Automatically
select a useful Compound Engineering (CE) stage when the task calls for it;
invoking this skill does not require a full LFG carrier, work contract, route
receipt, or retrospective.

## Select the workflow and endpoint

An explicit user request to deliver an implementation or fix, including invoking
this skill for that change, authorizes the full delivery lifecycle by default:
implementation, verification, commit, push, PR, CE review/CI settlement, merge,
required release or deployment, and verification at the actual consumer. Do not
stop at a local patch, passing tests, an open PR, or a merged source change when
release, marketplace publication, installation, or deployment still remains.

Determine the user's requested result and terminal boundary from the current
instruction and still-applicable prior authorization. Explicit plan-only,
diagnosis-only, review-only, local-only, and PR-only requests override the full
delivery default. Continue authorized work without asking again. A later
local-only stop halts shipping; a later ship or merge instruction extends an
earlier local stop. Internally selecting this skill does not expand the user's
request: outside an explicit delivery request, a plan, review, diagnosis, or
local edit does not by itself authorize publication or merge.
An agent-authored child prompt invoking Deliver inherits the caller's already
authorized endpoint; it cannot create new publication or deployment authority.

When `TYPESAFE_API_KEY` is present, use [Jev](../jev/SKILL.md) by default
throughout delivery for appropriate bounded decisions: workflow choice,
model-and-effort selection, evidence selection, work priority, and the next
review investigation. Revisit when task state or evidence changes, without
repeating identical requests or asking it to perform deterministic lookups.
Supply only available, eligible options and relevant permitted context.
Honor explicit choices and offline/privacy restrictions; on missing key,
uncertainty, or service failure, continue with normal judgment. Jev does not
extend the requested endpoint or take over CE's review disposition.

| Work to do | Appropriate execution | Completion boundary |
| --- | --- | --- |
| Bounded, understood fix or mechanical edit | Native edit and focused verification | Selected endpoint; full delivery for an explicit Deliver request |
| Explore a consequential design choice | `compound-engineering:ce-brainstorm` | Requested decision or framing |
| Substantial planning with dependencies or unclear implementation | `compound-engineering:ce-plan` | Plan, or continue when implementation is authorized |
| Difficult diagnosis | `compound-engineering:ce-debug` | Findings; also fix and verify when requested |
| Implementation that benefits from a structured work stage | `compound-engineering:ce-work` | Requested implementation result |
| Coordinated planning, implementation, review, and shipping | `compound-engineering:lfg` | Its handoff, then the authorized delivery tail |
| Review a meaningful or risky change | `compound-engineering:ce-code-review` | Review, plus authorized fixes |
| Create a PR or push user-requested commits to an existing PR | `compound-engineering:ce-commit-push-pr` | Requested PR or updated branch |
| Watch or drive an existing PR, including review and CI repairs | `compound-engineering:ce-babysit-pr` | Requested watch result or delivery tail |
| Resolve one bounded batch of review feedback | `compound-engineering:ce-resolve-pr-feedback` | Resolved feedback and relevant checks |

These rows identify stage handoffs. A stage result is not the final endpoint
when the user's delivery request includes later stages.

Use `compound-engineering:ce-commit-push-pr` whenever creating a PR or pushing
user-requested commits to an existing PR, including inside another workflow.
Use `gh-stack` for related dependent PRs when appropriate; keep unrelated PRs
independent. Do not install extensions or replace a named CLI merely because a
route mentions one. Discover the requested capability and follow the user's
existing installation authorization if it is missing.

LFG is useful when its combined stages fit the change or the user requests it.
It is not the default requirement for every fix, nor a prerequisite to native
implementation. Do not wrap an active LFG run in another plan/work sequence.
Load only the selected skill and the references it needs; invoke it by reading
and executing its instructions, as explained in
[CE call semantics](references/ce-call-adapter.md).

## One review and CI owner

Compound Engineering alone owns review settlement and CI/PR monitoring. When
LFG already owns `ce-babysit-pr`, consume its result and any bounded continuation;
do not start a second watcher. For an existing PR outside LFG, `ce-babysit-pr`
owns that loop and delegates feedback and CI repairs through its CE stages.
Do not add a Railyard watcher, settlement checklist, mandatory Thermos pass, or
hardcoded reviewer on top. Deliberately select any useful reviewer through
model routing and feed its findings to the same CE owner.

A CE checkpoint that still needs a watch continuation is not completion of an
authorized delivery request. Continue that owner until its review and CI work
settles or a concrete blocker requires user action. Do not end an active task
merely because a bounded watch call returned.

CE is an external workflow dependency for the selected CE stage. Discover its
installed skill before using it; never patch its source or plugin cache. If it
is missing, report the exact unavailable stage and complete independent work.
Resolve installation through the supported manager within existing user
authorization. Session startup does not install dependencies.

## Delivery tail

After CE's settled result, complete the remaining work only through the user's
selected authorized endpoint:

1. Confirm the requested merge is still authorized and no user or repository
   hold remains. CE supplies the review and CI disposition; this step checks
   the delivery boundary, not a second settlement process.
2. Hand CE's final snapshot to the [merge guard](references/ce-merge-guard.md)
   and merge the exact reviewed head using the repository's configured
   strategy. For a stack, follow `gh-stack` in dependency order and use its
   supported landing route; the shell guard covers the documented `gh` route.
3. Observe the merged state and merge commit, fetch the base, and verify that
   the merge is on the intended base. Run the smallest applicable post-merge
   source check.
4. Complete the repository's release or deployment steps required by the
   selected endpoint within the assigned target. For plugins, publish required
   marketplace pins and update the intended installation through its supported
   manager as required by that endpoint. Do not expand one target into unrelated
   fleet work or edit installed cache files directly.
5. When the selected endpoint requires a deployed or installed result, verify
   the newly deployed result at the actual consumer after completing the required
   release, deployment, or installation. For plugins, verify the installed files
   and relevant runtime behavior. Source, marketplace, and installed state are
   separate acceptance checks.
6. Report the result, PR/merge and release links, relevant checks, and any
   remaining concrete blocker.

A local test pass, pushed branch, open PR, green CI, merge, and deployed result
prove different things. Verify at the user's requested acceptance surface.
Explicit plan-only, review-only, PR-only, and local-only boundaries stop there.
Intermediate handoffs and bounded waits do not end the overall delivery. Keep
ownership through the selected endpoint; continue independent work around a
blocker and stop only when completion or a concrete unmet prerequisite requires
user or external action. Do not ask again for routine steps already authorized
by the delivery request.

## Allocate only when delegating

Before each agent assignment, choose model AND reasoning effort through
`railyard:model-routing`. Use GPT-6 Sol at medium effort as the ordinary Codex
baseline; raise effort for demanding work and select Astra when a specific
task needs its added depth. Compare complete accepted outcomes, including
retries and repairs. Deterministic tools can perform mechanical work directly; do not
spawn an agent just to move that work to a cheaper model.

Deliberate inheritance is a valid allocation. For native Codex dispatch, state
`Allocation: inherit model and reasoning effort; <reason>.` in the brief and
omit the override fields. A full-history fork (`fork_turns: "all"`, including
the native default) rejects model/effort overrides. To change either setting,
use a supported limited-history or no-history fork with a sufficient task
brief. Fixed specialist roles use their authoritative settings without
forbidden overrides. Report the actual model and effort when the tool exposes
them; do not claim an unsupported or unobserved selection.

Use native subagents for ordinary delegated implementation, research, or review.
Give each an objective, owned scope, constraints, dependencies, and checks;
keep one canonical writer per shared file. Use isolated worktrees when concurrent
edits need isolation, and preserve unrelated changes. Visible user-owned tasks
require explicit user direction to create or fork them; routine delegation and
a configured catalog do not authorize task creation.

Use [agent completion and waiting](../../references/agent-coordination.md):
prefer completion notifications while doing independent work, then a supported
yield/resume path or blocking event wait. Pass that rule in child briefs with
the requirement to report completion, blockers, and dependencies needing
attention. Reserve status polling for missing event support or concrete recovery.

Use `railyard:orchestrate` when the user explicitly requests fleet/account
allocation or a delegated remote agent. Load its specialized admission,
transport, and readiness instructions only for that scope. Local delivery does
not require a fleet intake because a configuration file exists.

## Verification and reporting

Run focused checks that prove the changed behavior, then the repository's
required final checks. Use relevant platform and browser skills when the
result needs native or UI verification. Repeat checks when changes, failures,
or unresolved concerns invalidate the evidence; do not repeat unchanged suites
as a workflow ritual. Inspect the real result, not just a worker's claim.

Keep the final report proportionate: what changed, verification, and the
requested delivery state. Contracts, hash-bound receipts, audit/retrospective
artifacts, `ce-compound`, and runtime cleanup are on demand, not routine closing
requirements. Preserve active work and user-owned tasks; archiving, worktree
removal, and process cleanup follow their own explicit authorized scope.
