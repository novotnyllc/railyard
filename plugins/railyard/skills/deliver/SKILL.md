---
name: deliver
description: "Deliver an implementation or fix through review, merge, required release or deployment, and consumer verification unless the user sets a narrower endpoint. Use when the user explicitly asks to deliver or ship a change, or names this skill."
---

# Deliver

Complete the requested change with the smallest workflow that proves its
result. Native tools and native subagents can implement directly; select a
Compound Engineering (CE) stage when the task benefits from one.

## Endpoint

An explicit user request to deliver an implementation or fix, including
invoking this skill for one, authorizes the full delivery lifecycle by default:
implementation, verification, commit, push, PR, CE review/CI settlement, merge,
required release or deployment, and verification at the actual consumer. A
local patch, passing tests, an open PR, or a merged source change is not the
endpoint while release, marketplace publication, installation, or deployment
remains.

Explicit plan-only, diagnosis-only, review-only, local-only, and PR-only
requests override that default and stop at their result. Read the endpoint
from the current instruction and still-applicable prior authorization: a later
local-only stop halts shipping; a later ship or merge instruction extends an
earlier local stop. Continue authorized work without asking again.

Selecting this skill internally does not expand the user's request. Outside an
explicit delivery request, a plan, review, diagnosis, or local edit does not by
itself authorize publication or merge. A child prompt invoking Deliver inherits
the caller's authorized endpoint and cannot create new publication or
deployment authority.

## Stages

| Work | Execution |
| --- | --- |
| Bounded, understood fix or mechanical edit | Native edit and focused verification |
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

CE is an external dependency. Discover the installed skill before using it and
never patch its source or plugin cache. If a selected stage is missing, report
it, complete independent work, and install it through the supported manager
only within existing authorization.

## Before every push

Complete the [whole-candidate review gate](../../references/whole-candidate-review.md)
before every push, including the first publication, focused feedback fixes,
release/version changes, and pushes inside LFG or CE continuations. Pass this
requirement and its exact-candidate receipt to the CE publishing owner as a
project publishing requirement before invoking a stage that can push. Keep
ownership of the gate across handoffs; CE remains the only settlement owner.
Revalidate the complete cumulative candidate each time, reusing prior proof
only for unchanged inputs and behaviors. Do not substitute the last few
changed lines. Keep the gate's delivery ledger through settlement.

## One review and CI owner

CE alone owns review settlement and CI/PR monitoring. When LFG already runs
`ce-babysit-pr`, consume its result and continuations; for an existing PR
outside LFG, `ce-babysit-pr` owns that loop. Railyard adds no watcher or
settlement checklist. Feed the end-of-PR review's findings, and any extra
reviewer's, to the same CE owner.

A CE checkpoint that still needs a watch continuation is not completion.
Continue that owner until review and CI settle or a concrete blocker requires
user action.

## End-of-PR review

For each publication candidate, run these two in parallel against its base
and hand the combined findings and coverage receipt to the CE owner before
pushing and before settlement. Reuse a pre-push review at settlement only
when its complete candidate and relevant inputs still match:

- `railyard:thermos`
- `codex review --base <base>`, with the model and effort that
  `railyard:model-routing` sets for Codex review

These reviews produce findings only; CE still settles review and CI and hands
off the merge snapshot.

## Delivery tail

After CE's settled result, complete the remaining work only through the user's
selected authorized endpoint:

1. Confirm the merge is still authorized and no user or repository hold
   remains. CE supplies the review and CI disposition; this checks the
   delivery boundary only.
2. Hand CE's final snapshot to the [merge guard](references/ce-merge-guard.md)
   and merge the exact reviewed head with the repository's configured
   strategy. For a stack, follow `gh-stack` in dependency order.
3. Observe the merge commit, fetch the base, and verify that the merge is on
   the intended base. Run the smallest applicable post-merge source check.
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

A local test pass, pushed branch, open PR, green CI, merge, and deployed result
prove different things; verify at the requested acceptance surface.
Intermediate handoffs and bounded waits do not end the overall delivery. Keep
ownership through the endpoint, continue independent work around a blocker,
and stop only when completion or a concrete unmet prerequisite requires user
or external action.

## Shape and pace

Long write-then-review cycles are the main delivery cost. Shape the work so
review confirms rather than discovers:

- One concern per PR, roughly 500 changed lines or fewer. Split new features
  from fixes and unrelated hardening into their own PRs. A behavior-preserving
  refactor that review asks for may move to an immediate follow-up PR only
  when the owner records it as an accepted finding with that follow-up as its
  disposition under the gate; it is never silently dropped.
- Review while building. The implementer runs a quick Codex review after
  each commit (`codex review --commit HEAD`) or on an uncommitted fix batch
  (`codex review --uncommitted`), with the model and effort that
  `railyard:model-routing` sets for Codex review, and fixes what it finds, so
  the pre-push whole-candidate gate meets a candidate that is already clean.
- The implementer owns its fix, test, and delta-review loop and reports a
  review-clean candidate with its evidence. The delivery owner does not relay
  each review round; it steps in for judgment calls and the publication
  decision.
- Later gate rounds reuse proof for unchanged inputs and review the delta,
  as the gate allows; rerun broad reviews only where the change invalidates
  them.
- Land promptly in dependency order and merge the moving base once, just
  before the push, rather than repeatedly.

## Delegation

Choose model and reasoning effort for each assignment with
`railyard:model-routing`. Give each native subagent an objective, owned scope,
constraints, dependencies, and checks; keep one writer per shared file and use
isolated worktrees when concurrent edits need them. Coordinate completion as
described in [agent completion and waiting](../../references/agent-coordination.md).
Create visible user-owned tasks only on explicit user direction. Fleet/account
allocation or a remote agent goes through `railyard:orchestrate` only when the
user explicitly asks for it.

## Verification and reporting

Run focused checks that prove the changed behavior, then the repository's
required final checks. Rerun only when a change, failure, or unresolved concern
invalidates the evidence, and inspect the real result rather than a worker's
claim. Report what changed, how it was verified, and the delivery state.
Preserve active work and user-owned tasks; cleanup happens only when requested.
