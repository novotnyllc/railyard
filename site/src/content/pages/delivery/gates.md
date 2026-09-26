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

## Optional specialist review

Thermos runs two lenses against the same bounded packet:

- `thermo-nuclear-review`: correctness, security, breakage, developer experience, and feature-leak risk.
- `thermo-nuclear-code-quality-review`: structure, duplication, maintainability, and complexity.

Choose the pair or a single lens when it adds a useful perspective. Findings return to the implementation owner and the existing CE review loop. [Oracle](/skills/oracle/) is another optional advisor for a second-model opinion. None of these is a blanket pre-commit requirement.

The following is an example with Thermos explicitly selected. Its final review step checks existing evidence; it does not automatically dispatch another reviewer.

![A selected Thermos review feeds findings into one CE settlement loop before an authorized merge and post-merge proof.](/diagrams/m6-review-gates.svg)

### Sequence

1. **Ready.** Prepare a bounded diff and the evidence the selected review needs.
2. **Gates.** Keep required and relevant checks tied to the current implementation.
3. **Thermos.** Run the selected correctness/security and quality lenses against the same packet.
4. **Return.** Synthesize actionable findings and send fixes to the implementation owner.
5. **Settle.** Let CE own feedback resolution, review settlement, and CI.
6. **Review.** Confirm the current evidence satisfies the repository's requirements.
7. **Merge.** Merge only within the user's authorized scope.
8. **Prove.** Verify the merged state and the applicable post-merge result.

## UI checks

Use the project's existing browser and accessibility checks for the changed surface. React Doctor remains available when its analysis is useful for React work. Resolve its current invocation when selecting it; installing or running an additional scanner is not a universal docs, backend, or UI prerequisite.

## Dispatch check

A narrow dispatch hook checks native subagent model and effort arguments against the controls the harness supports. Omitting the model means the child inherits. A full-history Codex fork cannot carry model or effort overrides; use a limited-history or no-history fork to change either. Unsupported selections are disclosed; a passing hook test doesn't show that the live harness ran the selection.

<span id="merge-settlement"></span>

## CE merge guard

The merge guard consumes the completed CE owner's final snapshot, checks that it matches CE's latest state, and verifies the current PR head and base before a recognized `gh` merge. Only one hook process runs for each shell call, so the check stays cheap. Missing or stale evidence refuses the merge with a recovery message. CE remains the sole review and CI owner; the guard has no reviewer wait timers or separate watcher.

Deliver supplies the [CE snapshot handoff](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/skills/deliver/references/ce-merge-guard.md). It requires recent evidence and an explicit head match, and covers the documented shell route rather than arbitrary API clients. The [implementation](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.js) and [tests](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.test.mjs) define its checks. Broad prompt nudges and automatic retrospective hooks are retired; cleanup remains manual.

## Post-merge proof

When merge is authorized, verify the reported merge commit is reachable from the fetched base branch and run or verify the focused check for the merged result. If the user requested a live deployment, verify the live surface as well.

```text
merge=<reported-merge-commit> ancestry=verified
post_merge_check=<repository-check> exit=0
```

This is an illustrative receipt shape, not evidence of a live run.
