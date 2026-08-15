---
layout: default
title: Roles, tiers, and carriers
parent: Delivery
nav_order: 2
---

# Roles, tiers, and carriers

Spend premium reasoning on premium difficulty. Start by naming the work role, place it on an ordered tier ladder, and choose the first eligible carrier whose economics and capabilities fit. The routing contract makes that work shape visible before a model runs and discloses the fallback when a hard constraint removes the first candidate.

## Built-in no-config policy

| Work role | Frozen default |
| --- | --- |
| `implementation` and bounded subroles | `gpt-5.6-luna` at `max`, carrying `implementationEngine: {"mode":"prefer","target":"codex","model":"gpt-5.6-luna","source":"deliver"}`. `prefer` records an assumed no-config capability; a trusted runtime can make it `require`. |
| orchestration or independent review | `gpt-5.6-sol` at `high`; `max` for high, critical, or explicitly complex work |
| unavailable or unselectable Luna implementation | A runtime-attested Terra model at `max`, disclosed as `implementation_model_substitute`; the router does not invent a Terra slug |

Apply the policy to the work unit, independent of the interactive session model. A Codex or Claude session can hand implementation to the same Luna route. The carrier reports `offline_implementation_ready`, `host_capability_attested`, or `live_carrier_verified` as separate states; a local resolver pass proves only the first.

## Carrier table

| Carrier | Transport and fixed facts | Availability truth |
| --- | --- | --- |
| `codex-luna` | selector-native, `gpt-5.6-luna`, `max` | default policy |
| `codex-sol` | selector-native, `gpt-5.6-sol`, `high` or `max` | default policy |
| `codex-terra-runtime` | selector-native, runtime-provided Terra at `max` | requires runtime evidence; no static slug |
| `glm-5-2-scout` | Codex-only separate-task profile, `glm-5.2`, `high`; Z.ai Coding Plan credits | `transport_unsupported` until callable task-profile creation is host-attested |
| `glm-5-2-engineer` | Codex-only separate-task profile, `glm-5.2`, `xhigh`; Z.ai Coding Plan credits | `transport_unsupported` until callable task-profile creation is host-attested; it is not a native agent type or selector model |
| `claude-ce-review` | fixed CE Claude `-p` review adapter | unsupported until the compatible CE adapter is attested |
| `oracle-browser` | `chatgpt_current_pro` on `chatgpt_standard` | unsupported until selected-route Oracle capability is attested |
| `oracle-homebrew-lifecycle` | local-host Oracle install/upgrade lifecycle carrier | unsupported until its separate lifecycle adapter is attested |

GLM enters only through the configured Codex `zai_litellm` provider and a callable host attestation. Its subscription credits remain their own meter; the router does not translate them into dollars or add them to Codex or Claude subscription usage.

## Dispatch-kind table

Keep transport authority bounded while the catalog optimizes selection. The adapter controls are fixed by the contract. A catalog can choose among these rows; it cannot add a provider command, an endpoint, or a new trust-domain bridge.

| Adapter | Dispatch kind | Required knobs | Constraint and receipt behavior |
| --- | --- | --- | --- |
| `codex-task-create` | `task_create` | `model`, `thinking` | Visible task; requires one-use task authority; starts work and produces a Codex task receipt |
| `codex-task-message` | `task_message` | `model`, `thinking` | Visible existing task; budget effect is request-classified (`none` keeps the active reservation, `adjust_active` starts a top-up); no new task authority |
| `native-subagent-create` | `subagent_create` | `model`, `reasoning_effort` | Native child; `contextFork` is `none` or an unpadded turn count from `1` through `999`; produces a native-subagent receipt |
| `native-subagent-message` | `subagent_message` | none | Existing native child; inherits only with an exact prior route and destination binding; the budget effect is request-classified |
| `native-subagent-followup` | `subagent_followup` | none | Work-starting follow-up; requires a fresh resolved route or exact allowed inheritance; it cannot become a retry spawn |
| `configured-profile-task-create` | `task_create` | carrier-owned profile | Visible configured profile; requires callable host evidence and one-use task authority; used by the fixed GLM profiles |
| `claude-cli-via-task` | `task_create` or `task_message` | controller `model`/`thinking`, CE slot | Composite visible task; requires task authority and an unchanged CE-owned Claude review seam |
| `claude-cli-via-worker` | `subagent_create` | worker `model`/`reasoning_effort`, CE slot | Composite worker; uses the supported CE Claude `-p` adapter and returns the ordinary CE review artifact |
| `oracle-browser` | `subagent_create` | fixed carrier | Browser advisor on `chatgpt_standard`; the selected-route claim and imported Oracle receipt bind the review |
| `oracle-homebrew-lifecycle` | `lifecycle_action` | fixed carrier and lifecycle | Local Oracle install/upgrade action; its successful receipt creates a fresh-review requirement before later review can settle it |

## How tiers choose

Let hard requirements choose the tier and soft economics choose within it. Configured `roles` map to ordered `tiers`. A tier is a list of model aliases, or a tier-zero object with `models` and optional `softPriorities`. `cost`, `latency`, `quality`, `reliability`, and `learnedEstimate` are legal soft priorities only at tier zero. They order eligible candidates within that tier; they never cross a tier, reorder a hard route, or create a fallback.

Unknown cost is never zero. Claude family checks preserve Fable versus Opus: a numeric version by itself cannot cross the family boundary. On a premium Claude session, a dispatched worker names Opus explicitly; the explicit model and effort are part of the dispatch contract.

## Catalog receipt

```json
{
  "roles": {
    "implementation": {
      "tiers": [
        { "models": ["luna", "terra"], "softPriorities": ["cost"] },
        ["sol"]
      ]
    }
  },
  "selection": {
    "tier": 0,
    "alias": "luna",
    "reason": "eligible_tier_zero_candidate"
  }
}
```

The receipt names the tier that won and keeps economic interpretation source-owned. It does not turn a representative relative index into a dollar rate; rate-stamped catalog data owns that conversion.
