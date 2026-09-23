# Model routing contract v1

Choose model and effort deliberately for ordinary native work using the
[allocation guide](harness-model-invocation.md). GPT-6 Sol at medium is the
baseline for ordinary substantive Codex work; use high when task need
warrants it, Luna at low or medium for bounded repetitive work, and Astra only
for clear hard or high-risk escalation. Native subagent creation advertises
Sol and Luna in its tool schema and routing source; backend execution remains
unverified until observed. Explicit user choices
and suitable inheritance remain authoritative. Native dispatch does not need
an admission ledger, charter, or routine routing CLI call.

This reference describes the optional strict resolver for configured fleet,
budget, privacy, and fixed-adapter work. Its exact wire version is
`railyard/model-routing/v1`.

It is a dependency-free local resolver and private state primitive. It does not
create tasks, launch subagents, invoke Claude or Oracle, call providers, probe
remote entitlement, scrape account pages, retain prompts/files/transcripts, or
read or edit an installed plugin cache. One narrow, source-owned exception is
a configured Daybreak-eligible resolve whose cache is stale: the public
CLI can enumerate the local Codex App Server's fixed model list and retain only
the resulting bounded availability fact. It is not a provider call, an account
page scrape, or a carrier execution. Public stdin and `CODEX_*` environment
variables are caller-controlled; they cannot mint visible-task authority or
import Codex/native receipts. The CLI never launches a claimed carrier or
treats the Oracle bridge or model-list cache as account/model execution
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
  "adapterId": "codex-task-create",
  "dispatchKind": "task_create",
  "budgetEffect": "start",
  "model": "gpt-6-sol",
  "effort": "medium",
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
facts: caller JSON for either is rejected. A trusted transport
attestor selects any native versus visible-task bridge path; configuration or
a request boolean cannot manufacture that evidence.

`contextFork`, when present for native creation, is exactly `"none"` or an
unpadded positive decimal turn count from `"1"` through `"999"`. Values such
as `all`, `full-history`, `0`, `03`, numbers, and unknown strings are rejected.
A strict native creation decision defaults an omitted `contextFork` to
`"none"`; map it to the actual tool's `fork_turns`. Its explicit model/effort
controls cannot accompany a full-history fork. Deliberate full-history
inheritance uses the lean native guide and gate, outside this explicit-control
contract.

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

The three route sections answer three different questions and are expected to
diverge. `requested` is what the caller asked for and nothing else: the effort
it named, the single provider its privacy constraint allowed, and
`"not_requested"` for every facet a request did not state. A request may name
`model` and `effort`; it cannot supply an endpoint, execution surface, or
billing surface. `configured` is the
catalog's answer for the selected route, and `observed` is what the adapter
receipt or capability attestation actually reported.
The disclosure is content-free and the compact settlement form is retained so
an exact receipt replay returns the same facts.

`resolve` is read-only except for the configured Daybreak security-cache refresh
described below. `admit` needs a caller-generated `requestId`, a
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

## Continuing after a policy change

Re-evaluate work-starting continuations under the current routing rules. For
`task_message`, `priorRoute` authenticates the original reservation, claim,
destination, and adapter. When `reservation.currentRoute` exists, use its
model, carrier, effort, and policy for the fresh current-policy decision.
Send the resulting supported pair through explicit `model` and `thinking`
controls on the Codex task message.

A settled receipt keeps its original dispatch identity. An authenticated claim
against a stale, never-dispatched reservation atomically invalidates that
reservation, releases its forecast budget, and returns
`route_reevaluation_required`. Re-resolve and re-admit under the current policy
before claiming dispatch again. Native subagent follow-up has no allocation
overrides, so a changed allocation requires a fresh dispatch.

## Built-in no-config policy

No catalog means no provider probe, availability assertion, or required
implementation-harness change. Ordinary substantive Codex task work proposes
`gpt-6-sol` at `medium`. Complex or difficult work can select Sol at `high`;
bounded repetitive work can select Luna at `low` or `medium`; Astra is a clear
hard or high-risk escalation. Native creation uses the same Sol baseline and
advertises Sol/Luna selectors; the active schema and backend decide whether a
requested pair can run. The built-in
digest changes with this policy so old decisions are not reused as the new
policy.

