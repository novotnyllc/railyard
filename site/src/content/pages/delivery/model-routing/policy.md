---
layout: default
title: Own your routing policy
parent: Delivery
nav_order: 3
---

# Own your routing policy

Start with the shipped defaults, then make account, privacy, and budget choices explicit when the work outgrows them. A routing catalog is an operator-owned statement of eligible carriers and ordered roles. Fixed Railyard adapters continue to own commands, endpoints, credentials, and transport.

## The run

The operator copies the shipped example, adds the providers already available in the two harnesses, validates it, and resolves one bounded work class. Railyard freezes the catalog digest before selection and carries the chosen model, effort, carrier, privacy, and meter provenance into the route disclosure. The turn is installing a validated catalog at the user boundary. The run closes when a normal `resolve` names that catalog digest and the expected tier.

## Install the shipped starting point

From a Railyard source checkout:

```sh
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/railyard"
install -m 600 plugins/railyard/references/model-routing.example.json \
  "${XDG_CONFIG_HOME:-$HOME/.config}/railyard/model-routing.json"
```

Run the `validate` verb through `railyard:model-routing` before using an edited catalog. Validation is offline and content-free; it checks the closed schema and source-owned carrier bindings without starting provider work.

## Author the policy surface

| Key | Operator decision | Evidence Railyard preserves |
| --- | --- | --- |
| `providers` | Account alias, fixed carrier, execution surface, harness, locality, retention, and supported availability source | Configured account and privacy provenance |
| `models` | Provider, fixed carrier, requested family/model, efforts, roles, fallbacks, rates, and `relativeCostIndex` | Exact selected alias, effort, rate freshness, and rejected alternatives |
| `roles` | Ordered tier ladders; tier zero may use `cost`, `latency`, `quality`, `reliability`, or `learnedEstimate` | The tier that won and every hard constraint that kept another candidate out |
| `privacy` | Provider, locality, retention, and egress restrictions | Tighten-only request handling; the root catalog remains the widest allowed boundary |
| `budgets` | Task, run, and project meters using `soft`, `hardAdmission`, or `strict` | Forecast, reservation, actual, and charged facets kept in their native meter |
| `discovery` | Bounded negative-evidence freshness | Transient 60 seconds, auth 5 minutes, missing binary 1 hour, unsupported 24 hours by default |
| `learning` | Whether bounded local learning is active | Content-free outcome and aggregate counts; prompts and files remain outside the store |

```json
{
  "schemaVersion": 1,
  "providers": {
    "codex_luna": {
      "carrierId": "codex-luna",
      "executionSurface": "codex",
      "account": "codex-sub",
      "locality": "external",
      "retention": "provider_default",
      "harness": "codex"
    }
  },
  "models": {
    "luna": {
      "provider": "codex_luna",
      "carrierId": "codex-luna",
      "requestedModel": "gpt-5.6-luna",
      "efforts": ["max"],
      "roles": ["implementation", "implementation.mechanical"],
      "relativeCostIndex": 20
    }
  },
  "roles": {"implementation": {"tiers": [["luna"]]}},
  "learning": {"enabled": true}
}
```

The catalog names only fixed carrier aliases. Railyard owns the executable adapters, dispatch controls, bridge rules, and receipts that make those aliases real.

## Select an explicit policy path

`RAILYARD_MODEL_POLICY_PATH` selects one absolute catalog path for a bounded environment. Selection is exact: an absent file returns `selected_policy_missing` instead of silently falling back to the normal user catalog. That behavior makes a CI or alternate-account policy reproducible.

```text
policy_source=user_configuration
policy_digest=sha256:7c1a...
role=implementation tier=0 alias=luna
privacy=tightened carrier=codex-luna
result=resolved
```

Continue with [roles, tiers, and carriers](/delivery/model-routing/tiers/), [budgets and receipts](/delivery/model-routing/budgets/), and [local learning](/delivery/model-routing/learning/).
