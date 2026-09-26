---
layout: default
title: Thermos
parent: Skills
nav_order: 4
---

# Thermos

Thermos is an optional review skill for a change that benefits from two practitioner lenses. It reviews a diff and synthesizes one actionable findings packet for the existing review owner.

## What it adds

Thermos runs this paired review. Its correctness lens covers breakage, security, developer experience, and feature-leak risk. Its code-quality lens covers structure, duplication, complexity, and maintainability.

## How it works

Both lenses receive the same diff, source context, and requirement. They run in parallel as native subagents when the harness supports it, each with a deliberately chosen model and effort; synthesis deduplicates findings for the existing workflow owner. When used in Compound Engineering (CE) delivery, the implementation lane fixes accepted findings through its existing review loop.

Illustrative review outline:

```text
> Run the two Thermos lenses on this diff and return one deduplicated findings packet.
packet=<diff and source context>
lenses=correctness,code-quality
output=deduplicated findings with evidence
owner=existing-workflow
```

## Scope

Thermos reviews and synthesizes. When CE owns delivery, it retains review settlement and CI/PR monitoring, and the delivery owner continues to the authorized endpoint. Selecting Thermos does not add a second watcher or a mandatory pre-commit gate.

## Use one lens deliberately

Invoke `railyard:thermo-nuclear-review` alone when the bounded question is whether a change breaks behavior, weakens security, leaks scope, or harms developer experience. Invoke `railyard:thermo-nuclear-code-quality-review` alone when the bounded question is structure, duplication, complexity, or maintainability. Both return review findings only; Thermos remains the skill that runs and synthesizes the pair.

## Source

Ships in the `railyard` plugin.

## Proof point

The findings packet identifies the reviewed diff, affected source, and actionable evidence. The existing owner records the disposition of accepted findings and the checks needed after fixes.
