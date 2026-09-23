---
layout: default
title: Model routing
parent: Skills
nav_order: 3
---

# Model routing

Choose model and reasoning effort together for each delegated assignment. GPT-6 Sol at `medium` is the ordinary Codex engineering candidate; Luna can handle bounded work, and Astra at `high` fits work needing stronger judgment. Use task evidence, constraints, and accepted outcomes to choose another supported pair. Mechanical work can use deterministic tools directly.

In Claude Code, consider Fable 5.1 with a deliberately chosen effort. Its exact model ID is `claude-fable-5-1`, supported by Claude Code 2.1.257 or later. The CLI supports `low`, `medium`, `high`, `xhigh`, and `max` for this model. Native `Agent` calls use the `fable` alias and inherited effort, or an explicitly configured subagent definition for an exact model and effort; a moving alias does not guarantee a model version. Unsupported selections and runtime substitutions must be reported.

## What it adds

Model routing supports lean native allocation and an optional strict resolver for configured fleet, budget, privacy, provider, or adapter controls. Routine work does not require a routing CLI, contract, or receipt ceremony.

## How it works

For native delegation, check the active tool's model selectors, effort values, and history constraints. Request the chosen pair or deliberately inherit both settings through a supported history mode. Use native children; create a visible task only when the user explicitly requests one. If a requested selection is unsupported, disclose the incompatibility instead of silently substituting a route.

With `TYPESAFE_API_KEY` present, [Jev](/skills/jev/) selects among eligible
model-and-effort pairs by default. The caller supplies available candidates
and evidence, then applies the usual allocation checks before dispatch. Explicit
choices, fixed roles, and privacy restrictions remain authoritative. Missing
or uncertain advice leaves normal routing in charge.

For configured controls, the strict route lifecycle retains `resolve`, `admit`, dispatch claim, and receipt reconciliation. Work contracts can bind objective, source of truth, scope, constraints, authorization, acceptance, and stop condition through seven SHA-256 semantic digests.

When that configured path needs `build-work-contract`, it produces a carrier-neutral invariant and a source-owned presentation overlay. Switching among supported GPT, Claude, GLM, or Oracle routes can change briefing form without changing scope or authority; `invariantDigest` detects semantic mutation before dispatch.

Illustrative native allocation brief:

```text
assignment=bounded-engineering
modelAlias=codex-6-sol model=gpt-6-sol effort=medium
reason=ordinary-engineering-candidate
history=<compatible mode from the active tool>
```

## Scope

The selected workflow or carrier performs the work. Model allocation preserves CE's ownership of review settlement and CI/PR monitoring. Cross-harness and Oracle routes retain their supported adapters and accounting; a catalog entry alone does not prove availability.

## Source

Ships in the `railyard` plugin.

## Proof point

Dispatch arguments document the intended selection. Use runtime metadata for the observed model and effort when available; otherwise label them unverified. Judge efficiency from accepted results and total assignment cost and time, including children, retries, and repairs. No model tier is a universal winner.

Go deeper: [roles, tiers, and carriers](/delivery/model-routing/).
