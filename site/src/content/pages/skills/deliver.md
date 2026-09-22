---
layout: default
title: Deliver
parent: Skills
nav_order: 1
---

# Deliver

An explicit Deliver request for an implementation or fix runs through commit, push, PR, review and CI settlement, merge, required release or deployment, and consumer verification. Explicit plan-only, diagnosis-only, review-only, local-only, or PR-only requests retain their narrower endpoints. Routine edits and verification run natively; internal skill selection does not expand user authorization.

## What it adds

Deliver coordinates useful Compound Engineering (CE) stages and the requested endpoint. Automatically select a CE stage when it helps, resolving the dependency when that stage is needed. CE owns review settlement and CI/PR monitoring; Deliver continues its settled result to the authorized terminal boundary.

## How it works

Choose the stages that fit the work: planning, diagnosis, structured implementation, review, or shipping. Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR. Optional Thermos findings feed the same CE review owner.

When `TYPESAFE_API_KEY` is present, [Jev](/skills/jev/) is the default for model
and effort selection, workflow choice, evidence selection, work priority, and
review triage throughout delivery. Explicit choices and privacy restrictions
take precedence; uncertainty or service failure falls back to ordinary judgment.

For delegation, choose model and reasoning effort together. Astra Max is the baseline candidate for substantive engineering; another supported pair or deliberate inheritance can fit the assignment. Native children handle ordinary subtasks, and visible tasks require an explicit user request.

Illustrative delivery outline:

```text
> Fix the retry path in the webhook worker and get it merged with post-merge proof.
allocation=codex-astra  model=gpt-6-astra  effort=max
scope=bounded-change  review_and_ci=CE
tail=CE-disposition -> merge -> required-release/deployment -> consumer-check
stop=report observed delivery state and verification
```

## Scope

One software change or PR belongs here. Routine parallel work uses native children; explicitly requested fleet/account allocation or a delegated remote agent belongs to [Orchestrate](/skills/orchestrate/). Contracts, retrospectives, and cleanup are available on demand.

## Source

Ships in the `railyard` plugin.

## Proof point

Record the observed PR and merge commit, verify reachability from the intended base, and complete required release or deployment steps. For a plugin, that includes required marketplace pins, a supported manager update, and installed-runtime verification. A local pass, open PR, merge, and deployed result prove different boundaries; an intermediate result does not finish an explicit Deliver request.
