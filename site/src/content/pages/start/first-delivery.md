---
layout: default
title: First delivery
parent: Start here
nav_order: 2
---

# First delivery

Prerequisite: [install Railyard first →](/start/install/). Add Roundhouse when you explicitly request fleet placement.

For authorized repository work, plain implementation, fix, and open-PR requests run through confirmed merge and any required release or deployment and verification of the actual consumer. Required approvals and repository holds take precedence. Say “PR only” or “no merge” to stop at publication. If access blocks a step, Deliver reports the blocker and continues authorized work that can proceed independently.

## Easy path

```text
> Fix the retry path in the webhook worker.
```

This request names the outcome. Railyard loads Deliver from the implementation intent. Routine work can run natively within Deliver, which coordinates the useful Compound Engineering (CE) stages and owns the delivery boundary.

## What happens

1. Use native tools for routine work and select CE stages when they help. Resolve CE only when a selected stage needs it.
2. Use native children for independent work. Use [CE cross-engine work](/what-it-does/work-across-harnesses/) for a requested external implementer. Create a visible task when the user explicitly requests one.
3. Run repository checks and one independent [local review](/delivery/gates/) of the complete cumulative change before the first push. Fix actionable findings before publishing.
4. Use `compound-engineering:ce-commit-push-pr` to publish. CE owns feedback and CI. Batch repairs and review each batch and its affected behavior before pushing again. Repeat broad review when design or risk changes materially or prior coverage is uncertain.
5. Follow the configured merge queue, if any, and verify the PR landed. Complete applicable release or deployment steps and verify the actual consumer. For plugins, this includes required marketplace publication, a supported manager update, and installed-runtime verification.

Illustrative evidence fields for a native Codex run; fill them from actual observations:

```text
implementation=<observed engine>
observed_allocation=<runtime evidence or unverified>
review_and_ci=<CE disposition>
merge=<observed merge commit> ancestry=<check result>
post_merge_check=<focused command and result>
release_or_deployment=<observed result when required>
consumer_check=<installed or deployed behavior>
```

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

- [Thermos](/skills/thermos/) — the optional paired review that contributes findings to the CE owner before publication.
- [React Doctor](/delivery/gates/) — the project-appropriate browser-visible quality check for React surfaces.
