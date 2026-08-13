---
layout: default
title: Thermos
parent: Skills
nav_order: 4
---

# Thermos

Thermos gives a change two focused review lenses and one synthesized findings packet before it moves to commit.

## What it adds

The correctness lens covers breakage, security, developer experience, and feature-leak risk. The code-quality lens covers structure, duplication, complexity, and maintainability.

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

## Source

Ships in the `railyard` plugin.

## Proof point

```text
packet=sha256:7c1a... findings=2
fixes=2 checks_rerun=2
review=thermos-synthesis result=pass
```

Next: [read delivery gates](/delivery/gates/).
