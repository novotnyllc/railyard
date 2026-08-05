# Model routing contract v1

`railyard:model-routing` is the single public decision point for model,
effort, budget-admission, and dispatch-transport policy. Its exact wire version
is `railyard/model-routing/v1`.

It is a dependency-free local resolver and private state primitive. It does not
create tasks, launch subagents, invoke Claude or Oracle, call providers, probe
remote entitlement, scrape account pages, retain prompts/files/transcripts, or
read or edit an installed plugin cache. The public CLI has only the fixed,
source-owned private Oracle receipt-artifact bridge whose plugin source is
hashed. Public stdin and `CODEX_*` environment variables are caller-controlled;
they cannot mint visible-task authority or import Codex/native receipts. The
CLI never launches a carrier or treats the Oracle bridge as account or model
evidence. The workflow that owns a claimed decision performs the fixed carrier
action and returns the bounded evidence.

The existing [provider task routing](provider-task-routing.md) document remains
the normative trust-domain and visible-provider-task bridge policy. This entry
point incorporates its phase into each decision so consumers must not call that
document as a second router or reproduce its matrix.

## Input and output

Send one bounded JSON object on stdin to `scripts/model-routing.mjs`. Every
input and output includes:

```json
{ "contractVersion": "railyard/model-routing/v1" }
```

The supported `command` values are `validate`, `resolve`, `admit`,
`claim-dispatch`, `reconcile`, `status`, `inspect-claim`, `refresh`,
`mint-task-authority`, `issue-lease`, `accept-lease`, `claim-slot`,
`release-lease`, `seal-epoch`, `build-work-contract`, and `learning` with an
operation of `inspect`, `clear`, `disable`, or `enable`.

An outbound-work request supplies only content-free control data:

```json
{
  "contractVersion": "railyard/model-routing/v1",
  "command": "resolve",
  "callerKind": "deliver",
  "role": "implementation",
  "adapterId": "native-subagent-create",
  "dispatchKind": "subagent_create",
  "budgetEffect": "start",
  "workShape": {
    "ambiguity": "low",
    "novelty": "low",
    "repetition": "medium",
    "decomposability": "high",
    "unitVolume": "medium",
    "semanticRisk": "low",
    "verificationStrength": "high"
  },
  "scopes": { "task": "opaque-task-id", "run": "opaque-run-id", "project": "opaque-project-id" },
  "frozenInputDigest": "<sha256 of the ordinary bounded artifact>"
}
```

The categorical work-shape values are `low`, `medium`, `high`, or `unknown`.
They are current-request policy input, never prompt-derived learning. Valid
caller kinds are `compound-engineering`, `orchestrate`,
`deliver`, `thermos`, and `fleet`. A CE caller must
supply a closed `ceSeam`; it is not free-form override prose. A local caller
omits `callerKind` entirely — the literal value `"local"` is not accepted.

The router derives a bounded `workClassDigest` from role, risk, context class,
and the fully normalized categorical work shape. A caller may repeat that
digest only when it is exact; a work-starting reservation stores it. A
continuation (`task_message`, `subagent_message`, or `subagent_followup`) must
provide the exact `priorWorkClassDigest` and a `priorRoute.workClassDigest`
that agree with the live reservation and the newly derived class. Unknown or
changed class evidence returns `prior_work_class_unknown` or
`prior_work_class_changed_requires_fresh_route`; it never silently inherits a
model, effort, or active-budget top-up.

`runtime` and `transport` are reserved input names, not caller-controlled
facts: caller JSON for either is rejected. Luna's normal availability is a
fixed router-owned runtime fact; a Terra substitute can come only from the
fixed trusted host-runtime attestor. Likewise, a fixed trusted transport
attestor—not a catalog, environment variable, or request boolean—selects a
native versus visible-task bridge path.

`contextFork`, when present for native creation, is exactly `"none"` or an
unpadded positive decimal turn count from `"1"` through `"999"`. Values such
as `all`, `full-history`, `0`, `03`, numbers, and unknown strings are rejected.

A fleet caller (callerKind `fleet`) may supply one closed content-free R52 readiness record:

