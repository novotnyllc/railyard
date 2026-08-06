---
name: model-routing
description: "Resolve one bounded model, effort, transport, and budget decision through railyard/model-routing/v1. Use before model-specific task, subagent, provider-review, or steering actions."
---

# Model routing

`railyard:model-routing` is the only public model, effort, budget, and
transport-policy entrypoint. It returns a frozen decision or receipt; it never
creates a task, invokes a provider, runs a browser, or executes a command on a
provider's behalf.

[`../../references/model-routing.md`](../../references/model-routing.md) is
the normative contract — commands, request shapes, catalog schema, budget
rules, CE override clauses, and state rules live there, and its transport
phase incorporates the provider-task policy. Do not invoke a second router or
copy a model table. For per-harness session defaults and cross-harness
invocation, see
[`../../references/harness-model-invocation.md`](../../references/harness-model-invocation.md).

## Activation

Resolve `SKILL_DIR` from the activated skill path (never an installed-cache
path or source checkout), then:

```bash
ROUTER="$SKILL_DIR/../../scripts/model-routing.mjs"
printf '%s\n' '<request JSON>' | node "$ROUTER"
```

Every request carries exact `"contractVersion":"railyard/model-routing/v1"`.
Requests are content-free: no prompts, task titles, paths, source, files,
tokens, endpoints, or command text.

## Lifecycle

1. **Classify** the bounded destination work: role, categorical work shape,
   adapter/dispatch kind, scope, and privacy. Runtime and transport facts are
   router-owned, never caller JSON.
2. **`resolve`** reads one immutable policy snapshot. No-config defaults: Sol
   `high`/`max` for orchestration and review, Luna at `max` for
   implementation, Terra at `max` only as the router-attested Luna substitute.
   A catalog, request, or environment variable cannot nominate Terra or mark
   Luna unavailable.
3. For configured work-starting actions, **`admit`** with a stable
   caller-generated `requestId`, a frozen artifact digest, and every
   applicable scope; then **`claim-dispatch`** immediately before the one
   carrier dispatch. A claim is one-way and cannot authorize a retry spawn.
4. The owning workflow invokes only the selected fixed adapter/carrier and
   **reconciles** its receipt through the fixed importer. Model output and
   caller-authored JSON are not receipts; adapters outside the fixed set
   return `transport_unsupported`.
5. `status`, `inspect-claim`, local-only `refresh`, and
   `learning inspect|clear|disable|enable` go only through this contract;
   `refresh` never probes a remote provider.

Read the decision's `disclosure` (and any fallback/settlement disclosure) as
the content-free R28 record; do not reconstruct it from provider output.

For a budget-neutral status/narrowing message, use `resolve` with
`budgetEffect:"none"`, a stable `actionId`, and the exact prior route binding;
scope-expanding steering uses `adjust_active` against the active reservation.
Unknown or changed work class blocks inheritance (`prior_route_unknown`)
rather than silently reusing a route. The reference defines the binding fields
and the closed action-receipt schema.

## Fixed transports

The full adapter/carrier tables are in the reference. Operative rules:

- Native task creation may carry `contextFork:"none"` or `"1"`–`"999"`;
  everything else is rejected.
- A visible task create needs a one-use `mint-task-authority` receipt from the
  fixed in-process user-turn attestor; public stdin and `CODEX_*` variables
  cannot mint it.
- Fable/Opus review runs only through the supported Compound Engineering
  Claude `-p` adapter; this skill never builds a parallel Claude runner.
- Oracle review is `oracle-browser` on `chatgpt_current_pro` only; lifecycle
  is the separate `oracle-homebrew-lifecycle` carrier. Oracle API is
  unsupported here.
- GLM is Codex-only (below). The `glm-5-2-scout`/`glm-5-2-engineer` carrier
  rows remain fail-closed (`transport_unsupported`); they are never a Codex
  selector or native-subagent value.

## Harness defaults and GLM

The router's frozen no-config route is harness-independent. Session defaults
are a separate layer with per-harness values; effort is part of the default,
and the two harness columns map row for row by tier (routine steering Sol
`medium`/Opus `medium`; mechanical work Luna `max`/Sonnet `medium`;
implementation Terra `max`/Opus `high`; difficult review Sol `high`/Fable
`high`; critical Sol `max`/Fable `max`; Terra `max` under Sol for long-running
implementation). `medium` is the steering workhorse; Codex implementation
runs at `max` because Luna and Terra are priced for it, while Opus `high` is
the agentic-coding sweet spot with `xhigh` reserved for genuinely hard units.
Escalate deliberately. The
harness-model-invocation reference has the table, the current rate data, and
why sticker rates settle almost nothing (meters differ, operating points
differ, cache rates dominate).

**Dispatch rule — explicit model and effort on every subagent, no
exceptions.** Harness subagents inherit the session model when the dispatch
omits one; on a premium-tier session (Fable, Sol `max`) that silently runs
workers at the top tier — the inversion this router exists to prevent, and
it burns the premium meter without consent. Every child dispatch therefore
names its model (and effort where the harness exposes it) from the table
above; a child deliberately run on the session's own tier is a named
escalation with its reason stated at dispatch. Silent inheritance is a
routing violation. Cross-harness dispatch is additionally opt-in only:
never a silent default, because each harness meters separately.

**Claude Code cannot invoke GLM-5.2.** A Claude session cannot both
authenticate to Z.ai and keep its account-bound capabilities, so the route
does not exist — do not rebuild it. GLM work goes through Codex:
`codex exec -m glm-5.2 -c model_provider=zai_litellm`, available whenever the
provider config and local proxy are present; a failed command is the
availability check. GLM's case is subscription headroom (Z.ai Coding Plan
credits, a meter that never converts to USD) and provider diversity, not
price. Benchmarks are not a selection criterion.

Cross-harness: Claude reaches Codex models through the `codex` plugin's
`codex:rescue` skill (or a direct `codex` CLI invocation); Codex reaches
Claude models through `claude -p`.

## Work contract and CE overrides

Use `build-work-contract` for a carrier-neutral execution envelope: supply the
seven semantic digests plus the selected carrier/model/effort, preserve the
invariant digest, and apply the returned source-owned presentation overlay
(lean brief for GPT/Sol, complete spec for Opus, autonomy/pause boundaries for
Fable, standards-plus-plan for GLM, self-contained one-shot for Oracle).
Direct user and repository instructions outrank the overlay. Changed semantic
inputs against a frozen digest return `invariant_contract_mutation`.

Compound Engineering is never edited. A frozen decision may replace only a
named CE execution mechanism at a seam in the closed registry, using the
runtime replacement clause in the reference; workflow, persona, legitimacy,
writer, review, and terminal authority stay with CE. If the exact carrier/seam
is not attested, return `transport_unsupported` or the disclosed fallback.

## Completion truth

`offline_implementation_ready`, `host_capability_attested`, and
`live_carrier_verified` are distinct; offline tests prove only the first, and
the public CLI cannot mint positive capability evidence from JSON. Never call
an optional route live-verified without its separately authorized minimal
canary or an equivalently bound trusted receipt.