`model` and `effort` preserve caller requirements exactly. Naming a model
requires a concrete effort (`effort_required` if omitted). A requested effort
also applies when the model is omitted, using Sol as the candidate. An
unsupported pair returns `native_model_unsupported` or `effort_unsupported`;
it does not replace the model or lower effort. `explicitModelRequirement:true`
requires the concrete `model` field.

This baseline does not emit `implementationEngine`. An explicit model request
or configured Codex implementation route emits
`{"mode":"require","target":"codex","model":"<selected model>","source":"deliver"}`.
That field is binding policy, not proof that the model is available. Preserve
the decision's effort as well. If the required route is unavailable, surface
the incompatibility; do not use CE's `prefer` behavior to switch harnesses.
A no-config request from a Claude harness returns
`cross_harness_adapter_required` instead of inventing a cross-harness route.

A default is a starting policy, not an assertion that it always wins. Evaluate cost
and elapsed time to an accepted result across the whole assignment, including
children, unsuccessful attempts, repeated reads, retries, and repairs. Use
existing outcomes; do not substitute a per-token price or quota-per-hour
ranking for completed-task evidence. Mechanical operations use deterministic
tools directly. A supported explicit user preference, measured workload
tradeoff, or relevant specialist can justify another model and effort.

## Native capability and roles