```json
{
  "schema": "railyard/r52-readiness/v1",
  "hostReadiness": { "state": "ready", "evidenceDigest": "<sha256>" },
  "taskReadiness": { "state": "ready", "evidenceDigest": "<sha256>" },
  "transportReadiness": { "state": "ready", "evidenceDigest": "<sha256>" },
  "executionHost": { "identityDigest": "<sha256>", "platform": "darwin" },
  "targetPlatform": { "identityDigest": "<sha256>", "platform": "linux" }
}
```

Readiness states are only `ready`, `blocked`, or `unknown`; platforms are only
`darwin`, `linux`, `windows`, `wsl`, or `unknown`. The five objects and their
fields are exact. Raw paths, commands, profiles, prompts, host names, or task
content are rejected. A fleet resolve/admit request requires all
three readiness facts to be `ready`; missing, `blocked`, or `unknown` readiness
is `model_routing_capability_unavailable` before selection. The router freezes
and digests the record in the
decision and action-receipt binding; execution host and target platform remain
separate identities.

A successful decision has immutable policy and selected-carrier data, fixed
adapter controls, requested-versus-observed identity fields, capability state,
privacy/egress classification, rejected alternatives, and a reason/fallback.
It intentionally contains no task title, objective, prompt, path, secret,
acknowledgement body, raw provider output, or writable command.

Every decision, fallback, budget fallback, settlement, and settlement replay
also carries `railyard/r28-route-disclosure/v1`. It gives requested,
configured, and observed provider/endpoint/execution/billing/model/effort
facets; carrier and probe identity; forecast/reservation/actual/charged meter
facets; capability freshness; privacy; rejected alternatives; attribution
boundary; and escalation state. Each facet has an explicit provenance and uses
`"unknown"` or `"not_applicable"` rather than silently omitting an answer.
The disclosure is content-free and the compact settlement form is retained so
an exact receipt replay returns the same facts.

`resolve` is read-only. `admit` needs a caller-generated `requestId`, a
frozen ordinary-artifact digest, and atomically checks/reserves every supplied
task/run/project scope. Every hard/strict meter needs a forecast; a missing
forecast blocks. A repeated identical request returns the original reservation;
conflicting reuse of the same request ID blocks. `claim-dispatch` makes one
durable, one-way claim immediately before the actual fixed carrier action and
rechecks the frozen digest. `reconcile` accepts only an imported fixed-adapter
receipt: a trusted in-process importer must read and verify private adapter
evidence, then attest the complete receipt. Public JSON is untrusted transport,
never generic settlement authority. The sole public-CLI exception is a private
Oracle `receiptId` reference read from the canonical user state root. The
imported receipt is bound to producer/version,
claim, frozen-input digest, and the exact host, account, dispatch kind, opaque
session, tool ID, and tool version captured at claim time. A receipt ID replay
across another claim blocks before same-claim idempotence. The durable replay
binding excludes only the fresh import timestamp, so the exact same evidence
can be replayed from a later CLI process without making time itself part of
receipt identity.

For no-config defaults, a fresh work-starting `resolve` or `admit` needs no
state write and `admit` returns `default_route_no_state`. Existing-destination
`budgetEffect:"none"` and `adjust_active` require a resolver-owned current
`priorRoute` and exact work class; without them they return
`prior_route_unknown`. The router never invents remote task state or a
non-destination status/cancel adapter. The one exceptional
stateful no-config operation is a `reconcile` receipt with
`kind:"default_terminal"`, a stable `outcomeId`, and the built-in policy digest;
it records only bounded route-independent local demand learning, never a
fabricated carrier/model route effect.

## Built-in no-config policy

No catalog means no external probes and no optional-route assumption.

| Work role | Frozen default |
| --- | --- |
| `implementation` and its bounded subroles | `gpt-5.6-luna` at `max`, including exactly `implementationEngine:{"mode":"require","target":"codex","model":"gpt-5.6-luna","source":"deliver"}` |
| orchestration or independent review | `gpt-5.6-sol` at `high`; `max` only for high/critical or explicitly complex work |
| unavailable/unselectable Luna implementation | only a runtime-attested Terra model at `max`, disclosed as `implementation_model_substitute`; the resolver never invents a Terra slug |

An unavailable Luna with no attested Terra substitute returns
`preferred_unavailable`. Explicit user/repository model requirements prevent
that automatic substitution.

