---
layout: default
title: Lifecycle
parent: Delivery
nav_order: 1
---

# The delivery lifecycle

The requested finish line determines the workflow. An explicit Deliver implementation/fix request authorizes the shipping path through required release or deployment and consumer verification. Explicit plan-only, diagnosis-only, review-only, local-only, and PR-only requests keep their stated endpoints. Routine work runs natively, with a focused skill selected automatically when it helps; internal skill selection does not expand authorization.

## Native work and allocation

Name the behavior to change, preserve unrelated work, and use the repository's existing checks. Delegate independent bounded subtasks to native children when useful.

Choose model and reasoning effort together. In Claude Code, Opus 5.5 at `medium` is the default for substantive subagent work, with Fable 5.1 for frontier-hard or long autonomous work. In Codex, GPT-6.1 Sol at `medium` is the baseline for implementation, debugging, planning, and ambiguous or multi-file work, even when small or bounded. Raise Sol 6.1 to `high`, `xhigh`, or `max` for justified demanding work. Astra is a rare, explicitly justified escalation after a concrete residual failure or quality gap on Sol 6.1. Omitting the model means the child inherits. See [model routing](/delivery/model-routing/).

If the current host can't run a selection, report it; don't fall back to another model, effort, provider, or host without saying so.

## Select a workflow where it helps

CE planning, debugging, code review, feedback resolution, and UI skills are selected for relevant work. LFG remains available when explicitly chosen. Standalone Thermos review and Oracle consultation can supply additional perspectives when useful. Before every push, the whole-candidate gate requires broad review of the exact candidate’s complete cumulative change-set and affected lifecycle. Existing Thermos correctness/security and maintainability passes alongside Codex review can fulfill it; no third reviewer or watcher is required.

Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR. CE owns the selected review-settlement and CI watch loop. Railyard does not run a second watcher or require another reviewer after CE has completed that work.

## Verify the requested result

Run required repository checks and the smallest useful checks for the changed behavior. Repeat them when a relevant change, failure, or unresolved concern warrants it. For an authorized merge, verify that GitHub reports the PR merged, then prove the merge commit is on the fetched base branch and check the merged state.

```sh
git merge-base --is-ancestor <merge-commit> origin/<base>
<smallest applicable post-merge check>
```

A deployed application or other external result also needs evidence at the acceptance surface the user requested. Complete required release and deployment steps; for plugins, publish required marketplace pins, update the intended installation through its supported manager, and verify installed behavior. A passing local test or merged source alone cannot prove that result.

## An authorized shipping path

This diagram shows a shipping workflow with selected review and CE settlement. Proof covers merge/source checks and, when required by the selected authorized endpoint, release or deployment followed by consumer verification. Learning is optional; narrower requests stop at their requested outcome.

![A shipping workflow uses selected review and CE settlement. Proof covers merge/source checks and, when required by the selected authorized endpoint, release or deployment followed by consumer verification. Learning is optional; narrower requests stop at their requested outcome.](/diagrams/m2-delivery-lifecycle.svg)

### Sequence

1. **Ask.** Establish the requested result and whether publishing and merging are authorized.
2. **Route.** Choose model and reasoning effort deliberately, or let the child inherit.
3. **Build.** Execute natively or use a useful selected CE workflow.
4. **Review.** Before every push, complete whole-candidate review and bind identity, coverage, tests, and findings dispositions in a compact receipt. Reuse unchanged proof. Required pre-push evidence blocks publication; future release, install, and consumer verification remains pending with a named delivery-tail owner.
5. **Quality.** Run required repository checks and focused checks for the changed surface.
6. **Publish.** Use CE commit/push/PR for PR creation and user-requested PR pushes.
7. **Settle.** Let the selected CE workflow own review settlement, feedback, and CI.
8. **Merge.** Merge the authorized change once the current repository requirements are satisfied.
9. **Prove.** Verify merge ancestry, complete required release or deployment, and check the actual consumer.
10. **Learn.** Capture a reusable lesson when useful or requested; no routine retrospective artifact is required.

Report the changed behavior, validation, and any remaining limitation. Task archival, worktree removal, and runtime cleanup are separate operations with their own authority.
