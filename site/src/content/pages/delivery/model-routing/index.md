---
layout: default
title: Model routing
parent: Delivery
nav_order: 2
has_children: true
---

# Model routing

Choose model and reasoning effort together for each assignment. GPT-6 Sol at `medium` is the ordinary engineering candidate. Use deterministic tools directly for mechanical operations, Luna for suitable bounded work, and Astra at `high` when stronger judgment is needed. Choose `max` only when the assignment supports it.

This is an allocation policy, not a claim that Max is always cheaper or faster. Compare the complete assignment, including children, retries, repairs, and verification. Per-token prices and quota consumed per minute cannot establish cost per correctly completed task.

## Native allocation

Routine work uses native tools and bounded subagents. Explicit suitable inheritance is allowed: state why the parent's model and reasoning effort fit the child. Native full-history forks inherit their settings; an override requires a supported limited-history or no-history fork with sufficient context. A fixed specialist role uses its authoritative settings without forbidden overrides.

The ordinary native candidate is:

```text
model=gpt-6-sol effort=medium carrier=codex-6-sol
```

This names the requested candidate, not an observed live dispatch. The current harness must expose the required controls and capability. An unsupported or unavailable model, effort, role, fork combination, or adapter is disclosed without a silent fallback.

## Optional configured routing

Use `railyard/model-routing/v1` when an explicit account, fleet, privacy, or budget policy needs the full route lifecycle. A configured catalog supplies constraints; it does not automatically create fleet work, visible tasks, live adapters, or permission to send data elsewhere.

The advanced path retains four operations: `resolve` selects an eligible route, `admit` checks applicable forecasts, `claim-dispatch` binds one carrier action, and `reconcile` accepts an identity-bound adapter receipt. Routine native work does not require that stateful ledger.

![Optional configured routing from policy resolution through admission, one-way claim, carrier work, and receipt reconciliation.](/diagrams/m5-model-routing.svg)

### Sequence

1. **Request.** An explicitly configured route receives the role, constraints, and verification shape.
2. **Resolve.** The router reads the selected policy and freezes the route inputs.
3. **Select.** Eligible model and effort choices must satisfy the hard requirements.
4. **Route.** Record the selected model, effort, transport, and any explicitly authorized alternative.
5. **Admit.** Compare applicable forecasts with configured meters; a refusal stops before carrier work.
6. **Claim.** Bind a one-way dispatch claim to the selected carrier action.
7. **Carrier.** Execute only through the supported, verified carrier surface.
8. **Reconcile.** Settle the result from the required imported, identity-bound receipt.
9. **Receipt.** Preserve selected settings, observed evidence, usage provenance, and outcome separately.

A resolver result or passing adapter fixture is offline evidence. Live adapter availability, actual model and effort, and billed usage require their own evidence; unknown values remain unknown.

## Go deeper

- [Models, effort, and carriers](/delivery/model-routing/tiers/)
- [Own your routing policy](/delivery/model-routing/policy/)
- [Budgets, admission, and receipts](/delivery/model-routing/budgets/)
- [A worked allocation example](/delivery/model-routing/worked-runs/)
- [Optional local learning](/delivery/model-routing/learning/)
- [Model routing skill](/skills/model-routing/)
