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

Deliver passes CE the [review feedback settlement policy](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/references/review-feedback-settlement.md) as a project settlement requirement. Batch comments into one repair push when practical. Reply to each thread with the fix, a brief reason to decline, or a link to an issue for actionable work that can ship separately, then resolve it. After one shared automated repair batch, newly raised minor findings default to follow-up issues. A real blocker still needs resolution. A finding that needs a decision beyond the agent’s authority stays open until the user answers.

## Local review before publication

The default `light` level runs repository checks and one independent review of the complete cumulative change before the first push. Reuse a completed independent CE review when it covers the same candidate and scope. Include Ponytail’s simplicity and load questions in that round when installed. Fix serious and medium defects and verify those fixes once. Optional PR reviewers can skip or exhaust quota without delaying an eligible merge. For later repair pushes, review the repair and its affected behavior. Repeat broad review when design or risk changes materially or the original coverage is uncertain. Routine review needs neither a formal receipt nor a ledger. [Pre-push review policy](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/references/whole-candidate-review.md)

## Specialist review

Select `railyard:config review full` for whole-candidate review and a formal receipt on every push. Use `railyard:config review checks` for repository checks alone where project policy allows.

Thermos runs two lenses against that same complete candidate:

- `thermo-nuclear-review`: correctness, security, breakage, developer experience, and feature-leak risk.
- `thermo-nuclear-code-quality-review`: structure, duplication, maintainability, and complexity.

At the `full` level, run both lenses alongside `codex review` using its configured settings before publication. Reuse their completed evidence at settlement only while candidate identity, inputs and coverage still match. Standalone reviews can use a narrower pair or single lens, but they do not satisfy the publication gate. Findings return to the implementation owner and existing CE loop. When full review is selected, apply the whole-candidate gate before each push. CE owns review and CI settlement.

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

## Merge after review and CI

Once CE settles the current PR, check the repository's merge requirements
and confirm the head still matches the reviewed commit. Follow the configured
queue where present. For a direct GitHub merge, use the repository's merge
strategy and pin the reviewed SHA with the GitHub CLI's
`--match-head-commit` option. Verify that the PR merged. For a PR-only
endpoint, preserve its draft status or effective merge hold.

Configure requirements such as approvals, status checks, review-thread
resolution, and default-branch push restrictions in the repository host.
Railyard's startup hook provides delivery guidance.

## Post-merge proof

When merge is authorized, verify the reported merge commit is reachable from the fetched base branch and run or verify the focused check for the merged result. If the user requested a live deployment, verify the live surface as well.

```text
merge=<reported-merge-commit> ancestry=verified
post_merge_check=<repository-check> exit=0
```

This is an illustrative receipt shape, not evidence of a live run.
