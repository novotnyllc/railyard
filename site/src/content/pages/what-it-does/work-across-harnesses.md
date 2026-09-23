---
layout: default
title: Work across harnesses
parent: Practices
nav_order: 6
---

# Work across harnesses

A delivery begins in Claude Code, sends a bounded implementation unit to Codex, and brings the evidence back to one owning workflow. Freeze the route at each dispatch and record harness, model, effort, and transport. The request stays coherent across execution surfaces, and every handoff remains inspectable.

## Easy path

```text
> Route this work to the best available harness and show the dispatch decision.
```

`railyard:model-routing` helps choose model and effort together and resolve any configured provider or transport controls the requested handoff needs.

## Illustrative workflow

The operator asks one delivery to use an eligible execution surface for a bounded work unit. Choose model, effort, and supported transport deliberately, then return evidence to the same owning workflow. Cross-harness movement is an explicit opt-in seam. Report unsupported selections without silently changing model, effort, or provider.

## What happens

Native children are the default for internal subtasks. The optional strict resolver adds configured budget, privacy, provider, and adapter controls when the handoff needs them. Its selected route binds model and effort to a supported carrier and receipt.

## Session tier and delegated route are different

Choose the interactive session for the conversation and the delegated route for the bounded work unit. A model name without effort is incomplete.

GPT-6 Sol at `medium` is the baseline candidate for ordinary substantive engineering when the active surface exposes it. Use Luna at `low` or `medium` for bounded work and select Astra when the task needs its stronger judgment. Choose model and effort using current capabilities, constraints, and accepted task outcomes. Deterministic tools can handle mechanical work directly; there is no default cheap-model ladder.

Deliberate inheritance of both model and effort is valid when the active tool supports it. Current native Codex full-history forks inherit and reject overrides; changing either setting requires a supported limited-history or no-history fork with a sufficient brief. Check the actual tool schema before dispatch, and distinguish the intended selection from runtime metadata that verifies execution.

## Handoffs keep one owner

Claude Code reaches Codex models through the supported rescue forwarder or a direct `codex exec` worker. Codex reaches Claude subscription review through the maintained Compound Engineering `claude -p` adapter. Either harness reaches a ChatGPT Pro second opinion through the admitted Oracle route. A visible provider-owned task is available only when the user explicitly requests task creation; an unavailable transport does not authorize creating one as a fallback. Supported task handoffs retain their bounded contract and identity-bound receipt.

Resolve each handoff against the current policy and available carriers. When a saved route is stale, re-evaluate the assignment under those rules and prepare a current eligible route before dispatch.

## Subscription review keeps first-party custody

A supported Claude subscription review verifies Claude Code 2.1.220 or newer, `authMethod: claude.ai`, and `apiProvider: firstParty` before egress. It runs the routed model through the read-only Compound Engineering adapter, validates the raw stream and observed model, and returns review evidence to the owning delivery. That positive attestation is what lets a subscription review cross harnesses without turning ambient environment settings into routing authority.

## Proof point

The [Model routing reference](/delivery/model-routing/) covers deliberate native allocation and the optional `railyard/model-routing/v1` contract for configured controls. Record the intended model and effort or supported inheritance; use runtime metadata for the observed pair when available, otherwise label it unverified. [Own your routing policy](/delivery/model-routing/policy/) describes provider eligibility and transport constraints.

## Next

[Control model cost](/what-it-does/control-model-cost/) or [read model-routing details](/delivery/model-routing/).
