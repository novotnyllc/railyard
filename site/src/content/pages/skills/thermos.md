---
layout: default
title: Thermos
parent: Skills
nav_order: 4
---

# Thermos

Thermos is a review skill invoked during delivery. It reviews a frozen change through two distinct practitioner lenses, then synthesizes one actionable packet before commit. Correctness gets the same serious attention as code health, and the implementation lane receives a clear gate it can settle.

## What it adds

Thermos runs this paired review. Its correctness lens covers breakage, security, developer experience, and feature-leak risk. Its code-quality lens covers structure, duplication, complexity, and maintainability.

## How it works

Both lenses receive the same frozen diff, source context, and requirement. They run in parallel when the carrier supports it; synthesis deduplicates findings, and the implementation lane fixes real findings before the chunk continues.

```text
> Run the two Thermos lenses on this frozen diff and return one deduplicated findings packet.
correctness=started  quality=started  packet=sha256:7c1a...
correctness_findings=1  quality_findings=2
synthesis=deduplicated actionable=2
gate=fix-before-commit
```

## Scope

Thermos reviews and synthesizes. The implementation lane fixes findings, and the delivery owner decides the terminal merge state.

## Use one lens deliberately

Invoke `railyard:thermo-nuclear-review` alone when the bounded question is whether a change breaks behavior, weakens security, leaks scope, or harms developer experience. Invoke `railyard:thermo-nuclear-code-quality-review` alone when the bounded question is structure, duplication, complexity, or maintainability. Both return review findings only; Thermos remains the skill that runs and synthesizes the pair.

## Source

Ships in the `railyard` plugin.

## Proof point

```text
packet=sha256:7c1a... findings=2
fixes=2 checks_rerun=2
review=thermos-synthesis result=pass
```
