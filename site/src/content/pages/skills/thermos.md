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

## Scope

Thermos reviews and synthesizes. The implementation lane fixes findings, and the delivery owner decides the terminal merge state.

## Source

Ships in the `railyard` plugin. Source: `plugins/railyard/skills/thermos/SKILL.md`.

## Proof point

The Thermos source defines the two-lens packet, parallel dispatch, synthesis, and fix-before-commit gate.

Next: [read delivery gates](/delivery/gates/).
