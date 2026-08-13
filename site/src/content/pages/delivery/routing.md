---
layout: default
title: Routing
parent: Delivery
nav_order: 2
---

# Routing

Routing chooses the work carrier from an explicit work class and returns a decision the workflow can inspect and use.

## One contract

The router entry point is `railyard/model-routing/v1`. It accepts bounded categorical inputs such as ambiguity, novelty, repetition, decomposability, unit volume, semantic risk, and verification strength. The result carries the role, selected model, effort, adapter, transport, privacy, and budget facets.

## The route sequence

1. **Resolve.** Read the policy snapshot and select the eligible route.
2. **Admit.** Reserve the applicable task, run, and project scopes when the work starts.
3. **Claim dispatch.** Bind the selected carrier to the one dispatch action.
4. **Reconcile.** Import the fixed adapter receipt and settle the route evidence.

The built-in path has a valid implementation route and the same contract. Configured policies add explicit privacy, budget, and carrier constraints.

## Explicit dispatch

Every worker and subagent carries an explicit model and effort. The dispatch banner makes the selection visible in the child thread; a route change receives its own route-change line.

## Cross-harness work

Claude Code and Codex each have native carriers. A cross-harness move uses an explicit, attested seam with its own transport and receipt. The task contract remains the source of truth across the handoff.

## Work contracts

The workflow freezes seven semantic digests: objective, source of truth, scope, constraints, authorization, acceptance, and stop condition. A carrier-neutral invariant digest protects the contract while a presentation overlay adapts the brief to the selected model family.

## Proof point

The reference skill names the router script, contract version, dispatch controls, and receipt lifecycle. Source: `railyard/docs/skills/model-routing.md`.

Next: [read the gates](/delivery/gates/) or [control model cost](/what-it-does/control-model-cost/).
