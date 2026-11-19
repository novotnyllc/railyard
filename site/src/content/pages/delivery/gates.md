---
layout: default
title: Gates
parent: Delivery
nav_order: 3
---

# Delivery gates

Use verification that can reveal a meaningful failure in the change. Repository requirements remain authoritative. A docs edit may need links and a build; a behavior change needs checks for that behavior; a UI change may need browser verification. Repeat checks for relevant changes, failures, or unresolved concerns.

## One review and CI owner

When a CE workflow is selected, it owns review settlement, feedback resolution, CI, and the watch loop. Use `ce-commit-push-pr` for PR creation and user-requested commits pushed to an existing PR. Railyard preserves the requested completion boundary and checks the returned evidence without adding a second watcher.

Unresolved feedback and stale checks must be handled before an authorized merge. A local check passing does not settle a PR, and a green PR does not establish post-merge or deployment success.

### Settling review feedback

Deliver passes CE the [review feedback settlement policy](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/references/review-feedback-settlement.md) as a project settlement requirement. Batch comments into one repair push when practical. Reply to each thread with the fix, a brief reason to decline, or a link to an issue for actionable work that can ship separately, then resolve it. After automated review has covered two distinct PR heads, newly raised minor findings default to follow-up issues. A real blocker still needs resolution. A finding that needs a decision beyond the agent’s authority stays open until the user answers.

## Local review before publication

The default `light` level runs repository checks and one independent review of the complete cumulative change before the first push. Check correctness, regressions, and maintainability. For later repair pushes, review the repair and its affected behavior. Repeat broad review when design or risk changes materially or the original coverage is uncertain. Routine review needs neither a formal receipt nor a ledger. [Pre-push review policy](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/references/whole-candidate-review.md)

## Specialist review

Select `railyard:config review full` for whole-candidate review and a formal receipt on every push. Use `railyard:config review checks` for repository checks alone where project policy allows.

Thermos runs two lenses against that same complete candidate:

- `thermo-nuclear-review`: correctness, security, breakage, developer experience, and feature-leak risk.
- `thermo-nuclear-code-quality-review`: structure, duplication, maintainability, and complexity.

At the `full` level, run both lenses alongside `codex review` using its configured settings before publication. Reuse their completed evidence at settlement only while candidate identity, inputs and coverage still match. Standalone reviews can use a narrower pair or single lens, but they do not satisfy the publication gate. Findings return to the implementation owner and existing CE loop; [Oracle](/skills/oracle/) remains an optional advisor. The whole-candidate gate governs pushing, not every local commit; CE separately owns merge settlement.

This sequence shows the optional `full` level. CE uses the completed whole-candidate receipt before each push and checks current evidence before merging.

![A selected Thermos review feeds findings into one CE settlement loop before an authorized merge and post-merge proof.](/diagrams/m6-review-gates.svg)

### Sequence

1. **Ready.** Freeze the complete cumulative candidate and its relevant lifecycle evidence.
2. **Gates.** Keep required and relevant checks tied to the current implementation.
3. **Thermos.** Run both correctness/security and quality lenses alongside Codex review against the same complete candidate.
4. **Return.** Synthesize actionable findings and send fixes to the implementation owner.
5. **Settle.** Bind the review receipt before CE publishes; let CE own feedback resolution, review settlement and CI. Revalidate the complete candidate before each repair push.
6. **Review.** Confirm the current evidence satisfies the repository's requirements.
7. **Merge.** Follow the repository's merge process and confirm the PR lands when merge is in scope.
8. **Prove.** Verify the merged state and the applicable post-merge result.

## UI checks

Use the project's existing browser and accessibility checks for the changed surface. React Doctor remains available when its analysis is useful for React work. Resolve its current invocation when selecting it; installing or running an additional scanner is not a universal docs, backend, or UI prerequisite.

<span id="merge-settlement"></span>

## Merge guard

Before a recognized `gh` merge, the merge guard checks one of two things. Without a CE snapshot, it requires the merge to be one literal command, reads the PR once from GitHub, and allows the merge when it is open, not a draft, `mergeStateStatus` `CLEAN`, and has no unresolved review threads; otherwise it refuses with the reason. On a base branch that requires a merge queue, either path allows the same ready PR to be enqueued with one literal `gh pr merge` pinned by `--match-head-commit`, because the queue re-runs the required checks against the latest base before it merges. There, `--admin`, REST merges and unpinned enqueues refuse. `--auto` and raw GraphQL merge, enqueue or auto-merge mutations refuse on every base. With a snapshot, it consumes the completed CE owner's final snapshot, checks that it matches CE's latest state, and verifies the current PR head and base. Only one hook process runs for each shell call, so the check stays cheap. Stale evidence or an unreadable GitHub answer refuses the merge with a recovery message. CE remains the sole review and CI owner; the guard has no reviewer wait timers or separate watcher.

Deliver's [merge guard reference](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/skills/deliver/references/ce-merge-guard.md) documents both paths; the snapshot path requires recent evidence and an explicit head match. The guard covers the documented shell route rather than arbitrary API clients. The [implementation](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.js) and [tests](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.test.mjs) define its checks. Broad prompt nudges and automatic retrospective hooks are retired; cleanup remains manual.

## Post-merge proof

When merge is authorized, verify the reported merge commit is reachable from the fetched base branch and run or verify the focused check for the merged result. If the user requested a live deployment, verify the live surface as well.

```text
merge=<reported-merge-commit> ancestry=verified
post_merge_check=<repository-check> exit=0
```

This is an illustrative receipt shape, not evidence of a live run.
