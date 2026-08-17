/**
 * Frozen contract data: version constants, bounds, closed vocabularies, and
 * the fixed adapter/carrier/CE-seam descriptors. No behaviour lives here —
 * catalog data may reference these identifiers but never define one.
 */

export const CONTRACT_VERSION = "railyard/model-routing/v1";

export const CATALOG_SCHEMA_VERSION = 1;

export const STATE_SCHEMA_VERSION = 5;

export const STATE_PURPOSE = "railyard/model-routing-state";

export const MAX_JSON_BYTES = 256 * 1024;

export const MAX_STATE_BYTES = 1024 * 1024;

export const MAX_DEPTH = 8;

// R28 receipts are deliberately structured (rather than opaque blobs).  The
// state-byte ceiling remains the primary storage bound; this count must still
// accommodate a small number of complete receipts without rejecting valid
// state merely for exposing the required provenance fields.
export const MAX_ENTRIES = 4_096;

export const MAX_STRING = 256;

export const MAX_OUTCOMES = 200;

export const MAX_AGGREGATES = 256;

export const MAX_LEASES = 256;

export const MAX_LEASE_SLOTS = 32;

export const MAX_SESSION_ID = 64;

export const MAX_TOOL_VERSION = 32;

export const MAX_CONTEXT_FORK_TURNS = 999;

export const MAX_LEARNING_SAMPLE_INFLUENCE = 0.2;

export const LEARNING_SAMPLE_FLOOR = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const SETTLEMENT_HEADROOM_BYTES = 64 * 1024;

export const ELIGIBLE_RETENTION_MS = 7 * DAY_MS;

// A lock older than this whose pid is gone is a crash residue, not contention.
export const STATE_LOCK_TTL_MS = 60 * 1000;

export const DEFAULT_RATE_STALE_MS = 30 * DAY_MS;

export const DEFAULT_POSITIVE_TTL_MS = DAY_MS;

export const DEFAULT_NEGATIVE_TTL_MS = 5 * 60 * 1000;

export const DEFAULT_RETRY_AFTER_MAX_SECONDS = 60 * 60;

export const NEGATIVE_TTL_DEFAULTS = freeze({
  transient: 60,
  auth: 5 * 60,
  missing_binary: 60 * 60,
  unsupported: 24 * 60 * 60,
});

export const NEGATIVE_REASON_CLASS = freeze({
  transient: "transient",
  transient_failure: "transient",
  carrier_unavailable: "transient",
  oracle_failed: "transient",
  oracle_observed_model_unavailable: "transient",
  oracle_observed_pro_effort_unavailable: "transient",
  auth: "auth",
  auth_context_unavailable: "auth",
  missing_binary: "missing_binary",
  oracle_not_installed: "missing_binary",
  adapter_binary_missing: "missing_binary",
  unsupported_adapter: "unsupported",
  oracle_observed_model_mismatch: "unsupported",
  receipt_importer_unsupported: "unsupported",
});

export const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export const ROLE_RE = /^[a-z][a-z0-9_.-]{0,63}$/;

export const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

export const DIGEST_RE = /^[a-f0-9]{64}$/;

export const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

// Oracle is its own harness, not a flavour of codex: the oracle-* carriers ship
// here but had no harness value to be attributed to, so every oracle route was
// rejected "harness_unattributed" the moment a request declared a harness.
// Naming it also makes codex->oracle correctly demand a crossHarnessReason.
export const HARNESS_KINDS = new Set(["claude", "codex", "oracle"]);

export const SOFT_PRIORITIES = new Set(["cost", "latency", "quality", "reliability", "learnedEstimate"]);

export const LOCALITY_RANK = freeze({ local_only: 0, same_region: 1, external: 2 });

export const RETENTION_RANK = freeze({ none: 0, ephemeral: 1, provider_default: 2 });

export const TRUSTED_RECEIPT_IMPORTER_ID = "railyard-adapter-receipt-importer-v1";

export const TRUSTED_RECEIPT_IMPORTER_VERSION = "v1";

export const SHAPE_FIELDS = Object.freeze([
  "ambiguity",
  "novelty",
  "repetition",
  "decomposability",
  "unitVolume",
  "semanticRisk",
  "verificationStrength",
]);

export const SHAPE_VALUES = new Set(["low", "medium", "high", "unknown"]);

export const CALLER_KINDS = new Set([
  "compound-engineering",
  "orchestrate",
  "deliver",
  "thermos",
  "fleet",
]);

export const DISPATCH_KINDS = new Set([
  "task_create",
  "task_message",
  "subagent_create",
  "subagent_message",
  "subagent_followup",
  "lifecycle_action",
]);

export const BUDGET_EFFECTS = new Set(["start", "adjust_active", "none"]);

