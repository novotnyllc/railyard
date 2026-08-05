---
name: thermos
description: "Launch both thermo-nuclear review subagents in parallel, then synthesize their findings. Use for thermos, double thermo review, or combined bug/security and code-quality branch audits."
---

# Thermos

Run the two thermo review passes as async background subagents in parallel, then synthesize their results.

## Model routing

Before each reviewer edge, invoke `yardmaster:model-routing` with exact
contract `yardmaster/model-routing/v1`. It is the only public model,
effort, budget, and transport router and internally applies
`../../references/provider-task-routing.md`; do not invoke that reference as a
second router. Standalone Thermos admits its two reviewer actions. When Goal
Driven Delivery invokes Thermos, consume its exact pre-reserved reviewer slots
and never resolve or charge the same edge twice.

When a frozen decision selects a Claude Fable/Opus reviewer, override only the
normal optional cross-model review executor through CE's existing attested
read-only Claude adapter; Agent Utilities never starts a parallel raw
`claude -p` runner. Pass the frozen binding to that CE-owned seam, then feed its
receipt-bound findings into the ordinary Thermos disposition. Until that seam
attests the binding, the route is `transport_unsupported`. Preserve the
reviewer concern, persona, input digest, output schema, and Thermos synthesis
authority. Never modify Compound Engineering, pass Claude through a Codex
selector, or claim a review without the fixed adapter receipt.

## Workflow

1. Determine the review scope from the user request, PR, current branch, or relevant changed files.
2. Freeze one deterministic review packet: objective and stop condition, exact diff/file digests, relevant source excerpts, requirement map, changed runtime-artifact chain, simplification receipt when applicable, and reusable hash-bound validation receipts. Reviewers do not rerun unchanged broad suites.
3. Map concern coverage before launching. Require one correctness/security disposition and one code-quality disposition with distinct scopes. A matching independent CE or Sol review may satisfy a disposition only when independence, frozen input digest, concern scope, disposition schema, and authority all match. Launch only uncovered concerns or unresolved disagreements, normally both passes in parallel:
   - Cursor: launch both subagents in the same message with `run_in_background: true`:
     - `subagent_type: "thermo-nuclear-review-subagent"` for bugs, breakages, security, devex regressions, feature-flag leaks, and other branch-audit risks.
     - `subagent_type: "thermo-nuclear-code-quality-review-subagent"` for maintainability, structure, file-size growth, spaghetti, abstractions, and codebase-health risks.
   - Codex: spawn two `explorer` subagents in parallel.
     - For the correctness/security agent, attach or pass the `thermo-nuclear-review` skill. If structured skill attachments are unavailable, read `../thermo-nuclear-review/SKILL.md` relative to this skill and include its instructions in the subagent prompt.
     - For the maintainability agent, attach or pass the `thermo-nuclear-code-quality-review` skill. If structured skill attachments are unavailable, read `../thermo-nuclear-code-quality-review/SKILL.md` relative to this skill and include its instructions in the subagent prompt.
     - Codex spawn calls are background work; wait for both with the available wait tool, then synthesize.
4. Pass each reviewer the same frozen packet and ask for prioritized findings plus an explicit disposition for its assigned concern. A runtime artifact lacking producer/package/install/consumer proof and a material complexity increase lacking a simplification receipt are mandatory findings, not optional observations.
5. After the required dispositions finish or are validly reused, synthesize findings, deduplicate overlaps, and resolve disagreements. Add another model only for a unique unresolved question after routing preflight; review is a concern-coverage portfolio, not an additive swarm.

If individual background summaries are already visible to the user, do not restate them wholesale. Surface the unified verdict, the highest-signal findings, and any remaining uncertainty.
