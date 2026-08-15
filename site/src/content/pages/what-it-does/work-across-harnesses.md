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

`railyard:model-routing` resolves the work class before the workflow starts.

## The run

The operator asks one delivery to use the execution surface that fits each bounded work unit. Railyard classifies the work before dispatch, freezes harness, model, effort, carrier, and transport, and returns evidence to the same owning delivery. The turn is the explicit seam: crossing harnesses is a recorded route decision rather than an invisible handoff. The run closes when the route receipt and the owning delivery receipt preserve the same outcome across both surfaces.

## What happens

The router derives a bounded work class from ambiguity, novelty, repetition, decomposability, volume, semantic risk, and verification strength. A selected route freezes model and effort; cross-harness movement is an explicit opt-in seam with its own carrier and receipt.

## Session tier and delegated route are different

Choose the interactive session for the conversation and the delegated route for the bounded work unit. A model name without effort is incomplete.

| Work tier | Codex session | Claude Code session |
| --- | --- | --- |
| Hard implementation | Sol `max` | Fable `high` or `max` |
| Medium or long-running implementation | Terra `max` | Sonnet `medium` |
| Mechanical implementation | Luna `max` | Haiku `low` |
| Delegated implementation default | Luna `max` | The same router-owned Luna route |

Orchestration and independent review use Sol `high`, with `max` reserved for high, critical, or explicitly complex work. A premium session hands a mechanical unit to the routed worker tier instead of silently inheriting its own model.

## Handoffs keep one owner

Claude Code reaches Codex models through the supported rescue forwarder or a direct `codex exec` worker. Codex reaches Claude subscription review through the maintained Compound Engineering `claude -p` adapter. Either harness reaches a ChatGPT Pro second opinion through the admitted Oracle route. When collaboration transport cannot cross the provider boundary directly, a visible provider-owned task carries the bounded, secret-free contract and returns an identity-bound receipt.

GLM-5.2 is a Codex-only route through `zai_litellm`:

```sh
codex exec -m glm-5.2 -c model_provider=zai_litellm '<bounded brief>'
```

The scout profile uses `high`; the engineer profile uses `xhigh`. Its billing surface is Z.ai Coding Plan credits, a distinct meter that is not converted into USD or combined with another subscription meter.

## Subscription review keeps first-party custody

A supported Claude subscription review verifies Claude Code 2.1.220 or newer, `authMethod: claude.ai`, and `apiProvider: firstParty` before egress. It runs the routed model through the read-only Compound Engineering adapter, validates the raw stream and observed model, and returns review evidence to the owning delivery. That positive attestation is what lets a subscription review cross harnesses without turning ambient environment settings into routing authority.

## Proof point

The [Model routing reference](/delivery/model-routing/) identifies the contract as `railyard/model-routing/v1` and requires explicit model and effort on every dispatch. [Own your routing policy](/delivery/model-routing/policy/) shows how the operator declares eligible providers without defining a second transport.

## Next

[Control model cost](/what-it-does/control-model-cost/) or [read model-routing details](/delivery/model-routing/).
