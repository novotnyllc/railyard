---
layout: default
title: Thermos
parent: Skills
nav_order: 4
---

# Thermos

Thermos is Railyard's recommended end-of-PR review, run in parallel with `codex review` on GPT-6 Astra at high effort. It gathers the diff without guessing, runs both reviewers, and synthesizes one actionable findings packet for the existing review owner.

## What it adds

Thermos runs a paired review, each rubric carried over from upstream verbatim: a security/correctness rubric with an added failure-memory lens (a wrong, durable conclusion drawn from a handled failure), and a strict maintainability rubric for structure, duplication, complexity, and file-size growth.

## How it works

Thermos gathers the diff and any needed context itself rather than asking a reviewer to guess it, and passes each reviewer the identical scoped diff in a self-contained brief — a fresh reviewer has none of the calling conversation's history. The two reviewers launch together and run concurrently, and Thermos collects their results directly (foreground calls in Claude Code, spawn then wait in Codex), each with a model and reasoning effort chosen through `railyard:model-routing`. When a change ships a runtime artifact, reviewers validate the actual delivery/packaging path rather than accepting a formal receipt at face value. An opt-in frozen review packet (deterministic diff/file digests plus reusable validation results) is available when the caller asks for one. Synthesis deduplicates findings across reviewers and weights overlapping findings more heavily. When used in Compound Engineering (CE) delivery, the implementation lane fixes accepted findings through its existing review loop.

Illustrative review outline:

```text
> Run the two Thermos lenses on this diff and return one deduplicated findings packet.
packet=<diff and source context, gathered not guessed>
lenses=correctness+failure-memory,maintainability
model=<chosen via model-routing per reviewer>
output=deduplicated, weighted findings with evidence
owner=existing-workflow
```

The [review bakeoff](/delivery/review-bakeoff/) explains why Railyard's end-of-PR review pairs Thermos with `codex review`.

## Scope

Thermos reviews and synthesizes. When CE owns delivery, it retains review settlement and CI/PR monitoring, and the delivery owner continues to the authorized endpoint. Selecting Thermos does not add a second watcher or a mandatory pre-commit gate.

## Use one lens deliberately

Invoke `railyard:thermo-nuclear-review` alone when the bounded question is whether a change breaks behavior, weakens security, leaks scope, or harms developer experience. Invoke `railyard:thermo-nuclear-code-quality-review` alone when the bounded question is structure, duplication, complexity, or maintainability. Both return review findings only; Thermos remains the skill that runs and synthesizes the pair.

## Source

Ships in the `railyard` plugin.

## Proof point

The findings packet identifies the reviewed diff, affected source, and actionable evidence. The existing owner records the disposition of accepted findings and the checks needed after fixes.
