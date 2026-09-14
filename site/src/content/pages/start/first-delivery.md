---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Prerequisite: [install Railyard first →](/start/install/). Add Roundhouse when you explicitly request fleet placement.

Start with a real change and carry it to observable proof. One sentence on the machine you already use can produce a reviewed, merged result plus a post-merge receipt, giving you a complete delivery loop before you add fleet complexity.

## Easy path

```text
> Fix the retry path in the webhook worker and get it merged.
```

This request names the outcome. Routine implementation runs natively; `railyard:deliver` can coordinate the useful Compound Engineering (CE) stages and the requested delivery boundary.

## What happens

1. Use native tools for routine work and automatically select CE stages when they help. Resolve CE only when a selected stage needs it.
2. For delegated work, choose model and reasoning effort together. Astra Max is the baseline candidate for substantive engineering; deliberate inheritance is supported. Use native children unless the user explicitly requests a visible task.
3. Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR.
4. CE owns the review settlement and CI loop. Optional specialist reviews, including [Thermos](/skills/thermos/), feed findings to that owner before the authorized merge.
5. The merged commit is checked for reachability from the base branch and the smallest applicable post-merge check runs.

Illustrative evidence fields for a native Codex run; fill them from actual observations:

```text
allocation=codex-astra model=gpt-6-astra effort=max
observed_allocation=<runtime evidence or unverified>
review_and_ci=<CE disposition>
merge=<observed merge commit> ancestry=<check result>
post_merge_check=<focused command and result>
```

Same-harness execution is the default. Crossing from another harness to Codex is opt-in and requires a separately configured Codex CLI.

The post-merge check is stack-specific and comes from the repository's existing tooling, such as `node --test test/retry.test.mjs` or `pytest -q`.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) documents the observable terminal pair: `git merge-base --is-ancestor <merge-commit> origin/<base>` plus a real post-merge check.

## Scope

The first delivery is a complete one-machine path. Request fleet placement explicitly when another host is needed through [run work on another machine](/what-it-does/run-work-on-another-machine/).

## Troubleshooting

- **A skill is not found:** return to [Install](/start/install/) and confirm the plugin listing before restarting the harness.
- **The repository has no GitHub remote:** add or verify `origin` before asking for a pull request; a local delivery can still run checks and report the missing publish step.
- **The repository has no test suite:** the post-merge check uses the smallest existing verification command, or reports that no focused check is available.
- **The review gate is stuck:** inspect [delivery gates](/delivery/gates/) for unresolved threads, settlement timing, or a missing post-merge proof.

## Terms used here

- [Carrier](/delivery/model-routing/) — the harness or worker surface that executes a routed unit.
- [Transport](/delivery/model-routing/) — the explicit path used to reach the selected execution surface.
- [Adapter](/delivery/model-routing/) — the bridge that turns the route decision into a harness invocation.
- [Work class](/delivery/model-routing/) — the role that determines the route and evidence required.
- [Budget](/what-it-does/control-model-cost/) — the spend constraint recorded with the dispatch.
- [Thermos](/skills/thermos/) — an optional paired review that contributes findings to the CE owner.
- [React Doctor](/delivery/gates/) — the project-appropriate browser-visible quality check for React surfaces.
