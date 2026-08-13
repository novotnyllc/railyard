---
layout: default
title: Model routing
parent: Skills
nav_order: 3
---

# Model routing

Route every work unit deliberately before dispatch. Match the model and effort to the work shape, bind the choice to its carrier and budget, and preserve the receipt so quality, cost, and execution can be explained together.

## What it adds

Model routing provides the single decision surface for role, work shape, privacy, budget, and transport. Its response is a frozen route the caller uses for the actual dispatch.

## How it works

The route lifecycle moves through `resolve`, `admit`, dispatch claim, and receipt reconciliation. Work contracts bind objective, source of truth, scope, constraints, authorization, acceptance, and stop condition through semantic digests.

```text
> Resolve the implementation route, admit its forecast, and show the receipt binding.
role=implementation model=gpt-5.6-luna effort=max
carrier=codex-luna adapter=native-subagent-create
implementationEngine=prefer/codex
admit=default_route_no_state claim=one-way
```

## Scope

The router decides and records. The selected workflow or carrier performs the work and returns fixed adapter evidence.

## Source

Ships in the `railyard` plugin.

## Proof point

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
      "adapterId": "native-subagent-create",
      "transport": "selector-native",
      "completionState": "offline_implementation_ready"
    },
    "implementationEngine": { "mode": "prefer", "target": "codex", "model": "gpt-5.6-luna", "source": "deliver" }
  },
  "reservation": "not_applicable",
  "claimRequired": false
}
```

Go deeper: [roles, tiers, and carriers](/delivery/model-routing/).

Next: [read the model-routing section](/delivery/model-routing/).