[`scripts/model-routing/native.mjs`](../scripts/model-routing/native.mjs)
exports the small, dependency-free capability check used by the native gate.
Its permitted native-subagent roster includes Astra and Daybreak through
`ultra`.
All begin at `low` and include `medium` and `high`; see the
[exact roster and fork rules](harness-model-invocation.md#gpt-6-family-and-current-codex-native-controls).

The active tool schema is authoritative. A provider catalog or
`models_cache.json` may include models the current native tool does not expose;
neither is a promise that those overrides are callable. The shared native
check does not claim runtime verification, account availability, or a universal
model list. It must be updated from an inspected adapter surface when that
surface changes.

Native model selectors share the agent's exposed capabilities. Suitability for
coordination, implementation, or review is a deliberate policy judgment;
there is no fabricated Luna leaf-only capability restriction. A configured
catalog can still constrain its own models to specified roles. A fixed
specialist binding is a different feature: it requires an authoritative role
configuration and an actually exposed role parameter. The current native tool
has no role parameter, so a role name in a prompt cannot select one.

Deliberate inheritance records why the same parent model and effort suit the
work. It is not silent omission. Overrides require a compatible no-history or
bounded-history fork; full-history inheritance carries neither override. Tool
arguments document requested settings. Worker banner echoes do not prove what
ran, and narrowing history does not disable plugins.

## Catalog

The optional user-owned JSON catalog has exact `schemaVersion: 1` and these
top-level keys only: `providers`, `models`, `roles`, `privacy`, `budgets`,
`discovery`, and `learning`.

- `providers` maps opaque aliases to a fixed `carrierId`, opaque account alias,
  typed execution surface (including `local_host`), locality, retention class,
  declared capability names, and (for this owner policy) a `harness` of
  `claude` or `codex`. A provider may also declare
  `availability:{"kind":"codex_config","section":"model_providers.<id>"}`;
  that source-owned local check is only a configuration-presence gate and is
  not callable evidence. The check applies only to the local destination;
  remote-scoped requests fail closed until their destination supplies
  host-scoped capability evidence.
- `models` maps opaque aliases to a provider alias, fixed `carrierId`, bounded
  requested model/family, effort(s), roles, optional `provider_latest_family`
  or `exact_pin` identity mode, optional numeric minimum generation,
  work-shape constraints, context-window and required-capability requirements,
  billing surface, current-family fallback set, rates, and
  `relativeCostIndex` from 1 through 1,000,000. Every rate has an HTTPS source
  URL, checked/effective timestamp, optional promotion expiry, a default
  30-day freshness limit, and an exact resolved-model digest, carrier/version,
  effort, and billing-surface binding.
  `efforts` declares supported choices; its order does not choose one. A
  multi-effort entry needs a request `effort` or a configured `effort` default,
  otherwise it returns `effort_selection_required`. A single-effort entry may
  use its sole value. Defaults must be deliberate policy choices, not inferred
  from a capability enumeration.
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

The [`example catalog`](model-routing.example.json) uses Sol medium for
ordinary substantive task work, with high and Astra escalation selected by task
need. These native selectors are advertised, with live execution unverified
until observed. Explicit
`model` requirements select matching catalog entries ahead of role-tier
preferences; the selected entry still has to satisfy its declared role,
privacy, harness, and capability restrictions. Unsupported requirements never
fall through to another entry. There are no invented relative prices, budget
limits, or automatic cross-family reviewers in the example.

Default role tiers can contain policy-authorized fallback candidates. A lower
tier selected after ineligibility is disclosed as
`configured_model_substitute`; refusal-gated substitutions
keep their more specific reasons. An explicit requested model cannot be
replaced by any of them. Review provenance must identify the model that
actually supplied the opinion. Same-model diversity is not cross-family
review; configure a supported independent reviewer deliberately when needed.

Provider `harness` and request `harness`/`crossHarnessReason` classify the
invocation, not availability. A different harness requires a concrete reason
and a supported adapter. Credentials, capabilities, and accounting do not
transfer merely because the model name is present.

GLM is unavailable as a strict route until a verified current selector and
supported effort can be bound to a callable adapter. Use GLM as a family name;
there is no verified stable latest-model alias, and a catalog label cannot
promise automatic upgrades. See the [Z.ai model guide](https://docs.z.ai/guides/llm/glm-5.3)
and [API model identifiers](https://docs.z.ai/api-reference/llm/chat-completion).

Configure `codex-6-sol` for ordinary substantive task work, `codex-6-luna` for
bounded work, and `codex-astra` for deliberate escalation. Validate the catalog
against the active execution surface before using its selected pairs.

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
to the Fable/Opus families, including full model IDs such as
`claude-fable-5-1`. Hyphenated and dotted generations compare numerically:
Fable 5.1 satisfies a minimum of 5.1; Fable 5 does not. Exact,
minimum-generation, and `current`
checks always preserve the family; a numeric version alone can never cross from
Fable to Opus or vice versa.

For Fable 5.1 on Claude Code, see the
[current surface controls](harness-model-invocation.md#claude-code-allocation).
The configured `claude-session-create` adapter maps to native `Agent`, whose
per-call model choices are family aliases. An exact model ID needs a supported
CLI route or authoritative subagent definition; the router must not emit an
unusable native model argument. Existing CE code/doc review adapters accept
the exact `claude-fable-5-1` selection and a supported effort through their
model/effort overrides. Respect each selected seam's controls; a peer-review
script's capabilities do not establish another workflow's support.

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
| `claude-session-create` | Claude Code `Agent` session | family-alias `model`; effort inherits or comes from the subagent definition | the stored v1 `banner-only` label is legacy metadata, not an effort control or proof |
| `native-subagent-message` | existing subagent message | none | `none` or `adjust_active`, never a fake spawn claim |
| `native-subagent-followup` | work-starting follow-up | none today; start a successor with `native-subagent-create` to change effort | fresh resolved route/inheritance only |
| `claude-cli-via-task` / `claude-cli-via-worker` | CE-owned Claude review path | selector controller/worker plus CE slot binding | composite controller and Claude-child accounting |
| `oracle-browser` | fixed Oracle browser advisor | fixed route | selected-route local attestation only |
| `oracle-homebrew-lifecycle` | fixed local Oracle lifecycle action | fixed lifecycle carrier | separate lifecycle claim; successful mutation requires a fresh review |

| Carrier | Transport and fixed facts | Availability truth |
| --- | --- | --- |
| `codex-6-sol` | `gpt-6-sol`, Low/Medium/High/Xhigh/Max/Ultra | advertised by native subagent creation and Codex task controls; live backend execution unverified |
| `codex-6-luna` | `gpt-6-luna`, Low/Medium/High/Xhigh/Max | advertised by native subagent creation and Codex task controls; live backend execution unverified |
| `codex-astra` | `gpt-6-astra`, Low/Medium/High/Xhigh/Max/Ultra | verified task selector and the available native-subagent escalation selector |
| `codex-daybreak-blue` | `gpt-daybreak-blue-latest`, Low/Medium/High/Xhigh/Max/Ultra | the strict configured path requires a fresh local availability cache |
| `claude-ce-review` | CE Claude `-p` review adapter | unsupported until the compatible CE adapter is attested |
| `oracle-browser` | `chatgpt_current_pro` channel on `chatgpt_standard` | Oracle v2 controls require their own current capability evidence |
| `oracle-homebrew-lifecycle` | local Oracle install/upgrade lifecycle | separate v2 lifecycle evidence and claim |

Supported efforts describe a surface, not a recommended effort for each model.
The catalog validates known carrier ranges, so Luna `ultra` is rejected.
Catalogs, native tools, CLI adapters, and browser models are
separate surfaces; validate the one that will execute the work. A current
native roster does not prove that an older configured adapter is available.

### Daybreak Blue local availability

OpenAI describes the public `daybreak-blue-latest` alias as a defensive
cybersecurity model with separate approval/provisioning, and its trusted-access
guidance scopes availability to the approved identity, organization/project,
offering, and product surface. See the [Daybreak model documentation](https://developers.openai.com/api/docs/models/daybreak-blue-latest)
and [Models and Trusted Access guidance](https://learn.chatgpt.com/docs/cyber-safety).
Railyard's owner-provisioned Codex selector is the distinct runtime string
`gpt-daybreak-blue-latest`; it never substitutes the public alias at runtime.

For a configured role whose selection needs the fixed Daybreak carrier,
the CLI obtains a local availability fact through the inspected App Server
surface: it starts only the fixed `codex app-server --stdio`, sends
`initialize`, and calls `model/list` with hidden models excluded. The probe
accepts only an exact visible `id` or `model` match for
`gpt-daybreak-blue-latest`, follows bounded pages, and retains no raw list.
This follows OpenAI's documented [App Server model-list method](https://learn.chatgpt.com/docs/app-server).

The validated availability record is exactly
`{"available":true|false|null,"checkedAt":"<ISO-8601>"}`. Its separate
state-level catalog-digest binding invalidates a legacy or policy-changed
record before it is reused. The availability record is fresh for 24 hours only
when its checked time is not in the future. A fresh positive
record makes the Daybreak candidate eligible for the local configured Daybreak
account. A remote host or different account does not probe. A missing, stale,
negative, or unknown record makes Daybreak ineligible; an explicitly configured
fallback may then be selected and disclosed, while an explicit Daybreak request
remains blocked. A stale eligible resolve refreshes under the existing private
state lock; an overlapping resolver or failed cache maintenance observes that
same ineligibility while the first refresh owns the one probe. A list failure records
`available:null` for the same TTL, so the resolver neither crashes nor
repeatedly probes. Resolves that do not select or reject Daybreak, and no-catalog resolves, do not probe or write
this cache. The optional availability field is state-schema v5; readers
migrate a v4 state without the cache before validating it. One state document
permits only one Daybreak provider, and the catalog's content digest—not just
its timestamp—must match before reuse; these two boundaries keep the
two-field fact tied to the one local App Server account. Daybreak's absence is a standard-
candidate-ineligibility result, not a user-facing entitlement warning.

The cache says only that this local Codex model list exposed the selector at a
checked time. It does not prove authorization for a particular task, live
carrier behavior, model output, or a successful security canary.

A loopback bridge does not establish local inference, provider entitlement, or
live usage proof. Model and effort require current adapter evidence.

The public stdin CLI has a closed receipt bridge only for `oracle-browser` and
`oracle-homebrew-lifecycle`. It accepts a `receiptId` reference matching a
private artifact below the canonical user state root. It does not accept
Codex/native receipt JSON, app-tool evidence, a callback, module path,
executable, command, or adapter hook. Apart from the narrow local Daybreak
cache refresh, `resolve` evaluates the installed policy catalog and returns its
selected route; that is a planning result, not callable evidence. Public admission and settlement of
configured visible-task and native routes therefore return
`transport_unsupported`; a trusted in-process embedding may supply the closed
authority attestor and receipt importer.

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
enforcement for that meter. **`strict` is reserved:** no carrier declares
`enforcedMeters` today, because none can genuinely attest per-meter enforcement,
so every strict meter refuses with `strict_limit_unenforceable`. That is the
intended fail-closed answer — a strict limit nobody enforces must not admit
work. Use `hardAdmission` for limits meant to bind now.
Hard/strict meters cannot omit a forecast. The
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
`gpt_sol`, `opus`, `fable`, `sonnet`, `haiku`, and `oracle`. Their closed instructions use,
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

It exercises catalog and state validation, the Daybreak positive/negative/
unknown 24-hour cache path, Sol medium defaults, explicit pair preservation,
native/provider capability boundaries, catalog role constraints, reason-class
negative caches, learning limits, R28 decision/settlement/replay disclosure,
authority and bridge identity binding, work-class/action-receipt invariants,
all seven metadata presentation overlays, terminal/epoch transitions, protected
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
| plan research/deepening helper | claimed `codex-6-sol` task route with the selected effort | the ordinary CE research/evidence artifact |
| debug bounded investigation helper | claimed `codex-6-sol` task route with the selected effort | the ordinary CE investigation input/evidence artifact |
| already-legitimized bounded execution step | claimed `codex-6-sol` or `codex-6-luna` task route with the selected effort | the ordinary CE executor outcome artifact |
| code/doc/POV/PR read-only review seam | claimed `claude-ce-review` through its supported CE Claude `-p` path, or Oracle only where the closed role/carrier pair permits it | the ordinary seam-specific review receipt/findings artifact |

A configured `review.cross_family` role asks another model family for an
independent opinion. Within this CE seam, use its supported Fable/Opus review
adapter and the selected model and effort. A catalog alias does not establish
that the reviewer is callable, and same-family review must not be labeled
cross-family evidence.

If the owner configures Daybreak Blue as a same-family refusal substitute,
gate it with
`afterRefusalOnly` on its tier. The trigger is an explicit signal, never
inference: the caller re-resolves with the refused alias in `refusedAliases`,
and without that the tier stays shut with `refusal_required`. This matters
because tier order alone would fire whenever the top carrier was merely
UNAVAILABLE, silently answering a cross-family question with a same-family
review.

The resulting decision carries `fallback.reason: "review_refusal_substitute"`,
which must reach the artifact. Per `provider-task-routing.md`, a substitute
carrier's review is evidence about the code but never review evidence for the
routed model, and any authorized same-model retry remains with the owning review workflow.

Preserve CE workflow, persona, plan/legitimacy and root-cause authority,
canonical writer, review/validator/merge authority, least-privilege tooling,
security boundaries, verification, artifact schema, and terminal state. The AU
replacement may not create nested children, elevate reasoning, choose a new
model/fallback, commit/push/merge, mutate external systems, add credentials, or
expand filesystem/network scope.

For Claude, use only the supported CE-owned `claude -p` adapter bound to the
claimed slot. Railyard's deliver skill does not construct an alternate Claude
command or supervisor. If the selected path or CE seam is
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
is `chatgpt_standard`. The v2 browser adapter uses Oracle 0.20.3 or later,
explicit `gpt-6-pro`, the Latest picker, and verified Pro thinking. Browser Pro
is distinct from a native Astra allocation. V1 Sol capability records cannot attest this
v2 control set. Historical v1 records remain readable and retain their original
accounting and provenance; status marks their capability stale. Attempting to
claim, inspect for dispatch, or reconcile them through the v2 adapter returns
`adapter_version_changed`. Do not rewrite the old model identity or discard
an outstanding liability to manufacture a new route. A new route requires a
fresh decision and the corresponding v2 evidence. Browser auth can remain `unknown` for one policy-admitted
normal attempt. A login/account-selection result is
`auth_context_unavailable`: stop without interaction, credential changes, or
API fallback. `oracle-api` is unsupported by this contract.