This table is the delegated carrier route and is harness-independent: a Claude
session that delegates bounded implementation still receives the Luna route.
The model each harness runs as for its own turn is a separate layer with
per-harness defaults. See
[harness model invocation](harness-model-invocation.md) for those defaults,
the Codex-only GLM-5.2 route, and the cross-harness handoffs. That reference
is invocation guidance only; it grants no route this contract has not
admitted.

## Catalog

The optional user-owned JSON catalog has exact `schemaVersion: 1` and these
top-level keys only: `providers`, `models`, `roles`, `privacy`, `budgets`,
`discovery`, and `learning`.

- `providers` maps opaque aliases to a fixed `carrierId`, opaque account alias,
  typed execution surface (including `local_host`), locality, retention class,
  and declared capability names. Declarations are eligibility policy, not
  callable evidence.
- `models` maps opaque aliases to a provider alias, fixed `carrierId`, bounded
  requested model/family, effort(s), roles, optional `provider_latest_family`
  or `exact_pin` identity mode, optional numeric minimum generation,
  work-shape constraints, context-window and required-capability requirements,
  billing surface, current-family fallback set, rates, and
  `relativeCostIndex` from 1 through 1,000,000. Every rate has an HTTPS source
  URL, checked/effective timestamp, optional promotion expiry, a default
  30-day freshness limit, and an exact resolved-model digest, carrier/version,
  effort, and billing-surface binding.
- `roles` maps role names to ordered `tiers`; each tier is an ordered model
  list or `{ "models": [...], "softPriorities": [...] }`. A
  `softPriorities` object is allowed only for tier zero; valid priorities are
  `cost`, `latency`, `quality`, `reliability`, and `learnedEstimate`.
  `learnedEstimate` is an observational tier-zero tiebreak only. It never
  changes eligibility, crosses a tier, reorders a declared hard route, or
  creates a fallback.
- `privacy` can only restrict egress/provider eligibility, locality, or
  retention. Nested request policy can tighten it, never silently loosen the
  root configuration. Decisions report the selected provider's actual locality
  and retention class; they never claim universal non-retention.
- `budgets` has task/run/project meter limits. A meter rule may contain
  `soft`, `hardAdmission`, or `strict` canonical amounts.

Catalog data is declarative, credential-free, and cannot define a profile,
provider command, flag, executable, endpoint, path, prompt, source, host, or
transport trust-domain claim. Unknown carrier aliases are valid data but return
`unsupported_adapter`; they are never executed. Invalid/missing required
configuration fails closed instead of falling back through a privacy or budget
restriction.

Known cost/latency/quality fields order routes only after hard role, carrier,
effort, context, work-shape, privacy, family, and transport eligibility.
Unknown cost is never zero or free. Different meter types are not converted or
added without explicit user policy. Claude review model identities are limited
to the Fable/Opus family aliases. Exact, minimum-generation, and `current`
checks always preserve the family; a numeric version alone can never cross from
Fable to Opus or vice versa.

A `provider_latest_family` route additionally needs positive host evidence for
the observed model, resolved-model digest, required capabilities, and exact
fallback-set digest. Positive evidence has an attested-facts digest; negative
evidence is scoped to carrier/version, adapter/version, host/account, and
policy digest. Negative reasons have fixed classes: transient (60 seconds),
auth (5 minutes), missing binary (1 hour), and unsupported (24 hours). A
catalog may set one `negativeTtlSeconds` or class-specific
`discovery.negativeTtls` values, each bounded to 24 hours; a Retry-After is
bounded by `discovery.retryAfterMaxSeconds` (default one hour) and can only
extend the hold. The decision exposes the safe reason class and `notBefore`,
never a provider header or body. Unsupported adapter/importer evidence remains
ineligible until its policy or adapter digest changes, even after its timer,
because retrying the identical fixed surface cannot make it supported. An
Oracle `auth_context_unavailable` receipt creates auth-class negative evidence
so another browser attempt is not selected during that hold.

## Fixed adapters and carriers

Only these descriptors can turn a policy decision into an invocation binding.
Catalog fields may reference them; they cannot extend them.

