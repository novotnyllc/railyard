---
layout: default
title: Deliver
parent: Skills
nav_order: 1
---

# Deliver

For authorized repository work, plain implementation, fix, and open-PR requests run through review, CI, confirmed merge, and any required release or deployment and consumer verification. Required approvals and repository holds take precedence. Plan-only, diagnosis-only, review-only, local-only, PR-only, and no-merge requests stop at their stated endpoint. Routine edits and verification run natively. For configuration and settings, verify the value where it is consumed, such as the config file, a CLI readback, or a model list.

## What it adds

Deliver owns the requested endpoint and uses Compound Engineering (CE) stages when they help. CE owns review settlement and CI/PR monitoring; Deliver continues its settled result to the authorized terminal boundary.

## How it works

Choose the stages that fit the work. Use `compound-engineering:ce-commit-push-pr` when creating a PR or pushing user-requested commits to an existing PR.

The default `light` review runs repository checks and one independent local review of the complete change before the first push. Review later repairs and their affected behavior, repeating broad review when design or risk changes materially or prior coverage is uncertain. Full review with Thermos and a formal receipt is opt-in. [Local review policy](/delivery/gates/)

Let CE batch feedback and own the watch loop. Fix blockers, explain declines, and link issues for actionable work that can ship separately. After one shared automated repair batch, newly raised minor findings default to follow-up. Use the configured queue where applicable and verify the PR has merged.

Use native children for ordinary subtasks and CE for explicit cross-engine implementation. Create a visible task when the user explicitly requests one.

Illustrative delivery outline:

```text
> Use Deliver to fix the retry path in the webhook worker through consumer verification.
scope=bounded-change  review_and_ci=CE
tail=CE-disposition -> merge -> required-release/deployment -> consumer-check
stop=report observed delivery state and verification
```

## Scope

One software change or PR belongs here. Routine and local-only work stay local. Deliver invokes [Orchestrate](/skills/orchestrate/) when authorized fleet placement could help a stage.

## Source

Ships in the `railyard` plugin.

## Proof point

Record the observed PR and merge commit, verify reachability from the intended base, and complete required release or deployment steps. For a plugin, that includes required marketplace pins, a supported manager update, and installed-runtime verification. Report the checks and evidence at the requested endpoint.