export const EXECUTION_SURFACES = new Set([
  "codex",
  "chatgpt_standard",
  "provider_api",
  "provider_subscription",
  "local",
  "local_host",
]);

export const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export const ACTIVE_CLAIM_PHASES = new Set(["claimed", "started", "ambiguous"]);

export const POSITIVE_CAPABILITY_STATES = new Set(["host_capability_attested", "live_carrier_verified"]);

export const NEGATIVE_CAPABILITY_STATES = new Set(["unavailable", "unknown"]);

export const RECEIPT_STATUSES = new Set(["started", "settled", "no_start", "ambiguous", "bridge_acknowledged"]);

// Public CLI receipt handling is a closed local Oracle bridge. Catalog data
// cannot add an importer or make an arbitrary executable/callback part of it.
export const FIXED_CLI_RECEIPT_PRODUCERS = new Set([
  "oracle-browser",
  "oracle-homebrew-lifecycle",
]);

export const CONTROLLER_ORIGINATORS = new Set(["user", "user_message", "explicit_user_instruction"]);

export const ACTION_RECEIPT_SCHEMA = "railyard/action-receipt/v1";

export const INVARIANT_WORK_CONTRACT_SCHEMA = "railyard/invariant-work-contract/v1";

export const R52_READINESS_SCHEMA = "railyard/r52-readiness/v1";

export const R52_READINESS_STATES = new Set(["ready", "blocked", "unknown"]);

export const R52_PLATFORM_CLASSES = new Set(["darwin", "linux", "windows", "wsl", "unknown"]);

export const ACTION_RECEIPT_REASONS = new Set(["budget_neutral_message", "active_budget_top_up"]);

export const ACTION_INHERITANCE_REASONS = new Set(["not_applicable", "intentional_same_class_inheritance"]);

export const ACTION_FALLBACK_REASONS = new Set(["not_applicable", "implementation_model_substitute", "higher_ranked_candidate_cannot_fit_hard_constraint"]);

export const FIXED_LOCAL_PROBE_ATTESTOR = "railyard-fixed-local-probe-v1";

export const HOST_CAPABILITY_ATTESTOR = "railyard-host-attestor-v1";

export const ADAPTER_RECEIPT_ATTESTOR = "railyard-adapter-receipt-attestor-v1";

export const TASK_AUTHORITY_ATTESTOR = "railyard-task-authority-attestor-v1";

export const TRANSPORT_ATTESTOR = "railyard-transport-attestor-v1";

export const RUNTIME_ATTESTOR = "railyard-runtime-attestor-v1";