| Adapter | Native action class | Model/effort controls | State |
| --- | --- | --- | --- |
| `codex-task-create` / `codex-task-message` | visible Codex task | `model`, `thinking` | task create needs one-use task authority |
| `native-subagent-create` | native subagent | `model`, `reasoning_effort` | `contextFork` is `"none"` or `"1"`-`"999"` only |
| `native-subagent-message` | existing subagent message | none | `none` or `adjust_active`, never a fake spawn claim |
| `native-subagent-followup` | work-starting follow-up | none today | fresh resolved route/inheritance only |
| `configured-profile-task-create` | separately callable profile task | carrier-owned fixed profile | GLM only after host attestation |
| `claude-cli-via-task` / `claude-cli-via-worker` | CE-owned Claude review path | selector controller/worker plus CE slot binding | composite controller and Claude-child accounting |
| `oracle-browser` | fixed Oracle browser advisor | fixed route | selected-route local attestation only |
| `oracle-homebrew-lifecycle` | fixed local Oracle lifecycle action | fixed lifecycle carrier | separate lifecycle claim; successful mutation requires a fresh review |

| Carrier | Transport and fixed facts | Availability truth |
| --- | --- | --- |
| `codex-luna` | selector-native, `gpt-5.6-luna`, Max | default policy |
| `codex-sol` | selector-native, `gpt-5.6-sol`, High/Max | default policy |
| `codex-terra-runtime` | selector-native, runtime-provided Terra at Max | requires runtime evidence; no static slug |
| `glm-5-2-scout` | separate-task profile, `glm-5.2`, High | `transport_unsupported` until callable task-profile creation is host-attested |
| `glm-5-2-engineer` | separate-task profile, `glm-5.2`, xhigh | same; not a native agent type or selector model |
| `claude-ce-review` | fixed CE Claude `-p` review adapter | unsupported until the compatible CE adapter is attested |
| `oracle-browser` | `chatgpt_current_pro` on `chatgpt_standard` | unsupported until selected-route Oracle capability is attested |
| `oracle-homebrew-lifecycle` | local-host Oracle install/upgrade lifecycle carrier | unsupported until its separate adapter capability is attested |

The current GLM profile facts (`glm-5.2`, High/xhigh, `zai_litellm`, and the
200,000-token ceiling) are scoped host evidence, not a reusable default or
entitlement claim. The resolver never treats a loopback bridge as local
inference, provider entitlement, or live usage proof.

The public stdin CLI has a closed receipt bridge only for `oracle-browser` and
`oracle-homebrew-lifecycle`. It accepts a `receiptId` reference matching a
private artifact below the canonical user state root. It does not accept
Codex/native receipt JSON, app-tool evidence, a callback, module path,
executable, command, or adapter hook. Publicly configured visible-task and
native routes therefore return `transport_unsupported`; a trusted in-process
embedding may supply the closed authority attestor and receipt importer.

The fixed local Oracle probe can attest only that the private receipt-bridge source is
available, with observed model and authentication explicitly `unknown`; it
cannot attest entitlement, browser authentication, or provider model
availability. A configured adapter with no fixed public importer returns
`transport_unsupported`. A host integration may provide a separately closed
in-process importer, but no catalog or user request can select one.

`offline_implementation_ready` means the resolver and tests are present.
`host_capability_attested` means a fixed host adapter has current scoped
evidence. `live_carrier_verified` additionally needs a separately authorized
minimal real canary on frozen inputs or an equivalently bound successful fixed
adapter receipt. Do not collapse those states.

## Provider bridge phase

Transport compatibility is supplied only by the fixed trusted in-process
transport attestor. The caller cannot set a transport boolean or use a catalog
field to choose a route:

- `native_compatible` permits the normal fixed adapter path.
- `bridge_required` or `unknown` needs `bridgeAvailable:true`; the resolver
  returns a separately accounted `bootstrap` phase.
- After the fixed visible-task create has returned verified identity and a
  secret-free acknowledgement comparison has passed, reconcile the bootstrap
  as `bridge_acknowledged`. A new request with the opaque bridge lifecycle ID
  admits the provider-local activation only when its exact host, account,
  dispatch kind, session, tool ID, and tool version match that bootstrap
  acknowledgement.

The bootstrap forbids mutable work. An acknowledgement failure or ambiguity is
charged to its own attempt and never unlocks activation. The router stores no
acknowledgement body. A transport rejection can select only a disclosed new
policy decision, never silently substitute a model/provider.

