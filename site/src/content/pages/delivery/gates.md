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

Choose the pair or a single lens when it adds a useful perspective. Findings return to the implementation owner and the existing CE review loop. Oracle is another optional advisor when its current transport and authentication evidence support the selected route. None of these is a blanket pre-commit requirement.

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

## Dispatch enforcement

The narrow dispatch gate checks deliberate model and reasoning-effort allocation against supported native controls. Explicit suitable inheritance is allowed. A full-history native fork cannot carry model or effort overrides; use a supported limited-history or no-history fork when changing either. Fixed specialist roles use their authoritative settings.

Unsupported or unavailable selections are disclosed. An offline resolver or gate test is not evidence that the live harness emits the expected hook event or can run a selected adapter.

<span id="merge-settlement"></span>

## Optional merge guard

The merge-settlement hook remains an opt-in backstop for a workflow that needs it. It checks unresolved threads and review signals on the current head; it does not own a second review or CI watch loop. A degraded or incomplete check is reported as such, never treated as proof of settled review.

The [merge-settlement implementation](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.js) and [tests](https://github.com/novotnyllc/railyard/blob/main/plugins/railyard/hooks/merge-settlement-gate.test.mjs) document that optional guard.

## Post-merge proof

When merge is authorized, verify the reported merge commit is reachable from the fetched base branch and run or verify the focused check for the merged result. If the user requested a live deployment, verify the live surface as well.

```text
merge=<reported-merge-commit> ancestry=verified
post_merge_check=<repository-check> exit=0
```

This is an illustrative receipt shape, not evidence of a live run.
