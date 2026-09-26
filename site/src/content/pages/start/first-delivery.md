---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Prerequisite: [install Railyard first →](/start/install/). Add Roundhouse when you explicitly request fleet placement.

Start with a real change and carry it to observable proof. When required access is available, an explicit Deliver request works through review, merge, required release or deployment, and verification of the actual consumer on the intended machine. If access blocks a step, Deliver reports the blocker and continues authorized work that can proceed independently.

## Easy path

```text
> Use Deliver to fix the retry path in the webhook worker.
```

This request names the outcome. Routine implementation runs natively; `railyard:deliver` can coordinate the useful Compound Engineering (CE) stages and the requested delivery boundary.

## What happens

1. Use native tools for routine work and automatically select CE stages when they help. Resolve CE only when a selected stage needs it.
2. For delegated work, choose model and reasoning effort together: Opus 5.5 at `medium` in Claude Code, GPT-6 Sol at `medium` in Codex, escalating to Fable 5.1 or Astra for harder work. Omitting the model means the child inherits. Use native children unless the user explicitly requests a visible task.
3. Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR.
4. CE owns the review settlement and CI loop. Optional specialist reviews, including [Thermos](/skills/thermos/), feed findings to that owner before the authorized merge.
5. Check the merged commit for reachability from the base branch, complete required release or deployment steps, and verify the actual consumer. For plugins, this includes required marketplace publication, a supported manager update, and installed-runtime verification.

Illustrative evidence fields for a native Codex run; fill them from actual observations:

```text
model=gpt-6-sol effort=medium
observed_allocation=<runtime evidence or unverified>
review_and_ci=<CE disposition>
merge=<observed merge commit> ancestry=<check result>
post_merge_check=<focused command and result>
release_or_deployment=<observed result when required>
consumer_check=<installed or deployed behavior>
```

Same-harness execution is the default. Crossing from another harness to Codex is opt-in and requires a separately configured Codex CLI.

The post-merge check is stack-specific and comes from the repository's existing tooling, such as `node --test test/retry.test.mjs` or `pytest -q`.

## Proof point

The [delivery lifecycle](/delivery/lifecycle/) requires merge ancestry and a real post-merge check, followed by applicable release or deployment and consumer verification. Explicit narrower requests retain their stated endpoints.

## Scope

The first delivery is a complete one-machine path. Request fleet placement explicitly when another host is needed through [run work on another machine](/what-it-does/run-work-on-another-machine/).

## Troubleshooting

- **A skill is not found:** return to [Install](/start/install/) and confirm the plugin listing before restarting the harness.
- **The repository has no GitHub remote:** add or verify `origin` before asking for a pull request; a local delivery can still run checks and report the missing publish step.
- **The repository has no test suite:** the post-merge check uses the smallest existing verification command, or reports that no focused check is available.
- **The review gate is stuck:** inspect [delivery gates](/delivery/gates/) for unresolved threads, settlement timing, or a missing post-merge proof.

## Terms used here

- [Model routing](/delivery/model-routing/) — choosing the model and reasoning effort for delegated work.
- [Thermos](/skills/thermos/) — an optional paired review that contributes findings to the CE owner.
- [React Doctor](/delivery/gates/) — the project-appropriate browser-visible quality check for React surfaces.