## Budget, claim, and receipt bounds

Amounts use canonical strings. USD-like meters accept nonnegative decimal
strings with at most six fractional digits and are compared as integer
micro-USD; other meters are nonnegative integer strings. Negative, exponent,
over-precision, and unsafe numbers fail before hashing.

For each configured meter, admission includes outstanding reservations,
allocator lease headroom, and settled hard-accounted amount across every
supplied scope. Scope accounting is namespaced by scope kind and opaque ID, so
the same raw ID in task/run/project cannot collide. `hardAdmission`
blocks over-allocation; `strict` also requires the fixed carrier to attest
enforcement for that meter. Hard/strict meters cannot omit a forecast. The
resolver tries the next eligible configured candidate when a higher-ranked
candidate cannot meet a hard constraint; it never relaxes one. If billed actual
is absent, reconciliation conservatively charges the reserved ceiling. A
measured amount above it freezes every affected scope with `ceiling_breached`.

A visible task create requires a state-held authority record minted through
`mint-task-authority` by the fixed trusted in-process user-turn attestor. It is
tied to objective epoch and objective digest, explicit instruction digest,
sender owner, account, selected carrier/adapter, policy digest, destination
scope/class, maximum task count, current turn, bounded expiry, and controller
thread/profile/origin. The reservation freezes that exact authority binding;
only a claim with the same authority ID, facts digest, objective/instruction,
controller, destination, carrier/adapter, policy, turn, and dispatch identity
consumes one use. Public stdin and `CODEX_*` environment variables do not
provide this attestor. A bare `taskAuthority:true`, caller-supplied attestation,
or configuration flag cannot authorize work.
The authority and lease facilities are cooperative private-state controls, not
cryptographic proof against a hostile remote handoff.

The imported fixed-carrier receipt must include its opaque receipt ID, producer,
adapter version, claim ID, frozen-input digest, allowed status, and approved
metering/identity fields. The importer attestation is retained with a compact
tombstone; wrapper-only Oracle output remains out of router state. A same-claim
replay is idempotent only after its full claim, identity, and attestation
comparison passes.

`budgetEffect:"none"` and `adjust_active` return the one closed
`railyard/action-receipt/v1` schema. It records the stable action ID and
digest, adapter/version/dispatch, derived and prior work
class digests, prior-route digest, capability state/freshness,
requested-versus-actual model/effort, inheritance/fallback reasons, and either
`"not_applicable"` budget or a bounded top-up forecast. It contains no task
content. The only reason values are `budget_neutral_message` and
`active_budget_top_up`; inheritance is `not_applicable` or the exact
`intentional_same_class_inheritance`; fallback is `not_applicable`,
`implementation_model_substitute`, or
`higher_ranked_candidate_cannot_fit_hard_constraint`. A neutral message has
`startsWork:false`; an active top-up has `startsWork:true`. Repeating the same
neutral request derives the same receipt; repeating
the same active adjustment returns the stored receipt rather than adding a
second top-up.

## Carrier-neutral work contract and closed overlays

`build-work-contract` accepts only the seven SHA-256 semantic digests:
objective, source of truth, scope, constraints, authorization, acceptance, and
stop condition. It returns a carrier-neutral invariant object/digest plus a
separate source-owned presentation overlay. The only presentation families are
`gpt_sol`, `opus`, `fable`, `glm`, and `oracle`. Their closed instructions use,
respectively, a lean bounded brief; the complete specification with explicit
scope/delegation/progress limits; autonomy, pause, evidence, and long-run-memory
boundaries; repository standards plus plan/impact/risk/verification; or a
self-contained one-shot briefing with complete selected-file context. Direct
user and applicable repository instructions outrank every overlay. No caller
prompt, task content, catalog prompt policy, provider call, command, or model
output is accepted. An `expectedInvariantDigest` rejects a changed semantic
contract; changing a carrier changes only the maintained presentation layer.

## State, refresh, and learning

