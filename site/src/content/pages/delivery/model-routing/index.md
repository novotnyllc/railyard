---
layout: default
title: Model routing
parent: Delivery
nav_order: 2
has_children: true
---

# Every dispatch gets a priced, recorded route

Use the right model for the job, spend where the hardness lives, and treat budget as an engineering constraint. That is the economic foundation of agentic delivery: routine volume earns an efficient route, difficult seams earn deeper reasoning, and every choice arrives with a receipt. Railyard resolves model, effort, transport, and budget into one decision before the carrier starts.

## Four verbs, one accountable path

Make the spending decision once, then carry it through four verbs. `resolve` reads the immutable policy snapshot and selects an eligible role, tier, carrier, effort, and transport. `admit` checks the forecast against task, run, and project meters. `claim-dispatch` makes the selected action a one-way claim immediately before the carrier runs. `reconcile` accepts the imported fixed-adapter receipt and settles the route.

![Model routing decision flow from work request through tier selection, admission, one-way claim, carrier work, and imported receipt reconciliation.](/diagrams/m5-model-routing.svg)

The flow makes the spend boundary visible: a blocked forecast refuses before carrier work, while an admitted route leaves a costed outcome in the run log.

Keep routing small and accountable. Model selection feeds the same record that carries review, merge, and post-merge evidence. Railyard's routed model selection is one stage of a delivery pipeline: the per-tier decision that picks a model also feeds the audit record showing what ran, at what tier, at what cost, from first dispatch through merged, proven outcome.

## A no-config decision

```json
{
  "contractVersion": "railyard/model-routing/v1",
  "ok": true,
  "reason": "default_route_no_state",
  "decision": {
    "role": "implementation",
    "selected": {
      "modelAlias": "codex-luna",
      "model": "gpt-5.6-luna",
      "effort": "max",
      "carrierId": "codex-luna",
      "carrierVersion": "v1",
      "executionSurface": "codex",
      "transport": "selector-native",
      "adapterId": "native-subagent-create",
      "adapterVersion": "v1",
      "completionState": "offline_implementation_ready",
      "observedModel": "unknown"
    },
    "implementationEngine": {
      "mode": "prefer",
      "target": "codex",
      "model": "gpt-5.6-luna",
      "source": "deliver"
    },
    "disclosure": {
      "meters": {
        "forecast": { "value": "unknown", "provenance": "unknown" },
        "reservation": { "value": "unknown", "provenance": "unknown" }
      }
    }
  },
  "reservation": "not_applicable",
  "claimRequired": false
}
```

This receipt is the mechanism behind the practice. `prefer` records the no-config assumption: the route favors Codex when its own preflight proves it callable and preserves a native fallback when the host cannot make that proof. A configured route or a trusted runtime attestation can make the Codex binding `require`. No-config admission writes no reservation state.

## Go deeper

- [Roles, tiers, and carriers](/delivery/model-routing/tiers/)
- [Budgets, admission, and receipts](/delivery/model-routing/budgets/)
- [Two worked cost ledgers](/delivery/model-routing/worked-runs/)
- [Model routing skill](/skills/model-routing/)

The [Railyard source repository](https://github.com/novotnyllc/railyard), [releases](https://github.com/novotnyllc/railyard/releases), and [pull-request proof trail](https://github.com/novotnyllc/railyard/pulls) are public companions to this contract.