export const CE_SEAMS = freeze({
  "ce-plan.execution": freeze({ skill: "ce-plan", artifactSchema: "railyard/ce-plan-execution-input/v1", roles: ["research", "investigation", "implementation", "implementation.bounded_fix"], carriers: ["glm-5-2-scout", "glm-5-2-engineer", "codex-luna"] }),
  "ce-work.execution": freeze({ skill: "ce-work", artifactSchema: "railyard/ce-work-execution-input/v1", roles: ["implementation", "implementation.bounded_fix", "implementation.mechanical"], carriers: ["glm-5-2-engineer", "codex-luna"] }),
  "ce-debug.execution": freeze({ skill: "ce-debug", artifactSchema: "railyard/ce-debug-diagnosis/v1", roles: ["investigation", "research"], carriers: ["codex-daybreak-blue", "glm-5-2-scout", "codex-luna"] }),
  "ce-code-review.execution": freeze({ skill: "ce-code-review", artifactSchema: "railyard/ce-code-review-findings/v1", roles: ["review.code", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-doc-review.execution": freeze({ skill: "ce-doc-review", artifactSchema: "railyard/ce-doc-review-findings/v1", roles: ["review.plan", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-pov.execution": freeze({ skill: "ce-pov", artifactSchema: "railyard/ce-pov-review/v1", roles: ["review.cross_family", "review.architecture"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-pr-review.execution": freeze({ skill: "ce-babysit-pr", artifactSchema: "railyard/ce-pr-review-findings/v1", roles: ["review.code", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
});

export const MUTATING_COMMANDS = new Set([
  "admit",
  "claim-dispatch",
  "reconcile",
  "refresh",
  "mint-task-authority",
  "issue-lease",
  "accept-lease",
  "claim-slot",
  "seal-epoch",
  "release-lease",
  "learning.clear",
  "learning.disable",
  "learning.enable",
]);

export function freeze(value) {
  return Object.freeze(value);
}

export const ADAPTER_DESCRIPTORS = freeze({
  "codex-task-create": freeze({
    version: "v1",
    dispatchKinds: ["task_create"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ model: "model", effort: "thinking" }),
    visibleTask: true,
    requiresTaskAuthority: true,
    receiptProducer: "codex-task",
  }),
  "codex-task-message": freeze({
    version: "v1",
    dispatchKinds: ["task_message"],
    budgetEffect: "request-classified",
    startsWork: "request-classified",
    startsWorkByBudgetEffect: freeze({ none: false, adjust_active: true }),
    controls: freeze({ model: "model", effort: "thinking" }),
    visibleTask: true,
    receiptProducer: "codex-task",
  }),
  "configured-profile-task-create": freeze({
    version: "v1",
    dispatchKinds: ["task_create"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ profile: "carrier-owned" }),
    visibleTask: true,
    requiresTaskAuthority: true,
    requiresCallableAttestation: true,
    receiptProducer: "configured-profile-task",
  }),
  "native-subagent-create": freeze({
    version: "v1",
    dispatchKinds: ["subagent_create"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ model: "model", effort: "reasoning_effort" }),
    contextFork: "none-or-bounded-turn-count",
    receiptProducer: "native-subagent",
  }),
  "native-subagent-message": freeze({
    version: "v1",
    dispatchKinds: ["subagent_message"],
    budgetEffect: "request-classified",
    startsWork: "request-classified",
    startsWorkByBudgetEffect: freeze({ none: false, adjust_active: true }),
    controls: freeze({}),
    receiptProducer: "native-subagent",
  }),
  "native-subagent-followup": freeze({
    version: "v1",
    dispatchKinds: ["subagent_followup"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({}),
    receiptProducer: "native-subagent",
  }),
  "claude-cli-via-task": freeze({
    version: "v1",
    dispatchKinds: ["task_create", "task_message"],
    budgetEffect: "start",
    startsWork: true,
    composite: true,
    controls: freeze({ controllerModel: "model", controllerEffort: "thinking", claudeBinding: "ce-slot" }),
    visibleTask: true,
    requiresTaskAuthority: true,
    receiptProducer: "ce-claude-review",
  }),
  "claude-cli-via-worker": freeze({
    version: "v1",
    dispatchKinds: ["subagent_create"],
    budgetEffect: "start",
    startsWork: true,
    composite: true,
    controls: freeze({ workerModel: "model", workerEffort: "reasoning_effort", claudeBinding: "ce-slot" }),
    receiptProducer: "ce-claude-review",
  }),
  "claude-session-create": freeze({
    version: "v1",
    dispatchKinds: ["subagent_create"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ model: "model", effort: "banner-only" }),
    receiptProducer: "native-subagent",
  }),
  "oracle-browser": freeze({
    version: "v1",
    dispatchKinds: ["subagent_create"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ carrier: "fixed" }),
    receiptProducer: "oracle-browser",
  }),
  "oracle-homebrew-lifecycle": freeze({
    version: "v1",
    dispatchKinds: ["lifecycle_action"],
    budgetEffect: "start",
    startsWork: true,
    controls: freeze({ carrier: "fixed", lifecycle: "homebrew" }),
    receiptProducer: "oracle-homebrew-lifecycle",
  }),
});

/** Fixed executors; catalog data may reference these IDs but never define one. */
export const CARRIER_DESCRIPTORS = freeze({
  "codex-luna": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: "gpt-5.6-luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["implementation", "implementation.fix", "implementation.mechanical", "implementation.medium", "implementation.long-running", "implementation.cross-harness"],
  }),
  "codex-sol": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: "gpt-5.6-sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["investigation", "research", "orchestration", "review", "review.code", "review.plan", "review.primary", "review.cross_family", "review.deep", "review.architecture", "review.long_context", "review.adversarial", "implementation.hard", "security.review", "security.threat-model", "security.trust", "security.redaction", "security.signing", "security.attack-shape", "security.audit"],
  }),
  "codex-daybreak-blue": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: "gpt-daybreak-blue-latest",
    executionSurface: "codex",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    // The review.deep family is Oracle's specialty, but Oracle is a browser
    // carrier behind a callable attestation and a cross-harness opt-in.  Without
    // an in-harness fallback those roles resolve to nothing whenever Oracle is
    // not attested, so Daybreak carries them too - matching its standing
    // preference for deep technical work.
    roles: ["investigation", "research", "review", "review.code", "review.deep", "review.architecture", "review.long_context", "review.adversarial", "security.review", "security.threat-model", "security.trust", "security.redaction", "security.signing", "security.attack-shape", "security.audit"],
  }),
  "codex-terra-runtime": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: null,
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["implementation", "implementation.fix", "implementation.mechanical", "implementation.medium", "implementation.long-running"],
    runtimeVerifiedOnly: true,
  }),
  "glm-5-2-scout": freeze({
    version: "v1",
    transport: "separate-task-profile",
    requestedModel: "glm-5.2",
    efforts: ["high"],
    adapters: ["configured-profile-task-create"],
    roles: ["research", "investigation", "review.secondary"],
    fixedProfile: "glm-5-2-scout",
    contextLimit: 200000,
    requiresCallableAttestation: true,
    cooperativeOnly: true,
  }),
  "glm-5-2-engineer": freeze({
    version: "v1",
    transport: "separate-task-profile",
    requestedModel: "glm-5.2",
    efforts: ["xhigh"],
    adapters: ["configured-profile-task-create"],
    roles: ["implementation.mechanical", "implementation.bounded_fix", "implementation.cross-harness"],
    fixedProfile: "glm-5-2-engineer",
    contextLimit: 200000,
    requiresCallableAttestation: true,
    cooperativeOnly: true,
  }),
  "claude-ce-review": freeze({
    version: "v1",
    transport: "claude-cli-via-ce",
    requestedModel: null,
    efforts: ["high", "xhigh", "max"],
    adapters: ["claude-cli-via-task", "claude-cli-via-worker"],
    roles: ["review.cross_family", "review.code", "review.plan"],
    requiresCallableAttestation: true,
    externalEgress: true,
    modelFamily: "claude",
  }),
  "claude-session": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: null,
    efforts: ["low", "medium", "high", "xhigh", "max"],
    adapters: ["claude-session-create"],
    // Review roles deliberately do NOT belong here.  references/model-routing.md
    // fixes the Claude review seam to the claimed `claude-ce-review` CE adapter,
    // which binds a review to a compound-engineering artifact digest and returns
    // bound findings.  Putting review on the plain session carrier would let the
    // resolver pick `claude-session-create` with no ceSeam and no callable
    // capability attestation - a bare agent session treated as an authorized
    // review route, with no receipt enforcement behind it.  A Claude session
    // that wants an in-family review goes through the CE adapter; the fact that
    // this is less convenient is the point of the attestation, not a gap in it.
    roles: ["implementation", "implementation.hard", "implementation.medium", "implementation.long-running", "implementation.mechanical", "implementation.bounded_fix"],
    modelFamily: "claude",
  }),
  "oracle-browser": freeze({
    version: "v1",
    transport: "browser-advisor",
    requestedModel: "chatgpt_current_pro",
    executionSurface: "chatgpt_standard",
    efforts: ["high", "max"],
    adapters: ["oracle-browser"],
    roles: ["review.deep", "review.architecture", "review.long_context", "review.adversarial"],
    requiresCallableAttestation: true,
    externalEgress: true,
  }),
  "oracle-homebrew-lifecycle": freeze({
    version: "v1",
    transport: "local-lifecycle",
    requestedModel: "oracle-homebrew-lifecycle",
    executionSurface: "local_host",
    efforts: ["high"],
    adapters: ["oracle-homebrew-lifecycle"],
    roles: ["lifecycle.oracle"],
    requiresCallableAttestation: true,
    cooperativeOnly: true,
  }),
});

