---
layout: default
title: Own your routing policy
parent: Delivery
nav_order: 3
---

# Own your routing policy

A user-owned catalog is useful when explicit account, fleet, privacy, or budget choices need to be repeatable. Routine native execution does not require one. The shipped starting point uses Astra Max as the substantial-work candidate and keeps specialist routes explicit.

A catalog describes eligible choices. Fixed Railyard adapters own executable commands, transport boundaries, and receipt validation. Catalog data cannot make an unsupported model callable or authorize a new visible task.

## Install and validate a starting point

From a Railyard source checkout:

```sh
install -d -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/railyard"
install -m 600 plugins/railyard/references/model-routing.example.json \
  "${XDG_CONFIG_HOME:-$HOME/.config}/railyard/model-routing.json"
```

Validate an edited catalog through `railyard:model-routing validate` before using it. Offline validation checks the schema and source-owned bindings; it does not establish live account or adapter availability. Startup does not install or overwrite a catalog automatically.

## Author the policy surface

| Key | Operator decision |
| --- | --- |
| `providers` | Opaque account alias, fixed carrier, execution surface, harness, locality, and retention |
| `models` | Model identity, supported efforts, roles, explicitly allowed alternatives, and any sourced rates |
| `roles` | Ordered choices that reflect task needs; soft priorities cannot override hard constraints |
| `privacy` | Provider, locality, retention, and egress boundaries |
| `budgets` | Optional task, run, and project meters using `soft`, `hardAdmission`, or `strict` |
| `discovery` | Bounded capability freshness; unavailable or unsupported evidence remains distinct |
| `learning` | Optional local, content-free outcome aggregates |

An illustrative native role uses the same baseline candidate as the source example:

```text
role=implementation
model=gpt-6-astra effort=max carrier=codex-astra
```

Select a specialist such as Daybreak Blue only when the task and current harness support it. Do not treat a catalog row or a cached discovery record as current live dispatch evidence. Any permitted alternative is disclosed; an unavailable requested selection is never silently replaced.

## Select an explicit policy path

`RAILYARD_MODEL_POLICY_PATH` selects one absolute catalog path. An absent selected file returns `selected_policy_missing` rather than silently using another catalog. Keep policy and private state outside repositories, worktrees, and plugin caches.

The catalog must not contain credentials, arbitrary commands, prompts, source code, or host inventory. Its privacy and budget boundaries remain authoritative even when optional learning suggests a different estimate.

Continue with [models, effort, and carriers](/delivery/model-routing/tiers/), [budgets and receipts](/delivery/model-routing/budgets/), and [optional learning](/delivery/model-routing/learning/).