The policy path order is absolute `RAILYARD_MODEL_POLICY_PATH`, then
the platform user config path. The state path order is absolute
`RAILYARD_MODEL_STATE_PATH`, then the POSIX user state path. Defaults
and overrides are independently checked for absolute paths, symlink ancestors,
repository/worktree/plugin-cache nesting, and unsafe writable config/state
ancestry. An explicitly selected but absent policy path is
`selected_policy_missing`, not a silent default.
State/config reads require an owned private regular single-link file; state
writes use a private lock/temp/atomic replacement. Invalid protected configured
state fails closed. Public `inspect-claim` ignores policy/state overrides,
`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `LOCALAPPDATA`, and uses canonical
`os.homedir()` state. Only a trusted embedding that explicitly enables path
overrides can change that, so Oracle reads canonical private state. Native
Windows supports bounded catalog validation but all state
mutations return `secure_state_unsupported`; WSL is Linux evidence, not native
Windows evidence.

`refresh` accepts bounded negative local evidence directly. A remote probe
returns `remote_probe_unsupported`; no command starts provider work. Positive
`host_capability_attested` or `live_carrier_verified` evidence fails closed
unless a fixed in-process trusted host attestor is present. Its record is bound
to carrier/version, adapter/version, host/account, policy digest, expiry,
resolved model, scoped capabilities, and an attested-facts digest. No JSON
caller can assert those positive states.

Learning is automatic on eligible terminal reconciliation, local-only,
content-free, bounded to 200 outcomes and 256 aggregates, and keyed by stable
opaque outcome IDs. Its route-independent base-demand key is role, risk,
context class, and the allowlisted normalized work shape. Its separate route
effect key adds model/carrier version, effort, and billing surface. It may
retain only those bounded fields plus duration, validated usage,
retry/failure, verification, and rating. Its forecast hint starts only after a
five-sample floor and is capped at plus/minus 20%; a learned lower estimate may
never lower a hard/strict forecast. Learning never changes hard eligibility,
declared tier order, availability, privacy, or a budget; only an explicitly
configured tier-zero `learnedEstimate` can use the route-effect tiebreak.
`learning clear|disable|enable` changes only learning data;
`retention:"none"` disables per-attempt learning.

## Cooperative lease and claim inspection

`issue-lease` atomically reserves its allocator task/run/project headroom and
creates a local destination-host-and-account-bound slot bundle with a policy digest, epoch,
fixed carrier/adapter versions, per-meter ceiling, maximum slots, expiry, and
allocator receipt digest. `accept-lease` records destination acceptance;
`claim-slot` allocates one bounded slot only for the exact admitted host and
account; `release-lease` releases unused
remaining headroom without erasing active allocations; and `seal-epoch` freezes
the lease epoch only when it has no active allocation or reservation. After a
seal, it rejects new lease issuance, slot claims, and new settled spend for the
epoch; only an exact prior receipt replay remains available. State preserves
active claims, live capability evidence, and recent settlement tombstones; only
optional learning and old terminal records are eligible for compaction before
the 1 MiB state limit. This v1 is
local-private-state only: it does not claim signed cross-host delivery or
hostile-handoff integrity. Every decision and reservation freezes its admitted
host and account; native, Oracle, and delegated-slot claims with a different
identity are rejected before any replay or settlement check.

`inspect-claim` is read-only and returns only an active claim’s normalized
`claimId`, `reservationId`, state, policy digest, selected carrier/version and
surface, adapter/version/dispatch binding, frozen-input digest, and full opaque
dispatch identity, work-class digest, objective digest, and instruction digest.
Oracle must validate every returned field before acting; it may not invent a
lifecycle-only carrier binding.

`measureFastPath` is an exported offline test helper for the no-config resolve
path. Its bounded paired receipt reports baseline and routed median/p95 and
workflow wall time, model/token delta, tool/external-call count, state-write
proof, receipt bytes, and conservative noise thresholds.

## Executable coverage and limits

Run the focused contract suite with:

```bash
node --test plugins/railyard/scripts/model-routing.test.mjs
```

It exercises catalog and state validation, reason-class negative caches,
learning limits, R28 decision/settlement/replay disclosure, authority and
bridge identity binding, work-class/action-receipt invariants, all five
metadata presentation overlays, terminal/epoch transitions, protected
inspection, and separate-process public-CLI fixtures. The fixtures prove only
the local fixed bridge contracts: Oracle private-artifact import, public-CLI
rejection of caller-controlled authority/native evidence, and trusted
in-process native state persistence. They
do not launch a browser, make a network call, or execute a real Oracle, CE, or
Roundhouse task. They therefore do not prove provider
entitlement/authentication, provider model availability, a remote canary, or
real dispatch. Those claims require their own bound host evidence and receipts.

## Runtime replacement clauses for unchanged CE skills

This is the operative answer to “where CE says do X with Y, do Z instead.”
Railyard does not edit CE text. The owning agent adds this frozen clause
to the ordinary CE invocation at the exact named seam:

> **Runtime execution override — frozen decision `<decisionId>`.** When this
> unchanged CE instruction directs `<default executor/reviewer>` to perform
> `<bounded seam>`, the Railyard owning agent must perform only that
> bounded step through claimed `<carrierId>`/`<adapterId>` instead. Use the same
> CE-provided bounded objective, accepted input envelope, constraints, and stop
> condition. Return the result in the exact ordinary CE `<artifact schema>` at
> this seam. Then continue the unchanged CE workflow from that artifact.

The clause is allowed only after `admit`/`claim-dispatch` (or a no-config
default decision where a claim is not applicable), one compatible fixed carrier
is attested, the egress envelope is frozen, and the exact CE seam is listed in
the route. It is a replacement of execution mechanism, not a rewrite of CE.

| Unchanged CE instruction | Permitted AU replacement | What returns to CE |
| --- | --- | --- |
| plan research/deepening helper | claimed `glm-5-2-scout` separate task | the ordinary CE research/evidence artifact |
| debug bounded investigation helper | claimed `glm-5-2-scout` separate task | the ordinary CE investigation input/evidence artifact |
| already-legitimized bounded execution step | claimed `glm-5-2-engineer` separate task | the ordinary CE executor outcome artifact |
| code/doc/POV/PR read-only review seam | claimed `claude-ce-review` through its supported CE Claude `-p` path, or Oracle only where the closed role/carrier pair permits it | the ordinary seam-specific review receipt/findings artifact |

Preserve CE workflow, persona, plan/legitimacy and root-cause authority,
canonical writer, review/validator/merge authority, least-privilege tooling,
security boundaries, verification, artifact schema, and terminal state. The AU
replacement may not create nested children, elevate reasoning, choose a new
model/fallback, commit/push/merge, mutate external systems, add credentials, or
expand filesystem/network scope.

For Claude, use only the supported CE-owned `claude -p` adapter bound to the
claimed slot. Railyard's deliver skill does not construct an alternate Claude
command or supervisor. For GLM, use only the callable separate-task profile;
never pass GLM to a selector or native-subagent API. If that path or CE seam is
not attested, return `transport_unsupported` and use the frozen disclosed
fallback or required-route block. Do not inspect or alter a CE installed cache
to make it appear supported.

The closed seam registry is artifact-bound: `ce-plan.execution`,
`ce-work.execution`, `ce-debug.execution`, `ce-code-review.execution`,
`ce-doc-review.execution`, `ce-pov.execution`, and `ce-pr-review.execution`.
Each lists the only compatible roles and carriers. A correctly shaped but
carrier/role-incompatible seam returns `ce_seam_binding_mismatch`; it is not a
free-form instruction override.

## Oracle carrier and lifecycle binding

When the selected carrier is `oracle-browser`, obtain the exact active
`inspect-claim` binding and pass its matching route plus the frozen
prompt/files/exclusions/retain-hours contract to the Oracle wrapper. The router
has a distinct `oracle-homebrew-lifecycle` carrier/adapter bound to
`lifecycle_action` on `local_host`; a lifecycle wrapper must use that exact
claim, never reuse an Oracle review claim. A successful lifecycle receipt proves
the fixed zero charged-meter surface and sets `freshReviewRequired:true`. The
router then creates an unfulfilled host/account/policy-bound review requirement.
A subsequent review claim must name that requirement and cannot settle it
without matching identity and policy.

The route’s requested identity is `chatgpt_current_pro`; its execution surface
is `chatgpt_standard`. Browser auth can remain `unknown` for one policy-admitted
normal attempt. A login/account-selection result is
`auth_context_unavailable`: stop without interaction, credential changes, or
API fallback. `oracle-api` is unsupported by this contract.