export const DEFAULT_POLICY = freeze({
  digest: "builtin-model-routing-v1",
  source: "config-default",
});

export const PRESENTATION_OVERLAYS = freeze({
  gpt_sol: freeze({ id: "gpt_sol", format: "lean_bounded_brief", instructions: freeze([
    "Use a lean, explicit, bounded brief with the objective, scope, acceptance evidence, and stop condition.",
  ]) }),
  opus: freeze({ id: "opus", format: "complete_task_specification", instructions: freeze([
    "Present the complete task specification with explicit scope, delegation limits, progress limits, acceptance evidence, and stop condition.",
  ]) }),
  fable: freeze({ id: "fable", format: "autonomous_long_run_brief", instructions: freeze([
    "State autonomy and pause boundaries, require evidence-grounded progress, and preserve compact long-run memory through the stop condition.",
  ]) }),
  sonnet: freeze({ id: "sonnet", format: "balanced_implementation_brief", instructions: freeze([
    "State the bounded objective, relevant context, verification evidence, and stop condition with proportional detail.",
  ]) }),
  haiku: freeze({ id: "haiku", format: "mechanical_task_brief", instructions: freeze([
    "State the exact mechanical change, its smallest verification check, and the stop condition.",
  ]) }),
  glm: freeze({ id: "glm", format: "repository_engineering_brief", instructions: freeze([
    "State repository standards and boundaries, the plan, expected impact and risks, verification evidence, and the stop condition.",
  ]) }),
  oracle: freeze({ id: "oracle", format: "self_contained_one_shot_brief", instructions: freeze([
    "Provide one self-contained briefing with the complete selected file context, acceptance evidence, and stop condition.",
  ]) }),
});

export const DISCLOSURE_PROVENANCE = new Set([
  "request",
  "catalog",
  "capability_attestation",
  "adapter_receipt",
  "reservation",
  "router_calculation",
  "learned_estimate",
  "measured_fact",
  "unknown",
  "not_applicable",
]);
