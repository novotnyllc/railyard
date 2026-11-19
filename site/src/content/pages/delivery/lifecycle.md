---
layout: default
title: Lifecycle
parent: Delivery
nav_order: 1
---

# The delivery lifecycle

Implementation and fix requests end at confirmed merge when standing delivery authority covers publication and merge. Required approvals and repository holds take precedence. A shipping request or repository requirement can extend delivery through release or deployment and consumer verification. Plan-only, diagnosis-only, review-only, local-only, and PR-only requests stop at the stated endpoint.

## Native work and delegation

Name the behavior to change, preserve unrelated work, and use the repository's existing checks. Delegate independent bounded subtasks to native children when useful.

Use the harness settings for native work. Use CE to assign bounded implementation to a different engine. [Work across harnesses](/what-it-does/work-across-harnesses/)

Report the engine that ran and any unavailable requested route.

## Select a workflow where it helps

Use CE planning, debugging, and code review for work that benefits from them. Choose LFG for a full workflow when the change warrants it. The default light review covers the complete cumulative change independently before the first push. Focus later reviews on repairs and affected behavior. Repeat broad review when design or risk changes materially or prior coverage is uncertain. Choose Thermos and full review for higher-risk changes.

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
2. **Route.** Choose native execution, a focused workflow, or explicit fleet placement.
3. **Build.** Execute natively or use a useful selected CE workflow.
4. **Review.** Complete one independent local review of the whole change before the first push. Review later repair batches and their affected behavior. Repeat broad review when design or risk changes materially or prior coverage is uncertain.
5. **Quality.** Run required repository checks and focused checks for the changed surface.
6. **Publish.** Use CE commit/push/PR for PR creation and user-requested PR pushes.
7. **Settle.** Let CE own feedback and CI. Batch repairs, resolve each thread, and link follow-up issues for separable work. After one shared automated repair batch, newly raised minor findings default to follow-up.
8. **Merge.** Follow the repository's merge process and wait for the queue to land the PR where configured.
9. **Prove.** Verify merge ancestry, complete required release or deployment, and check the actual consumer.
10. **Learn.** Capture a reusable lesson when useful or requested; no routine retrospective artifact is required.

Report the changed behavior, validation, and any remaining limitation. Task archival, worktree removal, and runtime cleanup are separate operations with their own authority.
