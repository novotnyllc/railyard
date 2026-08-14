---
layout: default
title: Lifecycle
parent: Delivery
nav_order: 1
---

# The delivery lifecycle

Treat delivery as one continuous promise: translate intent into a change, challenge it, merge it, and prove that the result reached the base branch and its consumer. A traceable sequence of routing, implementation, review, proof, and learning makes that promise repeatable for humans and agents alike.

## The run

The operator asks for a finished change, not an open-ended agent session. Railyard names the artifact boundary, binds the route, carries one coherent implementation through Thermos and settlement, then verifies the merged result. The turn is the gate that returns weak or stale evidence to the stage that owns it. The run closes when ancestry, a focused post-merge check, and the run record agree on the terminal outcome.

## 1. Intent intake

Begin by naming the finish line. A plan request should produce a plan, a diagnosis request should produce findings, and an implementation request should carry through the full delivery route. `railyard:deliver` turns that declared outcome into the artifact boundary.

## 2. Model routing

Route by the economics of the work: use the right model for the job, spend where hardness lives, and treat budget as an engineering constraint. Before a carrier starts, `railyard:model-routing` records the selected model, effort, adapter, transport, privacy, and budget effect.

```text
route=implementation model=gpt-5.6-luna effort=max
carrier=codex-luna transport=selector-native
implementationEngine=prefer/codex budget=default_route_no_state
```

The lifecycle stays same-harness by default. Dispatching to Codex is opt-in and requires the Codex CLI already set up separately.

## 3. Plan and implement

Give the change a bounded working boundary, plan the behavior, write the smallest useful implementation, and run the checks that can prove it. Independent work can run in isolated worktrees and converge into one integration branch.

## 4. Thermos review

Challenge each coherent chunk while its context is fresh. The correctness/security lens and the maintainability lens review the same frozen packet; synthesis returns one findings list to the implementation lane, which fixes real findings before the chunk moves forward.

```text
thermos correctness_findings=1 quality_findings=2
synthesis=deduplicated actionable=2
gate=fix-before-commit
```

## 5. Browser-visible quality

Match the quality gate to the surface users experience. For React, Next, JSX, TSX, or component work, the route runs the project-appropriate React Doctor command against the staged change. Docs-only work stays on its document checks.

## 6. Commit and publish

Publish a resumable state. The delivery owner creates the configured commit, pushes the working branch, and opens or updates the pull request when the repository workflow uses one. Checkpoint commits give another lane a precise handoff.

## 7. Review settlement

Earn merge authority from current evidence. The delivery tail settles CI, review threads, branch currency, and stack order, then follows the repository's configured merge strategy.

```text
head=4e1d... reviews=head-settled threads=0
settlement_window=passed merge_authority=allowed
```

## 8. Post-merge proof

Prove the merged result with an observable terminal pair:

```sh
git merge-base --is-ancestor <merge-commit> origin/<base>
<smallest applicable post-merge check>
```

The result reports both the merge ancestry and the check outcome.

```text
git merge-base --is-ancestor 4e1d... origin/main
exit=0
post_merge_check=node --test test/retry.test.mjs
exit=0
```

The post-merge check is stack-specific and comes from the repository's existing tooling. A Python service might use `pytest -q` instead of the Node example.

## 9. Durable learning

Close a substantial run by turning experience into operating leverage. A recap and retrospective capture the decision chain; reusable repo lessons can enter the compound workflow, while cross-repo routing lessons stay in the routing learning surface.

## One-line shape

Run the lifecycle as an observable chain from intent through routing, implementation, paired review, settlement, merge, post-merge proof, and durable learning. The [delivery lifecycle diagram](#diagram) makes the handoff order easy to scan.

<span id="diagram"></span>

![Delivery lifecycle from intent intake through routing, implementation, review, settlement, merge, proof, and durable learning.](/diagrams/m2-delivery-lifecycle.svg)

### Sequence

1. **Ask.** The operator turns a plain-language outcome into one bounded delivery request.
2. **Route.** Railyard freezes the model, effort, carrier, and transport for the work unit.
3. **Build.** The implementation lane plans and changes the repository.
4. **Review.** Thermos challenges the diff through correctness/security and code-quality lenses.
5. **Quality.** Browser-visible and focused quality checks establish evidence for the current head.
6. **Publish.** The lane commits and publishes the reviewable change.
7. **Settle.** Review threads and the merge-settlement condition become current; stale evidence returns to review.
8. **Merge.** The settled change earns merge authority and reaches the base branch.
9. **Prove.** Ancestry and the smallest applicable post-merge check prove arrival.
10. **Learn.** The run receipt preserves the route, decisions, and terminal outcome for the next run.

The diagram is also available as text above: findings return to implementation, and unresolved review threads return to the review gate.

Railyard supplies the load-bearing evidence: its [source repository](https://github.com/novotnyllc/railyard), [release record](https://github.com/novotnyllc/railyard/releases), and [review trail](https://github.com/novotnyllc/railyard/pulls) keep the delivery contract reviewable beside this guide.
