#!/usr/bin/env node

/**
 * The model-routing contract is deliberately a policy/state primitive.  It
 * never creates a task, starts a provider process, or reads an installed
 * plugin cache.  Callers use its claimed decision with their own fixed
 * adapter, then return a trusted adapter receipt for reconciliation.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_VERSION = "yardmaster/model-routing/v1";
export const CATALOG_SCHEMA_VERSION = 1;
export const STATE_SCHEMA_VERSION = 4;
export const STATE_PURPOSE = "yardmaster/model-routing-state";

const MAX_JSON_BYTES = 256 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_DEPTH = 8;
// R28 receipts are deliberately structured (rather than opaque blobs).  The
// state-byte ceiling remains the primary storage bound; this count must still
// accommodate a small number of complete receipts without rejecting valid
// state merely for exposing the required provenance fields.
const MAX_ENTRIES = 4_096;
const MAX_STRING = 256;
const MAX_OUTCOMES = 200;
const MAX_AGGREGATES = 256;
const MAX_LEASES = 256;
const MAX_LEASE_SLOTS = 32;
const MAX_SESSION_ID = 64;
const MAX_TOOL_VERSION = 32;
const MAX_CONTEXT_FORK_TURNS = 999;
const MAX_LEARNING_SAMPLE_INFLUENCE = 0.2;
const LEARNING_SAMPLE_FLOOR = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const SETTLEMENT_HEADROOM_BYTES = 64 * 1024;
const ELIGIBLE_RETENTION_MS = 7 * DAY_MS;
const DEFAULT_RATE_STALE_MS = 30 * DAY_MS;
const DEFAULT_POSITIVE_TTL_MS = DAY_MS;
const DEFAULT_NEGATIVE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_AFTER_MAX_SECONDS = 60 * 60;
const NEGATIVE_TTL_DEFAULTS = freeze({
  transient: 60,
  auth: 5 * 60,
  missing_binary: 60 * 60,
  unsupported: 24 * 60 * 60,
});
const NEGATIVE_REASON_CLASS = freeze({
  transient: "transient",
  transient_failure: "transient",
  carrier_unavailable: "transient",
  oracle_failed: "transient",
  auth: "auth",
  auth_context_unavailable: "auth",
  missing_binary: "missing_binary",
  oracle_not_installed: "missing_binary",
  adapter_binary_missing: "missing_binary",
  unsupported_adapter: "unsupported",
  receipt_importer_unsupported: "unsupported",
});
const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const ROLE_RE = /^[a-z][a-z0-9_.-]{0,63}$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const SOFT_PRIORITIES = new Set(["cost", "latency", "quality", "reliability", "learnedEstimate"]);
const LOCALITY_RANK = freeze({ local_only: 0, same_region: 1, external: 2 });
const RETENTION_RANK = freeze({ none: 0, ephemeral: 1, provider_default: 2 });
const TRUSTED_RECEIPT_IMPORTER_ID = "yardmaster-adapter-receipt-importer-v1";
const TRUSTED_RECEIPT_IMPORTER_VERSION = "v1";
const SHAPE_FIELDS = Object.freeze([
  "ambiguity",
  "novelty",
  "repetition",
  "decomposability",
  "unitVolume",
  "semanticRisk",
  "verificationStrength",
]);
const SHAPE_VALUES = new Set(["low", "medium", "high", "unknown"]);
const CALLER_KINDS = new Set([
  "compound-engineering",
  "task-orchestrator",
  "goal-driven-delivery",
  "thermos",
  "fleet",
]);
const DISPATCH_KINDS = new Set([
  "task_create",
  "task_message",
  "subagent_create",
  "subagent_message",
  "subagent_followup",
  "lifecycle_action",
]);
const BUDGET_EFFECTS = new Set(["start", "adjust_active", "none"]);
const EXECUTION_SURFACES = new Set([
  "codex",
  "chatgpt_standard",
  "provider_api",
  "provider_subscription",
  "local",
  "local_host",
]);
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ACTIVE_CLAIM_PHASES = new Set(["claimed", "started", "ambiguous"]);
const POSITIVE_CAPABILITY_STATES = new Set(["host_capability_attested", "live_carrier_verified"]);
const NEGATIVE_CAPABILITY_STATES = new Set(["unavailable", "unknown"]);
const RECEIPT_STATUSES = new Set(["started", "settled", "no_start", "ambiguous", "bridge_acknowledged"]);
// Public CLI receipt handling is a closed local Oracle bridge. Catalog data
// cannot add an importer or make an arbitrary executable/callback part of it.
const FIXED_CLI_RECEIPT_PRODUCERS = new Set([
  "oracle-browser",
  "oracle-homebrew-lifecycle",
]);
const CONTROLLER_ORIGINATORS = new Set(["user", "user_message", "explicit_user_instruction"]);
const ACTION_RECEIPT_SCHEMA = "yardmaster/action-receipt/v1";
const INVARIANT_WORK_CONTRACT_SCHEMA = "yardmaster/invariant-work-contract/v1";
const R52_READINESS_SCHEMA = "yardmaster/r52-readiness/v1";
const R52_READINESS_STATES = new Set(["ready", "blocked", "unknown"]);
const R52_PLATFORM_CLASSES = new Set(["darwin", "linux", "windows", "wsl", "unknown"]);
const ACTION_RECEIPT_REASONS = new Set(["budget_neutral_message", "active_budget_top_up"]);
const ACTION_INHERITANCE_REASONS = new Set(["not_applicable", "intentional_same_class_inheritance"]);
const ACTION_FALLBACK_REASONS = new Set(["not_applicable", "implementation_model_substitute", "higher_ranked_candidate_cannot_fit_hard_constraint"]);
const FIXED_LOCAL_PROBE_ATTESTOR = "yardmaster-fixed-local-probe-v1";
const HOST_CAPABILITY_ATTESTOR = "yardmaster-host-attestor-v1";
const ADAPTER_RECEIPT_ATTESTOR = "yardmaster-adapter-receipt-attestor-v1";
const TASK_AUTHORITY_ATTESTOR = "yardmaster-task-authority-attestor-v1";
const TRANSPORT_ATTESTOR = "yardmaster-transport-attestor-v1";
const RUNTIME_ATTESTOR = "yardmaster-runtime-attestor-v1";
const CE_SEAMS = freeze({
  "ce-plan.execution": freeze({ skill: "ce-plan", artifactSchema: "yardmaster/ce-plan-execution-input/v1", roles: ["research", "investigation", "implementation", "implementation.bounded_fix"], carriers: ["glm-5-2-scout", "glm-5-2-engineer", "codex-luna"] }),
  "ce-work.execution": freeze({ skill: "ce-work", artifactSchema: "yardmaster/ce-work-execution-input/v1", roles: ["implementation", "implementation.bounded_fix", "implementation.mechanical"], carriers: ["glm-5-2-engineer", "codex-luna"] }),
  "ce-debug.execution": freeze({ skill: "ce-debug", artifactSchema: "yardmaster/ce-debug-diagnosis/v1", roles: ["investigation", "research"], carriers: ["glm-5-2-scout", "codex-luna"] }),
  "ce-code-review.execution": freeze({ skill: "ce-code-review", artifactSchema: "yardmaster/ce-code-review-findings/v1", roles: ["review.code", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-doc-review.execution": freeze({ skill: "ce-doc-review", artifactSchema: "yardmaster/ce-doc-review-findings/v1", roles: ["review.plan", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-pov.execution": freeze({ skill: "ce-pov", artifactSchema: "yardmaster/ce-pov-review/v1", roles: ["review.cross_family", "review.architecture"], carriers: ["claude-ce-review", "oracle-browser"] }),
  "ce-pr-review.execution": freeze({ skill: "ce-babysit-pr", artifactSchema: "yardmaster/ce-pr-review-findings/v1", roles: ["review.code", "review.cross_family"], carriers: ["claude-ce-review", "oracle-browser"] }),
});
const MUTATING_COMMANDS = new Set([
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

function freeze(value) {
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
    efforts: ["max"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["implementation", "implementation.fix", "implementation.mechanical"],
    implementationEngine: freeze({ mode: "require", target: "codex", model: "gpt-5.6-luna", source: "goal-driven-delivery" }),
  }),
  "codex-sol": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: "gpt-5.6-sol",
    efforts: ["high", "max"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["orchestration", "review", "review.code", "review.plan", "review.primary"],
  }),
  "codex-terra-runtime": freeze({
    version: "v1",
    transport: "selector-native",
    requestedModel: null,
    efforts: ["max"],
    adapters: ["codex-task-create", "codex-task-message", "native-subagent-create", "native-subagent-message", "native-subagent-followup"],
    roles: ["implementation", "implementation.fix", "implementation.mechanical"],
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
    roles: ["implementation.mechanical", "implementation.bounded_fix"],
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

const DEFAULT_POLICY = freeze({
  digest: "builtin-model-routing-v1",
  source: "config-default",
});

function nowIso(now) {
  return new Date(now).toISOString();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownEntries(value) {
  return isObject(value) ? Object.entries(value) : [];
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function opaqueId(prefix, value) {
  return `${prefix}_${stableDigest(value).slice(0, 24)}`;
}

function result(ok, reason, fields = {}) {
  return { contractVersion: CONTRACT_VERSION, ok, reason, ...fields };
}

function error(reason, details = {}) {
  return result(false, reason, details);
}

function hasControl(value) {
  return typeof value === "string" && /[\u0000-\u001f\u007f]/.test(value);
}

function walkBounded(value, state, depth = 0) {
  if (depth > MAX_DEPTH) return "input_too_deep";
  if (typeof value === "string") {
    if (value.length > MAX_STRING) return "string_too_long";
    if (hasControl(value)) return "control_character";
    return null;
  }
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : "nonfinite_number";
  if (Array.isArray(value)) {
    state.count += value.length;
    if (state.count > MAX_ENTRIES) return "too_many_entries";
    for (const item of value) {
      const issue = walkBounded(item, state, depth + 1);
      if (issue) return issue;
    }
    return null;
  }
  if (!isObject(value)) return "invalid_json_value";
  const entries = Object.entries(value);
  state.count += entries.length;
  if (state.count > MAX_ENTRIES) return "too_many_entries";
  for (const [key, item] of entries) {
    if (RESERVED_KEYS.has(key)) return "reserved_key";
    if (key.length > MAX_STRING || hasControl(key)) return "invalid_key";
    const issue = walkBounded(item, state, depth + 1);
    if (issue) return issue;
  }
  return null;
}

function boundedIssue(value) {
  return walkBounded(value, { count: 0 });
}

function validId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

function validRole(value) {
  return typeof value === "string" && ROLE_RE.test(value);
}

function validModel(value) {
  return typeof value === "string" && MODEL_RE.test(value) && !value.startsWith("-") && !value.includes("/") && !value.includes("\\") && !value.includes("@") && !value.includes("--");
}

function validDigest(value) {
  return typeof value === "string" && DIGEST_RE.test(value);
}

function validControllerValue(value) {
  // Codex thread IDs can be UUID-like and therefore need not satisfy the
  // router's lower-case opaque-ID grammar. They are still bounded, printable,
  // and never accepted from a request as a trust decision.
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function validControllerRuntime(value) {
  return isObject(value)
    && onlyFields(value, new Set(["threadId", "permissionProfile", "originator"]))
    && validControllerValue(value.threadId)
    && validControllerValue(value.permissionProfile)
    && CONTROLLER_ORIGINATORS.has(value.originator);
}

function controllerIdentityDigest(value) {
  return stableDigest({
    threadId: value.threadId,
    permissionProfile: value.permissionProfile,
    originator: value.originator,
  });
}

function sameControllerRuntime(left, right) {
  return validControllerRuntime(left)
    && validControllerRuntime(right)
    && left.threadId === right.threadId
    && left.permissionProfile === right.permissionProfile
    && left.originator === right.originator;
}

function validEffort(value) {
  return EFFORTS.has(value);
}

function validShape(shape) {
  if (shape === undefined) return null;
  if (!isObject(shape)) return "invalid_work_shape";
  for (const [key, value] of ownEntries(shape)) {
    if (!SHAPE_FIELDS.includes(key) || !SHAPE_VALUES.has(value)) return "invalid_work_shape";
  }
  return null;
}

function validContextFork(value) {
  return value === undefined
    || value === "none"
    || (typeof value === "string" && /^[1-9]\d{0,2}$/.test(value) && Number(value) <= MAX_CONTEXT_FORK_TURNS);
}

function validR52ReadinessFact(value) {
  return isObject(value)
    && onlyFields(value, new Set(["state", "evidenceDigest"]))
    && R52_READINESS_STATES.has(value.state)
    && validDigest(value.evidenceDigest);
}

function validR52PlatformIdentity(value) {
  return isObject(value)
    && onlyFields(value, new Set(["identityDigest", "platform"]))
    && validDigest(value.identityDigest)
    && R52_PLATFORM_CLASSES.has(value.platform);
}

function validR52Readiness(value) {
  return isObject(value)
    && onlyFields(value, new Set(["schema", "hostReadiness", "taskReadiness", "transportReadiness", "executionHost", "targetPlatform"]))
    && value.schema === R52_READINESS_SCHEMA
    && validR52ReadinessFact(value.hostReadiness)
    && validR52ReadinessFact(value.taskReadiness)
    && validR52ReadinessFact(value.transportReadiness)
    && validR52PlatformIdentity(value.executionHost)
    && validR52PlatformIdentity(value.targetPlatform);
}

function r52Ready(value) {
  return validR52Readiness(value)
    && [value.hostReadiness, value.taskReadiness, value.transportReadiness].every((fact) => fact.state === "ready");
}

function r52Binding(value) {
  if (!validR52Readiness(value)) return null;
  return { ...clone(value), digest: stableDigest(value) };
}

function validR52Binding(value) {
  if (!isObject(value) || !onlyFields(value, new Set(["schema", "hostReadiness", "taskReadiness", "transportReadiness", "executionHost", "targetPlatform", "digest"])) || !validDigest(value.digest)) return false;
  const { digest, ...readiness } = value;
  return validR52Readiness(readiness) && digest === stableDigest(readiness);
}

function normalizedWorkClassShape(shape = {}) {
  return Object.fromEntries(SHAPE_FIELDS.map((field) => [field, shape[field] || "unknown"]));
}

function derivedWorkClassDigest(request) {
  return stableDigest({
    schema: "yardmaster/work-class/v1",
    role: request.role || "unknown",
    risk: request.risk || "unknown",
    contextClass: request.contextClass || "unknown",
    workShape: normalizedWorkClassShape(request.workShape),
  });
}

function workClassForRequest(request) {
  const digest = derivedWorkClassDigest(request);
  if (request.workClassDigest !== undefined && request.workClassDigest !== digest) return error("work_class_digest_mismatch");
  return result(true, "work_class_resolved", { workClassDigest: digest });
}

function validOpaque(value) {
  return validId(value);
}

function isAbsoluteForPlatform(candidate, platform) {
  return platform === "win32" ? path.win32.isAbsolute(candidate) : path.isAbsolute(candidate);
}

function isNested(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function unsafeExternalPath(candidate, cwd) {
  const resolved = path.resolve(candidate);
  if (isNested(resolved, path.resolve(cwd))) return true;
  const parts = resolved.split(path.sep);
  if (parts.some((part, index) => part === "cache" && parts[index - 1] === "plugins" && [".codex", ".claude"].includes(parts[index - 2]))) return true;
  for (let current = path.dirname(resolved); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    if (current === path.dirname(current)) return false;
  }
}

function stickyWorldWritable(stat) {
  return (stat.mode & 0o1000) !== 0 && (stat.mode & 0o002) !== 0;
}

/**
 * Check every existing ancestor.  Default XDG paths go through this same
 * check: an environment default is still input, not a trusted exemption.
 */
function pathSafetyIssue(candidate, { kind, cwd, platform }) {
  if (!isAbsoluteForPlatform(candidate, platform)) return "path_not_absolute";
  const resolved = path.resolve(candidate);
  if (unsafeExternalPath(resolved, cwd)) return "unsafe_path_location";
  for (let current = resolved; ; current = path.dirname(current)) {
    const stat = safeStat(current);
    if (stat) {
      if (stat.isSymbolicLink()) return "unsafe_path_symlink";
      if (current !== resolved && !stat.isDirectory()) return "unsafe_path_ancestor";
      if (stat.isDirectory() && current !== path.parse(current).root) {
        const label = kind === "config" ? "config" : "state";
        if (typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0 && !stickyWorldWritable(stat)) return `unexpected_${label}_directory_owner`;
        if ((stat.mode & 0o022) !== 0 && !stickyWorldWritable(stat)) return `unsafe_${label}_directory_mode`;
      }
    }
    if (current === path.dirname(current)) return null;
  }
}

export function resolvePaths({ env = process.env, home = os.homedir(), cwd = process.cwd(), platform = process.platform } = {}) {
  const configOverride = env.YARDMASTER_MODEL_POLICY_PATH;
  const stateOverride = env.YARDMASTER_MODEL_STATE_PATH;
  const configPath = configOverride
    ? configOverride
    : platform === "win32"
      ? path.join(env.LOCALAPPDATA || home, "yardmaster", "model-routing.json")
      : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "yardmaster", "model-routing.json");
  const statePath = stateOverride
    ? stateOverride
    : platform === "win32"
      ? path.join(env.LOCALAPPDATA || home, "yardmaster", "state", "model-routing-state.json")
      : path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "yardmaster", "model-routing-state.json");

  for (const [kind, candidate, overridden] of [["config", configPath, Boolean(configOverride)], ["state", statePath, Boolean(stateOverride)]]) {
    const issue = pathSafetyIssue(candidate, { kind, cwd, platform });
    if (issue) {
      return error(overridden ? "unsafe_override_path" : "unsafe_default_path", { source: kind, detail: issue });
    }
  }
  return result(true, "paths_resolved", {
    config: { path: path.resolve(configPath), source: configOverride ? "config-override" : "config-default" },
    state: { path: path.resolve(statePath), source: stateOverride ? "state-override" : "state-default" },
  });
}

function safeStat(file) {
  try {
    return fs.lstatSync(file);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

function privateFileIssue(file, { missingOk = true, maxBytes = MAX_JSON_BYTES } = {}) {
  const before = safeStat(file);
  if (!before) return missingOk ? null : "file_missing";
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) return "unsafe_file_type";
  if (before.size > maxBytes) return "file_too_large";
  if (typeof process.getuid === "function" && before.uid !== process.getuid()) return "unexpected_file_owner";
  if ((before.mode & 0o077) !== 0) return "unsafe_file_mode";
  return null;
}

function readPrivateJson(file, { missingOk = true, maxBytes = MAX_JSON_BYTES } = {}) {
  const issue = privateFileIssue(file, { missingOk, maxBytes });
  if (issue) return error(issue, { source: "state" });
  if (!safeStat(file)) return result(true, "file_absent", { value: null });
  let fd;
  try {
    const before = fs.lstatSync(file);
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const after = fs.fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isFile() || after.nlink !== 1 || after.size > maxBytes) {
      return error("file_changed_during_read", { source: "state" });
    }
    const bytes = fs.readFileSync(fd, "utf8");
    if (Buffer.byteLength(bytes) > maxBytes) return error("file_too_large", { source: "state" });
    try {
      const value = JSON.parse(bytes);
      const bounded = boundedIssue(value);
      return bounded ? error(bounded, { source: "state" }) : result(true, "file_loaded", { value });
    } catch {
      return error("invalid_json", { source: "state" });
    }
  } catch (cause) {
    return error(cause?.code === "ELOOP" ? "unsafe_file_type" : "file_read_failed", { source: "state" });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function ensurePrivateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return "unsafe_state_directory";
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "unexpected_state_directory_owner";
  if ((stat.mode & 0o077) !== 0) return "unsafe_state_directory_mode";
  return null;
}

function withStateLock(file, action) {
  const directory = path.dirname(file);
  const directoryIssue = ensurePrivateDirectory(directory);
  if (directoryIssue) return error(directoryIssue);
  const lock = `${file}.lock`;
  let lockFd;
  let lockIdentity;
  try {
    lockFd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    lockIdentity = fs.fstatSync(lockFd);
    fs.writeFileSync(lockFd, JSON.stringify({ owner: opaqueId("lock", `${process.pid}:${Date.now()}:${crypto.randomUUID()}`), pid: process.pid }) + "\n", "utf8");
    fs.fsyncSync(lockFd);
    return action();
  } catch (cause) {
    return error(cause?.code === "EEXIST" ? "state_lock_held" : "state_lock_failed");
  } finally {
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch { /* no-op */ }
      try {
        const current = fs.lstatSync(lock);
        if (lockIdentity && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) fs.unlinkSync(lock);
      } catch { /* retain an ambiguous or replaced lock */ }
    }
  }
}

function writePrivateJsonLocked(file, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) return error("state_capacity_exceeded");
  const directory = path.dirname(file);
  const destinationIssue = privateFileIssue(file, { missingOk: true, maxBytes: MAX_STATE_BYTES });
  if (destinationIssue) return error(destinationIssue);
  let temp;
  try {
    temp = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
    const tempFd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(tempFd, serialized, "utf8");
      fs.fsyncSync(tempFd);
    } finally {
      fs.closeSync(tempFd);
    }
    const finalIssue = privateFileIssue(file, { missingOk: true, maxBytes: MAX_STATE_BYTES });
    if (finalIssue) return error(finalIssue);
    fs.renameSync(temp, file);
    temp = null;
    try {
      const dirFd = fs.openSync(directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Some supported filesystems cannot fsync a directory. The renamed file is still durable enough for v1.
    }
    return result(true, "state_written");
  } catch {
    return error("state_write_failed");
  } finally {
    if (temp) {
      try { fs.unlinkSync(temp); } catch { /* our exclusive temp may already be gone */ }
    }
  }
}

function rejectSecretKeys(value, parent = "") {
  if (Array.isArray(value)) return value.map((item) => rejectSecretKeys(item, parent)).find(Boolean) || null;
  if (!isObject(value)) return null;
  for (const [key, nested] of ownEntries(value)) {
    const lower = key.toLowerCase();
    if (/token|cookie|password|secret|credential|auth[_-]?key|private[_-]?key/.test(lower)) return `forbidden_catalog_key:${key}`;
    if (["command", "commands", "flag", "flags", "executable", "executablepath", "profile", "profilepath", "endpoint", "endpointurl", "prompt", "source", "host", "hostname"].includes(lower)) return `forbidden_catalog_key:${key}`;
    if (lower === "url" && parent !== "rate" && parent !== "rates") return `forbidden_catalog_key:${key}`;
    const issue = rejectSecretKeys(nested, key);
    if (issue) return issue;
  }
  return null;
}

function isKnownCarrier(id) {
  return Object.hasOwn(CARRIER_DESCRIPTORS, id);
}

function onlyFields(value, fields) {
  return isObject(value) && Object.keys(value).every((key) => fields.has(key));
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validSourceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

function parseClaudeFamily(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(?:claude-)?(fable|opus)(?:[-:](current|\d+(?:\.\d+){0,3}))?$/i);
  if (!match) return null;
  return { family: match[1].toLowerCase(), selector: (match[2] || "current").toLowerCase() };
}

function validClaudeFamily(value) {
  return Boolean(parseClaudeFamily(value));
}

const PRESENTATION_OVERLAYS = freeze({
  gpt_sol: freeze({ id: "gpt_sol", format: "lean_bounded_brief", instructions: freeze([
    "Use a lean, explicit, bounded brief with the objective, scope, acceptance evidence, and stop condition.",
  ]) }),
  opus: freeze({ id: "opus", format: "complete_task_specification", instructions: freeze([
    "Present the complete task specification with explicit scope, delegation limits, progress limits, acceptance evidence, and stop condition.",
  ]) }),
  fable: freeze({ id: "fable", format: "autonomous_long_run_brief", instructions: freeze([
    "State autonomy and pause boundaries, require evidence-grounded progress, and preserve compact long-run memory through the stop condition.",
  ]) }),
  glm: freeze({ id: "glm", format: "repository_engineering_brief", instructions: freeze([
    "State repository standards and boundaries, the plan, expected impact and risks, verification evidence, and the stop condition.",
  ]) }),
  oracle: freeze({ id: "oracle", format: "self_contained_one_shot_brief", instructions: freeze([
    "Provide one self-contained briefing with the complete selected file context, acceptance evidence, and stop condition.",
  ]) }),
});

function validWorkContractInput(value) {
  const fields = new Set(["objectiveDigest", "sourceOfTruthDigest", "scopeDigest", "constraintsDigest", "authorizationDigest", "acceptanceDigest", "stopDigest", "carrierId", "model", "effort", "expectedInvariantDigest"]);
  return isObject(value)
    && onlyFields(value, fields)
    && ["objectiveDigest", "sourceOfTruthDigest", "scopeDigest", "constraintsDigest", "authorizationDigest", "acceptanceDigest", "stopDigest"].every((field) => validDigest(value[field]))
    && isKnownCarrier(value.carrierId)
    && validModel(value.model)
    && validEffort(value.effort)
    && (value.expectedInvariantDigest === undefined || validDigest(value.expectedInvariantDigest));
}

function presentationOverlayFor({ carrierId, model, effort }) {
  const carrier = CARRIER_DESCRIPTORS[carrierId];
  if (!carrier || !carrier.efforts.includes(effort)) return null;
  let family;
  if (["codex-luna", "codex-sol", "codex-terra-runtime"].includes(carrierId)) {
    if (carrier.requestedModel && model !== carrier.requestedModel) return null;
    family = "gpt_sol";
  } else if (carrierId === "claude-ce-review") {
    const parsed = parseClaudeFamily(model);
    if (!parsed) return null;
    family = parsed.family;
  } else if (["glm-5-2-scout", "glm-5-2-engineer"].includes(carrierId)) {
    if (model !== "glm-5.2") return null;
    family = "glm";
  } else if (carrierId === "oracle-browser") {
    if (model !== "chatgpt_current_pro") return null;
    family = "oracle";
  } else {
    return null;
  }
  const base = PRESENTATION_OVERLAYS[family];
  return base ? {
    schema: "yardmaster/presentation-overlay/v1",
    family: base.id,
    format: base.format,
    carrierId,
    carrierVersion: carrier.version,
    model,
    effort,
    instructions: [...base.instructions],
  } : null;
}

/**
 * Build the carrier-neutral contract and one source-owned presentation layer.
 * Every semantic input is a caller-supplied digest; this function neither
 * accepts caller prompt text nor calls a provider. Direct user and repository
 * instructions remain authoritative over the selected presentation overlay.
 */
export function buildInvariantWorkContract(input) {
  if (!validWorkContractInput(input)) return error("invalid_work_contract");
  const invariant = {
    schema: INVARIANT_WORK_CONTRACT_SCHEMA,
    objectiveDigest: input.objectiveDigest,
    sourceOfTruthDigest: input.sourceOfTruthDigest,
    scopeDigest: input.scopeDigest,
    constraintsDigest: input.constraintsDigest,
    authorizationDigest: input.authorizationDigest,
    acceptanceDigest: input.acceptanceDigest,
    stopDigest: input.stopDigest,
  };
  const invariantDigest = stableDigest(invariant);
  if (input.expectedInvariantDigest !== undefined && input.expectedInvariantDigest !== invariantDigest) return error("invariant_contract_mutation");
  const presentation = presentationOverlayFor(input);
  if (!presentation) return error("presentation_overlay_mismatch");
  return result(true, "work_contract_built", {
    contract: {
      invariant,
      invariantDigest,
      presentation,
      presentationDigest: stableDigest(presentation),
    },
  });
}

function validateRate(rate) {
  const fields = new Set(["meter", "amount", "asOf", "sourceUrl", "checkedAt", "effectiveAt", "promotionExpiresAt", "staleAfterSeconds", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelDigest"]);
  if (!onlyFields(rate, fields) || !validMeter(rate.meter) || !parseMeterAmount(rate.meter, rate.amount).ok) return "invalid_rate";
  if (!validDate(rate.asOf) || !validSourceUrl(rate.sourceUrl) || !validDate(rate.checkedAt) || !validDate(rate.effectiveAt)) return "invalid_rate";
  if (rate.promotionExpiresAt !== undefined && !validDate(rate.promotionExpiresAt)) return "invalid_rate";
  if (rate.staleAfterSeconds !== undefined && (!Number.isInteger(rate.staleAfterSeconds) || rate.staleAfterSeconds < 1 || rate.staleAfterSeconds > 31_536_000)) return "invalid_rate";
  if (!isKnownCarrier(rate.carrierId) || !validId(rate.carrierVersion) || !validEffort(rate.effort) || !EXECUTION_SURFACES.has(rate.billingSurface) || !validDigest(rate.resolvedModelDigest)) return "invalid_rate";
  return null;
}

function validatePrivacy(privacy, providers) {
  if (!onlyFields(privacy, new Set(["egress", "allowedProviders", "locality", "retention"]))) return false;
  if (privacy.egress !== undefined && typeof privacy.egress !== "boolean") return false;
  if (privacy.locality !== undefined && !Object.hasOwn(LOCALITY_RANK, privacy.locality)) return false;
  if (privacy.retention !== undefined && !Object.hasOwn(RETENTION_RANK, privacy.retention)) return false;
  return privacy.allowedProviders === undefined || (Array.isArray(privacy.allowedProviders) && privacy.allowedProviders.every((provider) => validId(provider) && Object.hasOwn(providers, provider)));
}

function validateBudgetRules(budgets) {
  if (!onlyFields(budgets, new Set(["task", "run", "project"]))) return false;
  for (const [scope, meterRules] of ownEntries(budgets)) {
    if (!["task", "run", "project"].includes(scope) || !isObject(meterRules)) return false;
    for (const [meter, limits] of ownEntries(meterRules)) {
      if (!validMeter(meter) || !onlyFields(limits, new Set(["soft", "hardAdmission", "strict"]))) return false;
      for (const amount of Object.values(limits)) if (!parseMeterAmount(meter, amount).ok) return false;
    }
  }
  return true;
}

function validSoftPriorities(value) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((item) => SOFT_PRIORITIES.has(item));
}

function validateDiscovery(discovery) {
  if (!onlyFields(discovery, new Set(["positiveTtlSeconds", "negativeTtlSeconds", "negativeTtls", "retryAfterMaxSeconds", "manualRefresh"]))) return false;
  for (const [key, value] of ownEntries(discovery)) {
    if (key === "manualRefresh") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (key === "negativeTtls") {
      if (!isObject(value) || !onlyFields(value, new Set(["transientSeconds", "authSeconds", "missingBinarySeconds", "unsupportedSeconds"]))) return false;
      if (Object.values(value).some((seconds) => !Number.isInteger(seconds) || seconds < 1 || seconds > 86_400)) return false;
      continue;
    }
    if (!Number.isInteger(value) || value < 1 || value > 86_400) return false;
  }
  return true;
}

export function validateCatalog(catalog) {
  if (catalog === null || catalog === undefined) return result(true, "config_default", { policy: clone(DEFAULT_POLICY) });
  const bounded = boundedIssue(catalog);
  if (bounded) return error(bounded, { source: "config" });
  if (!isObject(catalog) || catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) return error("unsupported_catalog_schema", { migration: "Use schemaVersion 1 or remove the catalog for built-in defaults." });
  const forbidden = rejectSecretKeys(catalog);
  if (forbidden) return error("unsafe_catalog", { detail: forbidden });
  if (!onlyFields(catalog, new Set(["schemaVersion", "providers", "models", "roles", "privacy", "budgets", "discovery", "learning"]))) return error("unknown_catalog_field");
  for (const field of ["providers", "models", "roles"]) if (!isObject(catalog[field])) return error("invalid_catalog", { field });

  for (const [alias, provider] of ownEntries(catalog.providers)) {
    if (!validId(alias) || !onlyFields(provider, new Set(["carrierId", "executionSurface", "account", "locality", "retention", "capabilities"])) || !validId(provider.carrierId) || !EXECUTION_SURFACES.has(provider.executionSurface) || !validOpaque(provider.account)) return error("invalid_provider", { alias });
    if (provider.locality !== undefined && !Object.hasOwn(LOCALITY_RANK, provider.locality)) return error("invalid_provider", { alias });
    if (provider.retention !== undefined && !Object.hasOwn(RETENTION_RANK, provider.retention)) return error("invalid_provider", { alias });
    if (provider.capabilities !== undefined && (!Array.isArray(provider.capabilities) || provider.capabilities.some((item) => !validId(item)))) return error("invalid_provider", { alias });
  }
  for (const [alias, model] of ownEntries(catalog.models)) {
    const fields = new Set(["provider", "carrierId", "requestedModel", "identityMode", "minimumGeneration", "effort", "efforts", "roles", "relativeCostIndex", "workShape", "rates", "latency", "quality", "reliability", "contextWindow", "requiredCapabilities", "billingSurface", "fallbackSet"]);
    if (!validId(alias) || !onlyFields(model, fields) || !validId(model.provider) || !Object.hasOwn(catalog.providers, model.provider) || !validId(model.carrierId) || !validModel(model.requestedModel)) return error("invalid_model", { alias });
    if (model.identityMode !== undefined && !["provider_latest_family", "exact_pin"].includes(model.identityMode)) return error("invalid_model", { alias });
    if (model.minimumGeneration !== undefined && !/^\d+(?:\.\d+){0,3}$/.test(model.minimumGeneration)) return error("invalid_model", { alias });
    if (model.effort !== undefined && !validEffort(model.effort)) return error("invalid_model", { alias });
    if (model.efforts !== undefined && (!Array.isArray(model.efforts) || model.efforts.length === 0 || model.efforts.some((effort) => !validEffort(effort)))) return error("invalid_model", { alias });
    if (model.relativeCostIndex !== undefined && (!Number.isInteger(model.relativeCostIndex) || model.relativeCostIndex < 1 || model.relativeCostIndex > 1_000_000)) return error("invalid_model", { alias });
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 1 || model.contextWindow > 10_000_000)) return error("invalid_model", { alias });
    if (model.requiredCapabilities !== undefined && (!Array.isArray(model.requiredCapabilities) || model.requiredCapabilities.some((item) => !validId(item)))) return error("invalid_model", { alias });
    if (model.billingSurface !== undefined && !EXECUTION_SURFACES.has(model.billingSurface)) return error("invalid_model", { alias });
    if (model.fallbackSet !== undefined && (!Array.isArray(model.fallbackSet) || model.fallbackSet.some((item) => !validId(item) || !Object.hasOwn(catalog.models, item)))) return error("invalid_model", { alias });
    if (model.roles !== undefined && (!Array.isArray(model.roles) || model.roles.some((role) => !validRole(role)))) return error("invalid_model", { alias });
    if (model.workShape !== undefined && (!onlyFields(model.workShape, new Set(SHAPE_FIELDS)) || Object.values(model.workShape).some((allowed) => !Array.isArray(allowed) || allowed.length === 0 || allowed.some((value) => !SHAPE_VALUES.has(value))))) return error("invalid_model", { alias });
    if (model.rates !== undefined && (!Array.isArray(model.rates) || model.rates.some(validateRate))) return error("invalid_model", { alias });
    for (const field of ["latency", "quality", "reliability"]) if (model[field] !== undefined && (!Number.isFinite(model[field]) || model[field] < 0)) return error("invalid_model", { alias });
    const carrier = CARRIER_DESCRIPTORS[model.carrierId];
    if (catalog.providers[model.provider].carrierId !== model.carrierId) return error("provider_carrier_mismatch", { alias });
    if (carrier?.requestedModel && carrier.requestedModel !== model.requestedModel) return error("fixed_carrier_mismatch", { alias });
    if (model.carrierId === "claude-ce-review" && !validClaudeFamily(model.requestedModel)) return error("invalid_claude_family", { alias });
    if (model.rates !== undefined && model.rates.some((rate) => rate.carrierId !== model.carrierId || rate.carrierVersion !== carrier?.version || !carrier?.efforts.includes(rate.effort) || (model.efforts !== undefined && !model.efforts.includes(rate.effort)) || (model.effort !== undefined && rate.effort !== model.effort) || (model.billingSurface !== undefined && rate.billingSurface !== model.billingSurface) || (model.billingSurface === undefined && rate.billingSurface !== catalog.providers[model.provider].executionSurface) || (model.identityMode !== "provider_latest_family" && rate.resolvedModelDigest !== stableDigest(model.requestedModel)))) return error("rate_binding_mismatch", { alias });
  }
  for (const [role, rule] of ownEntries(catalog.roles)) {
    if (!validRole(role) || !onlyFields(rule, new Set(["tiers"])) || !Array.isArray(rule.tiers) || rule.tiers.length === 0) return error("invalid_role", { role });
    for (const [tierIndex, tier] of rule.tiers.entries()) {
      const aliases = Array.isArray(tier) ? tier : tier?.models;
      if (isObject(tier) && !onlyFields(tier, new Set(["models", "softPriorities"]))) return error("invalid_role", { role });
      if (!Array.isArray(aliases) || aliases.length === 0 || aliases.some((alias) => !validId(alias) || !Object.hasOwn(catalog.models, alias))) return error("invalid_role", { role });
      if (isObject(tier) && tier.softPriorities !== undefined && (!validSoftPriorities(tier.softPriorities) || tierIndex !== 0)) return error("invalid_role", { role });
    }
  }
  if (catalog.privacy !== undefined && !validatePrivacy(catalog.privacy, catalog.providers)) return error("invalid_privacy");
  if (catalog.budgets !== undefined && !validateBudgetRules(catalog.budgets)) return error("invalid_budgets");
  if (catalog.discovery !== undefined && !validateDiscovery(catalog.discovery)) return error("invalid_discovery");
  if (catalog.learning !== undefined && (!onlyFields(catalog.learning, new Set(["enabled"])) || typeof catalog.learning.enabled !== "boolean")) return error("invalid_learning");
  return result(true, "catalog_valid", { policy: { source: "config", digest: stableDigest(catalog), provenance: "user_configuration" } });
}

export function createEmptyState() {
  return {
    purpose: STATE_PURPOSE,
    stateSchemaVersion: STATE_SCHEMA_VERSION,
    capabilities: {},
    budgetEpochs: {},
    taskAuthority: {},
    leases: {},
    reservations: {},
    settlementTombstones: {},
    spendAggregates: {},
    bridges: {},
    learningControl: {},
    learningOutcomes: {},
    learningAggregates: {},
    lifecycleReviewRequirements: {},
  };
}

function validPolicyDigest(value) {
  return value === DEFAULT_POLICY.digest || validDigest(value);
}

function validIsoInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validScope(value) {
  return isObject(value) && onlyFields(value, new Set(["kind", "id"])) && ["task", "run", "project"].includes(value.kind) && validId(value.id);
}

function validScopes(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(validScope) && new Set(value.map((scope) => `${scope.kind}:${scope.id}`)).size === value.length;
}

function scopeAccountingId(scope) {
  return `scope_${stableDigest({ kind: scope.kind, id: scope.id }).slice(0, 24)}`;
}

function leaseEpochAccountingId(epochId) {
  return `lease_epoch_${stableDigest(epochId).slice(0, 24)}`;
}

function validMeterMap(value) {
  return isObject(value) && ownEntries(value).every(([meter, amount]) => parseMeterAmount(meter, amount).ok);
}

function validSelected(value) {
  const fields = new Set(["modelAlias", "model", "effort", "carrierId", "carrierVersion", "executionSurface", "transport", "adapterId", "adapterVersion", "completionState", "observedModel"]);
  if (!onlyFields(value, fields) || !validId(value.modelAlias) || !validModel(value.model) || !validEffort(value.effort) || !isKnownCarrier(value.carrierId) || !validId(value.carrierVersion) || !EXECUTION_SURFACES.has(value.executionSurface) || typeof value.transport !== "string" || !validId(value.adapterId) || !validId(value.adapterVersion)) return false;
  const carrier = CARRIER_DESCRIPTORS[value.carrierId];
  const adapter = ADAPTER_DESCRIPTORS[value.adapterId];
  return carrier?.version === value.carrierVersion && adapter?.version === value.adapterVersion && carrier.adapters.includes(value.adapterId);
}

function validBinding(value) {
  const fields = new Set(["adapterId", "adapterVersion", "dispatchKind", "budgetEffect", "controls", "transportPath", "bridgePhase", "hostScope", "accountScope", "contextFork", "r52", "profile", "compositeReservations", "ceSeam"]);
  if (!onlyFields(value, fields) || !validId(value.adapterId) || !validId(value.adapterVersion) || !DISPATCH_KINDS.has(value.dispatchKind) || !BUDGET_EFFECTS.has(value.budgetEffect) || !isObject(value.controls) || (value.transportPath !== "native" && value.transportPath !== "visible_provider_task") || ![null, "activation", "bootstrap"].includes(value.bridgePhase) || !validId(value.hostScope) || !validId(value.accountScope)) return false;
  const adapter = ADAPTER_DESCRIPTORS[value.adapterId];
  if (!adapter || adapter.version !== value.adapterVersion || !adapter.dispatchKinds.includes(value.dispatchKind)) return false;
  if (stableDigest(value.controls) !== stableDigest(adapter.controls)) return false;
  if (value.profile !== undefined && !validId(value.profile)) return false;
  if (value.compositeReservations !== undefined && (!Array.isArray(value.compositeReservations) || value.compositeReservations.some((item) => !validId(item)))) return false;
  if (value.contextFork !== undefined && !validContextFork(value.contextFork)) return false;
  if (value.r52 !== undefined && !validR52Binding(value.r52)) return false;
  return value.ceSeam === undefined || validCeSeam(value.ceSeam);
}

function validCeSeam(value) {
  if (!onlyFields(value, new Set(["id", "skill", "artifact"]))) return false;
  const definition = CE_SEAMS[value.id];
  if (!definition || value.skill !== definition.skill || !isObject(value.artifact) || !onlyFields(value.artifact, new Set(["schema", "digest"]))) return false;
  return value.artifact.schema === definition.artifactSchema && validDigest(value.artifact.digest);
}

function ceSeamAllows(value, role, carrierId) {
  const definition = value && CE_SEAMS[value.id];
  return validCeSeam(value) && Boolean(definition) && definition.roles.includes(role) && definition.carriers.includes(carrierId);
}

function validStoredDecision(value) {
  if (!onlyFields(value, new Set(["decisionId", "policyDigest", "role", "selected", "binding", "disclosure", "workClassDigest"]))) return false;
  return validId(value.decisionId) && validPolicyDigest(value.policyDigest) && validRole(value.role) && validSelected(value.selected) && validBinding(value.binding) && validR28Disclosure(value.disclosure) && (value.workClassDigest === undefined || validDigest(value.workClassDigest)) && (value.binding.ceSeam === undefined || ceSeamAllows(value.binding.ceSeam, value.role, value.selected.carrierId));
}

function negativeClassFor(reason) {
  return typeof reason === "string" ? NEGATIVE_REASON_CLASS[reason] || null : null;
}

function negativeTtlSeconds(catalog, negativeClass) {
  const discovery = catalog?.discovery || {};
  const key = {
    transient: "transientSeconds",
    auth: "authSeconds",
    missing_binary: "missingBinarySeconds",
    unsupported: "unsupportedSeconds",
  }[negativeClass];
  return discovery.negativeTtls?.[key]
    || discovery.negativeTtlSeconds
    || NEGATIVE_TTL_DEFAULTS[negativeClass]
    || DEFAULT_NEGATIVE_TTL_MS / 1000;
}

function retryAfterMaximumSeconds(catalog) {
  return catalog?.discovery?.retryAfterMaxSeconds || DEFAULT_RETRY_AFTER_MAX_SECONDS;
}

function validateCapabilityRecord(id, evidence) {
  const fields = new Set(["carrierId", "carrierVersion", "adapterId", "adapterVersion", "hostScope", "accountScope", "policyDigest", "state", "observedModel", "resolvedModelDigest", "fallbackSetDigest", "capabilities", "authState", "negativeReason", "negativeClass", "retryAfterSeconds", "notBefore", "invalidation", "expiresAt", "attestedAt", "attestorId", "attestationDigest", "attestedFactsDigest", "probeId", "probeVersion", "probeDigest"]);
  if (!validId(id) || !onlyFields(evidence, fields) || !isKnownCarrier(evidence.carrierId) || !validId(evidence.carrierVersion) || !ADAPTER_DESCRIPTORS[evidence.adapterId] || !validId(evidence.adapterVersion) || !validId(evidence.hostScope) || !validId(evidence.accountScope) || !validPolicyDigest(evidence.policyDigest) || !validIsoInstant(evidence.expiresAt)) return false;
  const carrier = CARRIER_DESCRIPTORS[evidence.carrierId];
  const adapter = ADAPTER_DESCRIPTORS[evidence.adapterId];
  if (carrier.version !== evidence.carrierVersion || adapter.version !== evidence.adapterVersion || !carrier.adapters.includes(evidence.adapterId)) return false;
  if (![...POSITIVE_CAPABILITY_STATES, ...NEGATIVE_CAPABILITY_STATES].includes(evidence.state)) return false;
  if (evidence.observedModel !== undefined && !validModel(evidence.observedModel)) return false;
  if (evidence.resolvedModelDigest !== undefined && !validDigest(evidence.resolvedModelDigest)) return false;
  if (evidence.fallbackSetDigest !== undefined && !validDigest(evidence.fallbackSetDigest)) return false;
  if (evidence.capabilities !== undefined && (!Array.isArray(evidence.capabilities) || evidence.capabilities.some((item) => !validId(item)))) return false;
  if (evidence.authState !== undefined && !["unknown", "authenticated", "auth_context_unavailable"].includes(evidence.authState)) return false;
  if (POSITIVE_CAPABILITY_STATES.has(evidence.state)) {
    if (![HOST_CAPABILITY_ATTESTOR, FIXED_LOCAL_PROBE_ATTESTOR, ADAPTER_RECEIPT_ATTESTOR].includes(evidence.attestorId) || !validIsoInstant(evidence.attestedAt) || !validDigest(evidence.attestationDigest) || !validDigest(evidence.attestedFactsDigest) || !validModel(evidence.observedModel) || evidence.resolvedModelDigest !== stableDigest(evidence.observedModel) || evidence.negativeReason !== undefined || evidence.negativeClass !== undefined || evidence.retryAfterSeconds !== undefined || evidence.notBefore !== undefined || evidence.invalidation !== undefined) return false;
    if (evidence.attestorId === FIXED_LOCAL_PROBE_ATTESTOR) return validId(evidence.probeId) && validId(evidence.probeVersion) && validDigest(evidence.probeDigest);
    return evidence.probeId === undefined && evidence.probeVersion === undefined && evidence.probeDigest === undefined;
  }
  const negativeClass = negativeClassFor(evidence.negativeReason);
  if (!negativeClass || evidence.negativeClass !== negativeClass || evidence.attestorId !== undefined || evidence.attestedAt !== undefined || evidence.attestationDigest !== undefined || evidence.attestedFactsDigest !== undefined || evidence.observedModel !== undefined || evidence.resolvedModelDigest !== undefined || evidence.fallbackSetDigest !== undefined || evidence.capabilities !== undefined || evidence.probeId !== undefined || evidence.probeVersion !== undefined || evidence.probeDigest !== undefined) return false;
  if (evidence.retryAfterSeconds !== undefined && (!Number.isInteger(evidence.retryAfterSeconds) || evidence.retryAfterSeconds < 1 || evidence.retryAfterSeconds > 86_400)) return false;
  if (evidence.notBefore !== undefined && !validIsoInstant(evidence.notBefore)) return false;
  if (negativeClass === "unsupported") return evidence.invalidation === "policy_or_adapter_digest";
  return evidence.invalidation === undefined;
}

function validateTaskAuthorityRecord(id, authority) {
  const fields = new Set(["authorityId", "objectiveEpoch", "objectiveDigest", "senderOwner", "accountScope", "carrierId", "adapterId", "policyDigest", "destinationScope", "destinationClass", "maxTaskCount", "usedTaskCount", "currentTurn", "issuedAt", "expiresAt", "consumedAt", "source", "sourceReceiptDigest", "controller", "attestorId", "attestationDigest", "attestedAt", "authorityFactsDigest", "cooperative"]);
  if (!validId(id) || !onlyFields(authority, fields) || authority.authorityId !== id || !validId(authority.objectiveEpoch) || !validId(authority.senderOwner) || !validId(authority.accountScope) || !isKnownCarrier(authority.carrierId) || !ADAPTER_DESCRIPTORS[authority.adapterId] || !validPolicyDigest(authority.policyDigest) || !validId(authority.destinationScope) || !["visible_task", "delegated_slot"].includes(authority.destinationClass) || !Number.isInteger(authority.maxTaskCount) || authority.maxTaskCount < 1 || authority.maxTaskCount > MAX_LEASE_SLOTS || !Number.isInteger(authority.usedTaskCount) || authority.usedTaskCount < 0 || authority.usedTaskCount > authority.maxTaskCount || !validId(authority.currentTurn) || !validIsoInstant(authority.issuedAt) || !validIsoInstant(authority.expiresAt) || Date.parse(authority.expiresAt) <= Date.parse(authority.issuedAt) || authority.source !== "explicit_user_instruction" || !validDigest(authority.sourceReceiptDigest) || authority.attestorId !== TASK_AUTHORITY_ATTESTOR || !validDigest(authority.attestationDigest) || !validIsoInstant(authority.attestedAt) || !validDigest(authority.authorityFactsDigest) || authority.cooperative !== true) return false;
  if (authority.objectiveDigest !== undefined && !validDigest(authority.objectiveDigest)) return false;
  if (authority.controller !== undefined && !validControllerRuntime(authority.controller)) return false;
  if (!CARRIER_DESCRIPTORS[authority.carrierId].adapters.includes(authority.adapterId)) return false;
  if (authority.usedTaskCount === authority.maxTaskCount) return validIsoInstant(authority.consumedAt);
  return authority.consumedAt === undefined;
}

function validateLeaseRecord(id, lease) {
  const fields = new Set(["leaseId", "issuerScope", "allocatorScopes", "destinationScope", "destinationAccountScope", "policyDigest", "epochId", "carrierId", "carrierVersion", "adapterId", "adapterVersion", "ceiling", "remainingCeiling", "maxSlots", "slotsClaimed", "allocations", "issuedAt", "expiresAt", "allocatorReceiptDigest", "accepted", "acceptedAt", "released", "releasedAt", "cooperative"]);
  if (!validId(id) || !onlyFields(lease, fields) || lease.leaseId !== id || !validId(lease.issuerScope) || !validScopes(lease.allocatorScopes) || !validId(lease.destinationScope) || !validId(lease.destinationAccountScope) || !validPolicyDigest(lease.policyDigest) || !validId(lease.epochId) || !isKnownCarrier(lease.carrierId) || CARRIER_DESCRIPTORS[lease.carrierId].version !== lease.carrierVersion || !ADAPTER_DESCRIPTORS[lease.adapterId] || ADAPTER_DESCRIPTORS[lease.adapterId].version !== lease.adapterVersion || !CARRIER_DESCRIPTORS[lease.carrierId].adapters.includes(lease.adapterId) || !validMeterMap(lease.ceiling) || !validMeterMap(lease.remainingCeiling) || !Number.isInteger(lease.maxSlots) || lease.maxSlots < 1 || lease.maxSlots > MAX_LEASE_SLOTS || !Number.isInteger(lease.slotsClaimed) || lease.slotsClaimed < 0 || lease.slotsClaimed > lease.maxSlots || !isObject(lease.allocations) || !validIsoInstant(lease.issuedAt) || !validIsoInstant(lease.expiresAt) || Date.parse(lease.expiresAt) <= Date.parse(lease.issuedAt) || !validDigest(lease.allocatorReceiptDigest) || typeof lease.accepted !== "boolean" || typeof lease.released !== "boolean" || lease.cooperative !== true) return false;
  if (lease.accepted ? !validIsoInstant(lease.acceptedAt) : lease.acceptedAt !== undefined) return false;
  if (lease.released ? !validIsoInstant(lease.releasedAt) : lease.releasedAt !== undefined) return false;
  const allocated = {};
  for (const [reservationId, allocation] of ownEntries(lease.allocations)) {
    if (!validId(reservationId) || !isObject(allocation) || !onlyFields(allocation, new Set(["claimId", "forecast", "at"])) || !validId(allocation.claimId) || !validMeterMap(allocation.forecast) || !validIsoInstant(allocation.at)) return false;
    allocated[reservationId] = allocation;
  }
  if (Object.keys(allocated).length > lease.slotsClaimed) return false;
  for (const [meter, raw] of ownEntries(lease.ceiling)) {
    let used = parseMeterAmount(meter, lease.remainingCeiling[meter] || "0").units;
    for (const allocation of Object.values(allocated)) used += parseMeterAmount(meter, allocation.forecast[meter] || "0").units;
    if (used > parseMeterAmount(meter, raw).units) return false;
  }
  return ownEntries(lease.remainingCeiling).every(([meter, amount]) => Object.hasOwn(lease.ceiling, meter) && parseMeterAmount(meter, amount).units <= parseMeterAmount(meter, lease.ceiling[meter]).units);
}

function validDispatchIdentity(value, expectedProducer) {
  const fields = new Set(["hostScope", "accountScope", "dispatchKind", "sessionId", "toolId", "toolVersion"]);
  return onlyFields(value, fields) && validId(value.hostScope) && validId(value.accountScope) && DISPATCH_KINDS.has(value.dispatchKind) && validId(value.sessionId) && value.sessionId.length <= MAX_SESSION_ID && validId(value.toolId) && validId(value.toolVersion) && (expectedProducer === undefined || value.toolId === expectedProducer);
}

function dispatchIdentityDigest(value) {
  return stableDigest({
    hostScope: value.hostScope,
    accountScope: value.accountScope,
    dispatchKind: value.dispatchKind,
    sessionId: value.sessionId,
    toolId: value.toolId,
    toolVersion: value.toolVersion,
  });
}

function validLearningShape(value) {
  return value === undefined || validShape(value) === null;
}

const DISCLOSURE_PROVENANCE = new Set([
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

function validDisclosureScalar(value) {
  return value === "unknown"
    || value === "not_applicable"
    || value === "not_requested"
    || value === "carrier_execution"
    || value === "router_selects_adapter_executes"
    || value === "external"
    || value === "local"
    || value === "adapter_defined"
    || value === "provider_default"
    || value === "ephemeral"
    || value === "none"
    || value === "fresh"
    || value === "stale"
    || value === "selected"
    || value === "fallback"
    || value === "not_selected"
    || EXECUTION_SURFACES.has(value)
    || validId(value)
    || validModel(value)
    || validEffort(value);
}

function validDisclosureFacet(value, { meters = false } = {}) {
  return isObject(value)
    && onlyFields(value, new Set(["value", "provenance"]))
    && DISCLOSURE_PROVENANCE.has(value.provenance)
    && (meters
      ? value.value === "unknown" || value.value === "not_applicable" || validMeterMap(value.value)
      : validDisclosureScalar(value.value));
}

/**
 * This is intentionally a small, content-free receipt schema.  It captures
 * only routing/accounting facts; prompt text, provider output, paths, and
 * arbitrary adapter detail are never legal here.
 */
function validR28Disclosure(value) {
  const routeFields = new Set(["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"]);
  const carrierFields = new Set(["carrierId", "carrierVersion", "adapterId", "adapterVersion", "probeId", "probeVersion", "probeDigest"]);
  if (!isObject(value) || !onlyFields(value, new Set(["schema", "route", "reasonCode", "requested", "configured", "observed", "carrier", "meters", "capability", "privacy", "rejectedAlternatives", "attribution", "escalation"]))) return false;
  if (value.schema !== "yardmaster/r28-route-disclosure/v1" || !["selected", "fallback", "settlement"].includes(value.route) || !validId(value.reasonCode)) return false;
  for (const section of ["requested", "configured", "observed"]) {
    if (!isObject(value[section]) || !onlyFields(value[section], routeFields) || !Object.values(value[section]).every((facet) => validDisclosureFacet(facet))) return false;
  }
  if (!isObject(value.carrier) || !onlyFields(value.carrier, carrierFields) || !Object.values(value.carrier).every((facet) => validDisclosureFacet(facet))) return false;
  if (!isObject(value.meters) || !onlyFields(value.meters, new Set(["forecast", "reservation", "actual", "charged"])) || !Object.values(value.meters).every((facet) => validDisclosureFacet(facet, { meters: true }))) return false;
  if (!isObject(value.capability) || !onlyFields(value.capability, new Set(["state", "freshness", "provenance"])) || !validDisclosureFacet(value.capability.state) || !validDisclosureFacet(value.capability.freshness) || !validDisclosureFacet(value.capability.provenance)) return false;
  if (!isObject(value.privacy) || !onlyFields(value.privacy, new Set(["egress", "locality", "retention"])) || !Object.values(value.privacy).every((facet) => validDisclosureFacet(facet))) return false;
  if (!Array.isArray(value.rejectedAlternatives) || value.rejectedAlternatives.length > 64 || value.rejectedAlternatives.some((item) => !isObject(item) || !onlyFields(item, new Set(["modelAlias", "reason"])) || (item.modelAlias !== "unknown" && item.modelAlias !== "not_applicable" && !validId(item.modelAlias)) || !validId(item.reason))) return false;
  if (!isObject(value.attribution) || !onlyFields(value.attribution, new Set(["parent", "child", "boundary"])) || !Object.values(value.attribution).every((facet) => validDisclosureFacet(facet))) return false;
  return isObject(value.escalation) && onlyFields(value.escalation, new Set(["state", "provenance"])) && validDisclosureFacet(value.escalation.state) && validDisclosureFacet(value.escalation.provenance);
}

function validActionModel(value, { actual = false } = {}) {
  return isObject(value)
    && onlyFields(value, new Set(["model", "effort"]))
    && (actual && value.model === "unknown" || validModel(value.model))
    && (actual && value.effort === "unknown" || validEffort(value.effort));
}

function validActionReceipt(value) {
  const fields = new Set(["schema", "actionId", "actionDigest", "reason", "adapter", "startsWork", "workClassDigest", "priorWorkClassDigest", "priorRouteDigest", "r52Digest", "capability", "requested", "actual", "inheritanceReason", "fallbackReason", "budget"]);
  if (!isObject(value) || !onlyFields(value, fields) || value.schema !== ACTION_RECEIPT_SCHEMA || !validId(value.actionId) || !validDigest(value.actionDigest) || !ACTION_RECEIPT_REASONS.has(value.reason) || typeof value.startsWork !== "boolean" || !validDigest(value.workClassDigest) || (value.priorWorkClassDigest !== "not_applicable" && !validDigest(value.priorWorkClassDigest)) || (value.priorRouteDigest !== "not_applicable" && !validDigest(value.priorRouteDigest)) || (value.r52Digest !== "not_applicable" && !validDigest(value.r52Digest)) || !validActionModel(value.requested) || !validActionModel(value.actual, { actual: true }) || !ACTION_INHERITANCE_REASONS.has(value.inheritanceReason) || !ACTION_FALLBACK_REASONS.has(value.fallbackReason)) return false;
  if (!isObject(value.adapter) || !onlyFields(value.adapter, new Set(["adapterId", "adapterVersion", "dispatchKind"])) || !ADAPTER_DESCRIPTORS[value.adapter.adapterId] || value.adapter.adapterVersion !== ADAPTER_DESCRIPTORS[value.adapter.adapterId].version || !DISPATCH_KINDS.has(value.adapter.dispatchKind)) return false;
  if (!isObject(value.capability) || !onlyFields(value.capability, new Set(["state", "freshness"])) || typeof value.capability.state !== "string" || typeof value.capability.freshness !== "string") return false;
  const validBudget = value.budget === "not_applicable" || (isObject(value.budget) && onlyFields(value.budget, new Set(["kind", "forecast", "warningCount"])) && value.budget.kind === "top_up" && validMeterMap(value.budget.forecast) && Number.isInteger(value.budget.warningCount) && value.budget.warningCount >= 0 && value.budget.warningCount <= 64);
  if (!validBudget) return false;
  if (value.reason === "budget_neutral_message" && (value.startsWork !== false || value.budget !== "not_applicable")) return false;
  if (value.reason === "active_budget_top_up" && (value.startsWork !== true || value.budget === "not_applicable")) return false;
  return value.priorRouteDigest === "not_applicable"
    ? value.inheritanceReason === "not_applicable"
    : value.inheritanceReason === "intentional_same_class_inheritance";
}

function actionReceiptFor(request, decision, {
  budget = "not_applicable",
  inheritanceReason = request.priorRoute ? "intentional_same_class_inheritance" : "not_applicable",
  reason = budget === "not_applicable" ? "budget_neutral_message" : "active_budget_top_up",
} = {}) {
  const actionId = request.actionId || request.requestId;
  const workClass = workClassForRequest(request);
  if (!workClass.ok || !validId(actionId)) return null;
  const priorRouteDigest = request.priorRoute ? stableDigest(request.priorRoute) : "not_applicable";
  const receipt = {
    schema: ACTION_RECEIPT_SCHEMA,
    actionId,
    reason,
    adapter: {
      adapterId: decision.binding.adapterId,
      adapterVersion: decision.binding.adapterVersion,
      dispatchKind: decision.binding.dispatchKind,
    },
    startsWork: decision.binding.budgetEffect === "adjust_active",
    workClassDigest: workClass.workClassDigest,
    priorWorkClassDigest: request.priorWorkClassDigest || "not_applicable",
    priorRouteDigest,
    r52Digest: decision.binding.r52?.digest || "not_applicable",
    capability: {
      state: decision.capability?.status || "unknown",
      freshness: decision.capability?.freshness || "unknown",
    },
    requested: { model: decision.requested.model, effort: decision.requested.effort },
    actual: {
      model: decision.requestedVsActual.observedModel || "unknown",
      effort: decision.requestedVsActual.effectiveEffort || "unknown",
    },
    inheritanceReason,
    fallbackReason: decision.fallback?.reason || decision.budgetFallback?.reason || "not_applicable",
    budget,
  };
  receipt.actionDigest = stableDigest({
    schema: receipt.schema,
    actionId: receipt.actionId,
    reason: receipt.reason,
    adapter: receipt.adapter,
    startsWork: receipt.startsWork,
    workClassDigest: receipt.workClassDigest,
    priorWorkClassDigest: receipt.priorWorkClassDigest,
    priorRouteDigest: receipt.priorRouteDigest,
    r52Digest: receipt.r52Digest,
    capability: receipt.capability,
    requested: receipt.requested,
    actual: receipt.actual,
    inheritanceReason: receipt.inheritanceReason,
    fallbackReason: receipt.fallbackReason,
    budget: receipt.budget,
    policyDigest: decision.policy.digest,
  });
  return validActionReceipt(receipt) ? receipt : null;
}

function validLearningOutcome(id, value) {
  const fields = new Set(["at", "role", "risk", "contextClass", "workShape", "baseBucket", "routeEffectBucket", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelBucket", "result", "durationMs", "usage", "retryCount", "verification", "rating", "measuredBilled"]);
  const routeFields = ["routeEffectBucket", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelBucket"];
  const routeFieldCount = routeFields.filter((field) => value?.[field] !== undefined).length;
  return validId(id)
    && isObject(value)
    && onlyFields(value, fields)
    && validIsoInstant(value.at)
    && validRole(value.role)
    && ["low", "medium", "high", "critical", "unknown"].includes(value.risk)
    && validId(value.contextClass)
    && validLearningShape(value.workShape)
    && validDigest(value.baseBucket)
    && (routeFieldCount === 0 || (routeFieldCount === routeFields.length
      && validDigest(value.routeEffectBucket)
      && isKnownCarrier(value.carrierId)
      && validId(value.carrierVersion)
      && CARRIER_DESCRIPTORS[value.carrierId].version === value.carrierVersion
      && validEffort(value.effort)
      && EXECUTION_SURFACES.has(value.billingSurface)
      && validDigest(value.resolvedModelBucket)))
    && value.result === "settled"
    && (value.durationMs === undefined || (Number.isInteger(value.durationMs) && value.durationMs >= 0 && value.durationMs <= 86_400_000))
    && (value.usage === undefined || validMeterMap(value.usage))
    && (value.retryCount === undefined || (Number.isInteger(value.retryCount) && value.retryCount >= 0 && value.retryCount <= 99))
    && (value.verification === undefined || ["passed", "failed", "not_run", "unknown"].includes(value.verification))
    && (value.rating === undefined || (Number.isInteger(value.rating) && value.rating >= 1 && value.rating <= 5))
    && (value.measuredBilled === undefined || typeof value.measuredBilled === "boolean");
}

function validLearningAggregate(id, value) {
  const common = new Set(["kind", "baseBucket", "role", "risk", "contextClass", "workShape", "count", "totalDurationMs", "totalRetries", "failures", "verified", "ratingTotal", "updatedAt"]);
  const baseFields = new Set([...common, "usageTotals", "forecastTotals", "forecastInfluenceByMeter"]);
  const routeFields = new Set([...common, "routeEffectBucket", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelBucket", "tieBreakInfluence"]);
  if (!validId(id) || !isObject(value) || !["baseDemand", "routeEffect"].includes(value.kind) || !onlyFields(value, value.kind === "baseDemand" ? baseFields : routeFields)) return false;
  if (!validDigest(value.baseBucket) || !validRole(value.role) || !["low", "medium", "high", "critical", "unknown"].includes(value.risk) || !validId(value.contextClass) || !validLearningShape(value.workShape) || !Number.isInteger(value.count) || value.count < 0 || !Number.isInteger(value.totalDurationMs) || value.totalDurationMs < 0 || !Number.isInteger(value.totalRetries) || value.totalRetries < 0 || !Number.isInteger(value.failures) || value.failures < 0 || !Number.isInteger(value.verified) || value.verified < 0 || !Number.isInteger(value.ratingTotal) || value.ratingTotal < 0 || !validIsoInstant(value.updatedAt)) return false;
  if (value.kind === "baseDemand") return validMeterMap(value.usageTotals) && validMeterMap(value.forecastTotals) && isObject(value.forecastInfluenceByMeter) && ownEntries(value.forecastInfluenceByMeter).every(([meter, influence]) => validMeter(meter) && Number.isFinite(influence) && Math.abs(influence) <= MAX_LEARNING_SAMPLE_INFLUENCE);
  return validDigest(value.routeEffectBucket) && isKnownCarrier(value.carrierId) && value.carrierVersion === CARRIER_DESCRIPTORS[value.carrierId].version && validEffort(value.effort) && EXECUTION_SURFACES.has(value.billingSurface) && validDigest(value.resolvedModelBucket) && Number.isFinite(value.tieBreakInfluence) && Math.abs(value.tieBreakInfluence) <= MAX_LEARNING_SAMPLE_INFLUENCE;
}

function validLifecycleReviewRequirement(id, value) {
  const fields = new Set(["requirementId", "hostScope", "accountScope", "policyDigest", "lifecycleReservationId", "lifecycleClaimId", "createdAt", "expiresAt", "reviewClaimId", "fulfilled", "fulfilledAt"]);
  if (!validId(id) || !onlyFields(value, fields) || value.requirementId !== id || !validId(value.hostScope) || !validId(value.accountScope) || !validPolicyDigest(value.policyDigest) || !validId(value.lifecycleReservationId) || !validId(value.lifecycleClaimId) || !validIsoInstant(value.createdAt) || !validIsoInstant(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || typeof value.fulfilled !== "boolean") return false;
  if (value.reviewClaimId !== undefined && !validId(value.reviewClaimId)) return false;
  return value.fulfilled ? validIsoInstant(value.fulfilledAt) && validId(value.reviewClaimId) : value.fulfilledAt === undefined;
}

function validAuthorityBinding(value) {
  const basic = isObject(value)
    && onlyFields(value, new Set(["authorityId", "objectiveEpoch", "objectiveDigest", "instructionDigest", "senderOwner", "accountScope", "destinationScope", "destinationClass", "currentTurn", "controller", "authorityFactsDigest", "attestationDigest"]))
    && validId(value.authorityId)
    && validId(value.objectiveEpoch)
    && validId(value.senderOwner)
    && validId(value.accountScope)
    && validId(value.destinationScope)
    && ["visible_task", "delegated_slot"].includes(value.destinationClass)
    && validId(value.currentTurn)
    && validDigest(value.authorityFactsDigest)
    && validDigest(value.attestationDigest);
  return basic
    && (value.objectiveDigest === undefined || validDigest(value.objectiveDigest))
    && (value.instructionDigest === undefined || validDigest(value.instructionDigest))
    && (value.controller === undefined || validControllerRuntime(value.controller));
}

function validateReservationRecord(id, reservation) {
  const fields = new Set(["reservationId", "decisionId", "requestId", "requestDigest", "frozenInputDigest", "objectiveDigest", "instructionDigest", "workClassDigest", "phase", "scope", "scopes", "forecast", "selected", "binding", "policyDigest", "createdAt", "updatedAt", "claimId", "claimed", "receiptIds", "decision", "budgetWarnings", "bridgeLifecycleId", "adjustments", "leaseId", "workShape", "risk", "contextClass", "learningAllowed", "postLifecycleRequirementId", "authorityBinding"]);
  if (!validId(id) || !onlyFields(reservation, fields) || reservation.reservationId !== id || !validId(reservation.decisionId) || !validId(reservation.requestId) || !validDigest(reservation.requestDigest) || !validDigest(reservation.frozenInputDigest) || !["reserved", "claimed", "started", "ambiguous", "settled", "no_start"].includes(reservation.phase) || !validScope(reservation.scope) || !validScopes(reservation.scopes) || stableDigest(reservation.scope) !== stableDigest(reservation.scopes[0]) || !validMeterMap(reservation.forecast) || !validSelected(reservation.selected) || !validBinding(reservation.binding) || !validPolicyDigest(reservation.policyDigest) || !validIsoInstant(reservation.createdAt) || !validIsoInstant(reservation.updatedAt) || !Array.isArray(reservation.receiptIds) || new Set(reservation.receiptIds).size !== reservation.receiptIds.length || reservation.receiptIds.some((item) => !validId(item)) || !validStoredDecision(reservation.decision)) return false;
  if (reservation.decision.decisionId !== reservation.decisionId || reservation.decision.policyDigest !== reservation.policyDigest || reservation.decision.role === undefined || stableDigest(reservation.decision.selected) !== stableDigest(reservation.selected) || stableDigest(reservation.decision.binding) !== stableDigest(reservation.binding) || (reservation.workClassDigest !== undefined && reservation.decision.workClassDigest !== reservation.workClassDigest)) return false;
  if (reservation.claimId !== null && !validId(reservation.claimId)) return false;
  if (reservation.phase === "reserved" && (reservation.claimId !== null || reservation.claimed !== undefined)) return false;
  if (reservation.phase !== "reserved") {
    const claimed = reservation.claimed;
    const claimedFields = new Set(["id", "state", "hostScope", "accountScope", "dispatchKind", "sessionId", "toolId", "toolVersion", "frozenInputDigest", "at", "currentTurn", "authorityId", "postLifecycleRequirementId"]);
    const identity = isObject(claimed) ? {
      hostScope: claimed.hostScope,
      accountScope: claimed.accountScope,
      dispatchKind: claimed.dispatchKind,
      sessionId: claimed.sessionId,
      toolId: claimed.toolId,
      toolVersion: claimed.toolVersion,
    } : null;
    if (!validId(reservation.claimId) || !isObject(claimed) || !onlyFields(claimed, claimedFields) || claimed.id !== reservation.claimId || !ACTIVE_CLAIM_PHASES.has(claimed.state) || !validDispatchIdentity(identity) || claimed.hostScope !== reservation.binding.hostScope || claimed.accountScope !== reservation.binding.accountScope || claimed.dispatchKind !== reservation.binding.dispatchKind || claimed.toolId !== ADAPTER_DESCRIPTORS[reservation.binding.adapterId].receiptProducer || claimed.toolVersion !== reservation.binding.adapterVersion || claimed.frozenInputDigest !== reservation.frozenInputDigest || !validIsoInstant(claimed.at) || (claimed.currentTurn !== undefined && !validId(claimed.currentTurn)) || (claimed.authorityId !== undefined && !validId(claimed.authorityId)) || (claimed.postLifecycleRequirementId !== undefined && !validId(claimed.postLifecycleRequirementId))) return false;
  }
  if (reservation.budgetWarnings !== undefined && (!Array.isArray(reservation.budgetWarnings) || reservation.budgetWarnings.some((warning) => !isObject(warning) || !onlyFields(warning, new Set(["meter", "reason", "scope", "scopeId"])) || !validMeter(warning.meter) || warning.reason !== "soft_budget_exceeded" || (warning.scope !== undefined && !["task", "run", "project"].includes(warning.scope)) || (warning.scopeId !== undefined && !validId(warning.scopeId))))) return false;
  if (reservation.bridgeLifecycleId !== undefined && !validId(reservation.bridgeLifecycleId)) return false;
  if (reservation.leaseId !== undefined && !validId(reservation.leaseId)) return false;
  if (reservation.objectiveDigest !== undefined && !validDigest(reservation.objectiveDigest)) return false;
  if (reservation.instructionDigest !== undefined && !validDigest(reservation.instructionDigest)) return false;
  if (reservation.workClassDigest !== undefined && !validDigest(reservation.workClassDigest)) return false;
  if (ADAPTER_DESCRIPTORS[reservation.binding.adapterId]?.requiresTaskAuthority ? !validAuthorityBinding(reservation.authorityBinding) : reservation.authorityBinding !== undefined) return false;
  if (!validLearningShape(reservation.workShape) || (reservation.risk !== undefined && !["low", "medium", "high", "critical"].includes(reservation.risk)) || (reservation.contextClass !== undefined && !validId(reservation.contextClass)) || (reservation.learningAllowed !== undefined && typeof reservation.learningAllowed !== "boolean") || (reservation.postLifecycleRequirementId !== undefined && !validId(reservation.postLifecycleRequirementId))) return false;
  if (reservation.adjustments !== undefined && (!isObject(reservation.adjustments) || ownEntries(reservation.adjustments).some(([key, adjustment]) => !validId(key) || !isObject(adjustment) || !onlyFields(adjustment, new Set(["requestDigest", "forecast", "at", "actionReceipt"])) || !validDigest(adjustment.requestDigest) || !validMeterMap(adjustment.forecast) || !validIsoInstant(adjustment.at) || (adjustment.actionReceipt !== undefined && !validActionReceipt(adjustment.actionReceipt))))) return false;
  return true;
}

export function validateState(state) {
  const bounded = boundedIssue(state);
  if (bounded) return error(bounded, { source: "state" });
  if (!isObject(state) || state.purpose !== STATE_PURPOSE || state.stateSchemaVersion !== STATE_SCHEMA_VERSION) {
    return error("unsupported_state_schema", { migration: "Remove only an obsolete model-routing state file after preserving required accounting evidence." });
  }
  const fields = new Set(["purpose", "stateSchemaVersion", "capabilities", "budgetEpochs", "taskAuthority", "leases", "reservations", "settlementTombstones", "spendAggregates", "bridges", "learningControl", "learningOutcomes", "learningAggregates", "lifecycleReviewRequirements"]);
  if (!onlyFields(state, fields)) return error("invalid_state", { field: "unknown" });
  for (const field of ["capabilities", "budgetEpochs", "taskAuthority", "leases", "reservations", "settlementTombstones", "spendAggregates", "bridges", "learningControl", "learningOutcomes", "learningAggregates", "lifecycleReviewRequirements"]) {
    if (!isObject(state[field])) return error("invalid_state", { field });
  }
  if (ownEntries(state.capabilities).some(([id, value]) => !validateCapabilityRecord(id, value))) return error("invalid_state", { field: "capabilities" });
  if (ownEntries(state.budgetEpochs).some(([id, value]) => !validId(id) || !isObject(value) || !onlyFields(value, new Set(["frozen", "reason", "sealedAt", "epoch"])) || typeof value.frozen !== "boolean" || (value.reason !== undefined && !["ceiling_breached", "manual_seal"].includes(value.reason)) || (value.sealedAt !== undefined && !validIsoInstant(value.sealedAt)) || (value.epoch !== undefined && (!Number.isInteger(value.epoch) || value.epoch < 0)))) return error("invalid_state", { field: "budgetEpochs" });
  if (ownEntries(state.taskAuthority).some(([id, value]) => !validateTaskAuthorityRecord(id, value))) return error("invalid_state", { field: "taskAuthority" });
  if (ownEntries(state.leases).some(([id, value]) => !validateLeaseRecord(id, value))) return error("invalid_state", { field: "leases" });
  if (ownEntries(state.reservations).some(([id, value]) => !validateReservationRecord(id, value))) return error("invalid_state", { field: "reservations" });
  if (Object.values(state.reservations).some((reservation) => reservation.authorityBinding && (!state.taskAuthority[reservation.authorityBinding.authorityId] || stableDigest(authorityFacts(state.taskAuthority[reservation.authorityBinding.authorityId])) !== reservation.authorityBinding.authorityFactsDigest || state.taskAuthority[reservation.authorityBinding.authorityId].attestationDigest !== reservation.authorityBinding.attestationDigest))) return error("invalid_state", { field: "reservationAuthorityBinding" });
  if (Object.values(state.reservations).some((reservation) => reservation.leaseId !== undefined && (!state.leases[reservation.leaseId] || (ACTIVE_CLAIM_PHASES.has(reservation.phase) && (!state.leases[reservation.leaseId].allocations[reservation.reservationId] || state.leases[reservation.leaseId].allocations[reservation.reservationId].claimId !== reservation.claimId))))) return error("invalid_state", { field: "reservationLeaseBinding" });
  if (Object.values(state.leases).some((lease) => ownEntries(lease.allocations).some(([reservationId, allocation]) => !state.reservations[reservationId] || state.reservations[reservationId].leaseId !== lease.leaseId || state.reservations[reservationId].claimId !== allocation.claimId || !ACTIVE_CLAIM_PHASES.has(state.reservations[reservationId].phase)))) return error("invalid_state", { field: "leaseReservationBinding" });
  if (ownEntries(state.settlementTombstones).some(([id, value]) => !validId(id) || !isObject(value) || !onlyFields(value, new Set(["reservationId", "claimId", "frozenInputDigest", "phase", "at", "producer", "adapterVersion", "identityDigest", "importerId", "importerVersion", "attestationDigest", "settlementDisclosure"])) || !validId(value.reservationId) || !validId(value.claimId) || !validDigest(value.frozenInputDigest) || !["settled", "no_start", "ambiguous", "started"].includes(value.phase) || !validIsoInstant(value.at) || !validId(value.producer) || !validId(value.adapterVersion) || !validDigest(value.identityDigest) || value.importerId !== TRUSTED_RECEIPT_IMPORTER_ID || value.importerVersion !== TRUSTED_RECEIPT_IMPORTER_VERSION || !validDigest(value.attestationDigest) || !validR28Disclosure(value.settlementDisclosure))) return error("invalid_state", { field: "settlementTombstones" });
  if (ownEntries(state.spendAggregates).some(([scope, meters]) => !/^scope_[a-f0-9]{24}$/.test(scope) || !isObject(meters) || ownEntries(meters).some(([meter, value]) => !validMeter(meter) || !isObject(value) || !onlyFields(value, new Set(["hardAccounted", "provenance", "at"])) || !parseMeterAmount(meter, value.hardAccounted).ok || !["measured_billed", "calculated_estimate"].includes(value.provenance) || (value.at !== undefined && !validIsoInstant(value.at))))) return error("invalid_state", { field: "spendAggregates" });
  if (ownEntries(state.bridges).some(([id, value]) => !validId(id) || !isObject(value) || !onlyFields(value, new Set(["acknowledged", "reservationId", "claimId", "at", "identityDigest", "carrierId", "adapterId"])) || value.acknowledged !== true || !validId(value.reservationId) || !validId(value.claimId) || !validIsoInstant(value.at) || !validDigest(value.identityDigest) || !isKnownCarrier(value.carrierId) || !ADAPTER_DESCRIPTORS[value.adapterId])) return error("invalid_state", { field: "bridges" });
  if (!onlyFields(state.learningControl, new Set(["disabled", "clearedAt"])) || (state.learningControl.disabled !== undefined && typeof state.learningControl.disabled !== "boolean") || (state.learningControl.clearedAt !== undefined && !validIsoInstant(state.learningControl.clearedAt))) return error("invalid_state", { field: "learningControl" });
  if (ownEntries(state.learningOutcomes).some(([id, value]) => !validLearningOutcome(id, value))) return error("invalid_state", { field: "learningOutcomes" });
  if (ownEntries(state.learningAggregates).some(([id, value]) => !validLearningAggregate(id, value))) return error("invalid_state", { field: "learningAggregates" });
  if (ownEntries(state.lifecycleReviewRequirements).some(([id, value]) => !validLifecycleReviewRequirement(id, value))) return error("invalid_state", { field: "lifecycleReviewRequirements" });
  return result(true, "state_valid", { digest: stableDigest(state) });
}

function stateSizeBytes(state) {
  return Buffer.byteLength(JSON.stringify(state));
}

/**
 * Retain active claims, live capability evidence, allocator leases, and recent
 * settlement tombstones.  Only optional learning samples and terminal records
 * older than the published retention window are eligible for compaction.
 */
function pruneEligibleState(state, now) {
  const removeOldest = (records, predicate = () => true) => {
    const candidates = Object.keys(records)
      .filter((id) => predicate(id, records[id]))
      .sort((left, right) => String(records[left].at || records[left].updatedAt || "").localeCompare(String(records[right].at || records[right].updatedAt || "")));
    if (candidates[0]) delete records[candidates[0]];
    return Boolean(candidates[0]);
  };
  while (stateSizeBytes(state) > MAX_STATE_BYTES - SETTLEMENT_HEADROOM_BYTES) {
    if (removeOldest(state.learningOutcomes)) continue;
    if (removeOldest(state.learningAggregates)) continue;
    const cutoff = now - ELIGIBLE_RETENTION_MS;
    const terminal = Object.entries(state.reservations)
      .filter(([, reservation]) => ["settled", "no_start"].includes(reservation.phase) && Date.parse(reservation.updatedAt) <= cutoff)
      .sort(([, left], [, right]) => left.updatedAt.localeCompare(right.updatedAt));
    if (terminal.length === 0) break;
    const [reservationId] = terminal[0];
    delete state.reservations[reservationId];
    for (const [receiptId, tombstone] of ownEntries(state.settlementTombstones)) {
      if (tombstone.reservationId === reservationId && Date.parse(tombstone.at) <= cutoff) delete state.settlementTombstones[receiptId];
    }
  }
}

function ensureStateHeadroom(state, now) {
  pruneEligibleState(state, now);
  return stateSizeBytes(state) <= MAX_STATE_BYTES - SETTLEMENT_HEADROOM_BYTES
    ? { ok: true }
    : error("state_headroom_exhausted", { protectedRecordsRetained: true });
}

function normalizeCommand(input) {
  if (input.command === "learning" && typeof input.operation === "string") return `learning.${input.operation}`;
  return input.command;
}

function validateRequestPrivacy(privacy) {
  return privacy === undefined || (onlyFields(privacy, new Set(["egress", "allowedProviders", "locality", "retention"])) && (privacy.egress === undefined || typeof privacy.egress === "boolean") && (privacy.locality === undefined || Object.hasOwn(LOCALITY_RANK, privacy.locality)) && (privacy.retention === undefined || Object.hasOwn(RETENTION_RANK, privacy.retention)) && (privacy.allowedProviders === undefined || (Array.isArray(privacy.allowedProviders) && privacy.allowedProviders.length > 0 && new Set(privacy.allowedProviders).size === privacy.allowedProviders.length && privacy.allowedProviders.every(validId))));
}

function validateRuntime(runtime) {
  // Runtime availability is attested by a fixed host integration, never by
  // caller JSON.  Keeping the field invalid rather than silently ignoring it
  // prevents a request from selecting a Terra substitution for itself.
  return runtime === undefined;
}

function validateTransport(transport) {
  // Cross-provider compatibility is likewise an embedding-owned measured
  // fact.  A caller cannot request a native or visible-provider path.
  return transport === undefined;
}

function validatePriorRoute(value) {
  return isObject(value) && onlyFields(value, new Set(["reservationId", "claimId", "carrierId", "model", "effort", "adapterId", "adapterVersion", "policyDigest", "hostScope", "accountScope", "sessionId", "toolId", "toolVersion", "workClassDigest", "r52Digest"])) && validId(value.reservationId) && validId(value.claimId) && isKnownCarrier(value.carrierId) && validModel(value.model) && validEffort(value.effort) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validId(value.adapterVersion) && validPolicyDigest(value.policyDigest) && validId(value.hostScope) && validId(value.accountScope) && validId(value.sessionId) && validId(value.toolId) && validId(value.toolVersion) && validDigest(value.workClassDigest) && (value.r52Digest === undefined || validDigest(value.r52Digest));
}

function validateBudgetScopes(value) {
  if (value === undefined) return true;
  if (!onlyFields(value, new Set(["task", "run", "project"]))) return false;
  return ownEntries(value).every(([kind, id]) => ["task", "run", "project"].includes(kind) && validId(id));
}

function validateAuthorityInput(value) {
  const fields = new Set(["authorityId", "objectiveEpoch", "objectiveDigest", "senderOwner", "accountScope", "carrierId", "adapterId", "policyDigest", "destinationScope", "destinationClass", "maxTaskCount", "currentTurn", "expiresAt", "explicitUserInstructionDigest"]);
  return isObject(value) && onlyFields(value, fields) && validId(value.authorityId) && validId(value.objectiveEpoch) && validDigest(value.objectiveDigest) && validId(value.senderOwner) && validId(value.accountScope) && isKnownCarrier(value.carrierId) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validPolicyDigest(value.policyDigest) && validId(value.destinationScope) && ["visible_task", "delegated_slot"].includes(value.destinationClass) && Number.isInteger(value.maxTaskCount) && value.maxTaskCount >= 1 && value.maxTaskCount <= MAX_LEASE_SLOTS && validId(value.currentTurn) && validIsoInstant(value.expiresAt) && validDigest(value.explicitUserInstructionDigest);
}

function validateLeaseInput(value) {
  const fields = new Set(["leaseId", "issuerScope", "allocatorScopes", "destinationScope", "destinationAccountScope", "epochId", "expiresAt", "carrierId", "adapterId", "ceiling", "maxSlots", "allocatorReceiptDigest"]);
  return isObject(value) && onlyFields(value, fields) && validId(value.leaseId) && validId(value.issuerScope) && validateBudgetScopes(value.allocatorScopes) && Object.keys(value.allocatorScopes || {}).length > 0 && validId(value.destinationScope) && validId(value.destinationAccountScope) && validId(value.epochId) && validIsoInstant(value.expiresAt) && isKnownCarrier(value.carrierId) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validMeterMap(value.ceiling) && Number.isInteger(value.maxSlots) && value.maxSlots >= 1 && value.maxSlots <= MAX_LEASE_SLOTS && validDigest(value.allocatorReceiptDigest);
}

function validateLeaseReference(value) {
  return isObject(value) && onlyFields(value, new Set(["leaseId", "destinationScope", "destinationAccountScope"])) && validId(value.leaseId) && validId(value.destinationScope) && validId(value.destinationAccountScope);
}

function validateRequest(input, command) {
  if (!isObject(input)) return error("invalid_request");
  if (input.contractVersion !== CONTRACT_VERSION) return error("unsupported_contract_version", { expected: CONTRACT_VERSION });
  const bounded = boundedIssue(input);
  if (bounded) return error(bounded);
  const commands = new Set(["validate", "resolve", "admit", "claim-dispatch", "reconcile", "status", "inspect-claim", "refresh", "mint-task-authority", "issue-lease", "accept-lease", "claim-slot", "release-lease", "seal-epoch", "build-work-contract", "learning.inspect", "learning.clear", "learning.disable", "learning.enable"]);
  if (!commands.has(command)) return error("unknown_command");
  const allowed = new Set(["contractVersion", "command", "operation", "callerKind", "role", "adapterId", "dispatchKind", "budgetEffect", "effort", "workShape", "workClassDigest", "priorWorkClassDigest", "contextFork", "r52", "requestId", "actionId", "privacy", "runtime", "risk", "contextClass", "complex", "explicitModelRequirement", "transport", "scope", "scopes", "forecast", "activeReservationId", "bridgeLifecycleId", "taskAuthorityId", "objectiveEpoch", "objectiveDigest", "instructionDigest", "senderOwner", "hostScope", "accountScope", "dispatchIdentity", "destinationScope", "destinationClass", "currentTurn", "postLifecycleRequirementId", "frozenInputDigest", "reservationId", "claimId", "receipt", "remoteProbe", "capability", "ceSeam", "priorRoute", "authority", "lease", "epochId", "workContract"]);
  if (!onlyFields(input, allowed)) return error("unknown_request_field");
  if (input.role !== undefined && !validRole(input.role)) return error("invalid_role");
  if (input.callerKind !== undefined && !CALLER_KINDS.has(input.callerKind)) return error("invalid_caller_kind");
  if (input.adapterId !== undefined && !validId(input.adapterId)) return error("invalid_adapter");
  if (input.dispatchKind !== undefined && !DISPATCH_KINDS.has(input.dispatchKind)) return error("invalid_dispatch_kind");
  if (input.budgetEffect !== undefined && !BUDGET_EFFECTS.has(input.budgetEffect)) return error("invalid_budget_effect");
  if (input.effort !== undefined && !validEffort(input.effort)) return error("invalid_effort");
  if (!validContextFork(input.contextFork)) return error("invalid_context_fork");
  if (input.contextFork !== undefined && (input.adapterId !== "native-subagent-create" || (input.dispatchKind !== undefined && input.dispatchKind !== "subagent_create"))) return error("invalid_context_fork");
  if (input.r52 !== undefined && !validR52Readiness(input.r52)) return error("invalid_r52_readiness");
  if (input.callerKind === "fleet" && ["resolve", "admit"].includes(command) && !r52Ready(input.r52)) return error("model_routing_capability_unavailable");
  const shapeIssue = validShape(input.workShape);
  if (shapeIssue) return error(shapeIssue);
  if (input.requestId !== undefined && !validId(input.requestId)) return error("invalid_request_id");
  if (input.actionId !== undefined && !validId(input.actionId)) return error("invalid_action_id");
  if (!validateRequestPrivacy(input.privacy)) return error("invalid_privacy");
  if (!validateRuntime(input.runtime)) return error("invalid_runtime");
  if (!validateTransport(input.transport)) return error("invalid_transport");
  if (input.scope !== undefined && !validScope(input.scope)) return error("invalid_budget_scope");
  if (!validateBudgetScopes(input.scopes)) return error("invalid_budget_scopes");
  if (input.forecast !== undefined && !validMeterMap(input.forecast)) return error("invalid_forecast");
  if (input.activeReservationId !== undefined && !validId(input.activeReservationId)) return error("invalid_reservation_id");
  if (input.reservationId !== undefined && !validId(input.reservationId)) return error("invalid_reservation_id");
  if (input.claimId !== undefined && !validId(input.claimId)) return error("invalid_claim_id");
  if (input.taskAuthorityId !== undefined && !validId(input.taskAuthorityId)) return error("invalid_task_authority_id");
  if (input.objectiveEpoch !== undefined && !validId(input.objectiveEpoch)) return error("invalid_objective_epoch");
  if (input.senderOwner !== undefined && !validId(input.senderOwner)) return error("invalid_sender_owner");
  if (input.hostScope !== undefined && !validId(input.hostScope)) return error("invalid_host_scope");
  if (input.accountScope !== undefined && !validId(input.accountScope)) return error("invalid_account_scope");
  if (input.dispatchIdentity !== undefined && !validDispatchIdentity(input.dispatchIdentity)) return error("invalid_dispatch_identity");
  if (input.destinationScope !== undefined && !validId(input.destinationScope)) return error("invalid_destination_scope");
  if (input.destinationClass !== undefined && !["visible_task", "delegated_slot"].includes(input.destinationClass)) return error("invalid_destination_class");
  if (input.currentTurn !== undefined && !validId(input.currentTurn)) return error("invalid_current_turn");
  if (input.postLifecycleRequirementId !== undefined && !validId(input.postLifecycleRequirementId)) return error("invalid_lifecycle_requirement");
  if (input.contextClass !== undefined && !validId(input.contextClass)) return error("invalid_context_class");
  if (input.workClassDigest !== undefined && !validDigest(input.workClassDigest)) return error("invalid_work_class_digest");
  if (input.priorWorkClassDigest !== undefined && !validDigest(input.priorWorkClassDigest)) return error("invalid_prior_work_class_digest");
  if (input.objectiveDigest !== undefined && !validDigest(input.objectiveDigest)) return error("invalid_objective_digest");
  if (input.instructionDigest !== undefined && !validDigest(input.instructionDigest)) return error("invalid_instruction_digest");
  if (input.frozenInputDigest !== undefined && !validDigest(input.frozenInputDigest)) return error("invalid_frozen_input_digest");
  if (input.ceSeam !== undefined && !validCeSeam(input.ceSeam)) return error("invalid_ce_seam");
  if (input.ceSeam !== undefined && input.callerKind !== "compound-engineering") return error("ce_seam_caller_required");
  if (input.callerKind === "compound-engineering" && input.ceSeam === undefined && ["resolve", "admit"].includes(command)) return error("ce_seam_required");
  if (input.priorRoute !== undefined && !validatePriorRoute(input.priorRoute)) return error("invalid_prior_route");
  if (input.authority !== undefined && !validateAuthorityInput(input.authority)) return error("invalid_task_authority");
  if (input.authority !== undefined && command !== "mint-task-authority") return error("raw_task_authority_forbidden");
  if (input.lease !== undefined && !((command === "issue-lease" && validateLeaseInput(input.lease)) || (["accept-lease", "claim-slot", "release-lease"].includes(command) && validateLeaseReference(input.lease)))) return error("invalid_lease");
  if (input.epochId !== undefined && !validId(input.epochId)) return error("invalid_epoch_id");
  if (command === "build-work-contract" && !validWorkContractInput(input.workContract)) return error("invalid_work_contract");
  return null;
}

function adapterFor(request, carrier) {
  const adapterId = request.adapterId || carrier.adapters[0];
  const adapter = ADAPTER_DESCRIPTORS[adapterId];
  if (!adapter) return { ok: false, reason: "unsupported_adapter", adapterId };
  if (!carrier.adapters.includes(adapterId)) return { ok: false, reason: "carrier_adapter_mismatch", adapterId };
  if (request.dispatchKind && !adapter.dispatchKinds.includes(request.dispatchKind)) return { ok: false, reason: "adapter_dispatch_mismatch", adapterId };
  if (adapter.budgetEffect === "request-classified") {
    if (request.budgetEffect && !["none", "adjust_active"].includes(request.budgetEffect)) return { ok: false, reason: "adapter_budget_effect_mismatch", adapterId };
  } else if (request.budgetEffect && request.budgetEffect !== adapter.budgetEffect) {
    return { ok: false, reason: "adapter_budget_effect_mismatch", adapterId };
  }
  return { ok: true, adapterId, adapter };
}

function capabilityFor(state, { carrierId, carrier, adapterId, provider, policyDigest, request, now, positive = true }) {
  const hostScope = request.hostScope || "local";
  const accountScope = request.accountScope || provider.account;
  for (const evidence of Object.values(state.capabilities || {})) {
    if (!isObject(evidence) || evidence.carrierId !== carrierId) continue;
    if (evidence.carrierVersion !== carrier.version || evidence.adapterId !== adapterId || evidence.adapterVersion !== ADAPTER_DESCRIPTORS[adapterId]?.version) continue;
    if (evidence.hostScope !== hostScope || evidence.accountScope !== accountScope || evidence.policyDigest !== policyDigest) continue;
    if ((positive && !POSITIVE_CAPABILITY_STATES.has(evidence.state)) || (!positive && !NEGATIVE_CAPABILITY_STATES.has(evidence.state))) continue;
    // Unsupported fixed adapters are not retried merely because a timer
    // elapsed: the capability key already includes policy and adapter version,
    // so a policy/adapter digest change is the only valid invalidation event.
    if (positive ? Date.parse(evidence.expiresAt) <= now : (evidence.negativeClass !== "unsupported" && Date.parse(evidence.expiresAt) <= now)) continue;
    return evidence;
  }
  return null;
}

function completionStateFor(carrier, capability) {
  if (!carrier.requiresCallableAttestation) return "offline_implementation_ready";
  return capability?.state || "offline_implementation_ready";
}

function transportDecision(request, adapter, trustedTransportAttestor) {
  if (typeof trustedTransportAttestor !== "function") {
    return { ok: true, path: "native", bridgePhase: null, provenance: "fixed_local_default", attestorId: "not_applicable" };
  }
  let attestation;
  try {
    attestation = trustedTransportAttestor(Object.freeze({
      contractVersion: CONTRACT_VERSION,
      callerKind: request.callerKind || "local",
      adapterId: adapter.id || request.adapterId,
      dispatchKind: request.dispatchKind || adapter.dispatchKinds[0],
      hostScope: request.hostScope || "local",
      accountScope: request.accountScope || "local",
    }));
  } catch {
    return { ok: false, reason: "trusted_transport_attestor_failed" };
  }
  if (!isObject(attestation) || !onlyFields(attestation, new Set(["attestorId", "attestationDigest", "compatibility", "bridgeAvailable"])) || attestation.attestorId !== TRANSPORT_ATTESTOR || !validDigest(attestation.attestationDigest) || !["native_compatible", "bridge_required", "unknown"].includes(attestation.compatibility) || typeof attestation.bridgeAvailable !== "boolean") return { ok: false, reason: "invalid_transport_attestation" };
  if (attestation.compatibility === "native_compatible") return { ok: true, path: "native", bridgePhase: null, provenance: "measured_fact", attestorId: attestation.attestorId, attestationDigest: attestation.attestationDigest };
  if (attestation.compatibility === "bridge_required" || attestation.compatibility === "unknown") {
    if (!attestation.bridgeAvailable) return { ok: false, reason: "provider_bridge_unavailable" };
    if (!adapter.visibleTask || !adapter.requiresTaskAuthority) return { ok: false, reason: "visible_bridge_adapter_required" };
    return {
      ok: true,
      path: "visible_provider_task",
      bridgePhase: validId(request.bridgeLifecycleId) ? "activation" : "bootstrap",
      provenance: "measured_fact",
      attestorId: attestation.attestorId,
      attestationDigest: attestation.attestationDigest,
    };
  }
  return { ok: false, reason: "transport_incompatible" };
}

function modelGeneration(value) {
  const match = typeof value === "string" ? value.match(/(?:^|[^0-9])(\d+(?:\.\d+){0,3})(?:$|[^0-9])/i) : null;
  return match ? match[1].split(".").map(Number) : null;
}

function minimumGenerationSatisfied(model, observed) {
  if (!model.minimumGeneration) return true;
  const minimum = model.minimumGeneration.split(".").map(Number);
  const actual = modelGeneration(observed);
  if (!actual) return false;
  for (let i = 0; i < Math.max(minimum.length, actual.length); i += 1) {
    const left = actual[i] || 0;
    const right = minimum[i] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

function shapeMatches(required, actual = {}) {
  for (const [field, allowed] of ownEntries(required || {})) {
    if (!SHAPE_FIELDS.includes(field) || !Array.isArray(allowed) || !allowed.includes(actual[field] || "unknown")) return false;
  }
  return true;
}

function privacyAllows(provider, model, carrier, request, catalog) {
  const catalogPrivacy = catalog?.privacy || {};
  const requestPrivacy = request.privacy || {};
  if (catalogPrivacy.egress === false && requestPrivacy.egress === true) return false;
  const egressForbidden = catalogPrivacy.egress === false || requestPrivacy.egress === false;
  if (egressForbidden && (!["local", "local_host"].includes(provider.executionSurface) || carrier.externalEgress === true)) return false;
  const catalogAllowed = catalogPrivacy.allowedProviders;
  const requestAllowed = requestPrivacy.allowedProviders;
  if (Array.isArray(catalogAllowed) && Array.isArray(requestAllowed) && requestAllowed.some((item) => !catalogAllowed.includes(item))) return false;
  const allowed = requestAllowed || catalogAllowed;
  if (Array.isArray(allowed) && !allowed.includes(model.provider)) return false;
  const requestedLocality = requestPrivacy.locality === undefined ? LOCALITY_RANK.external : LOCALITY_RANK[requestPrivacy.locality];
  const catalogLocality = catalogPrivacy.locality === undefined ? LOCALITY_RANK.external : LOCALITY_RANK[catalogPrivacy.locality];
  const requestedRetention = requestPrivacy.retention === undefined ? RETENTION_RANK.provider_default : RETENTION_RANK[requestPrivacy.retention];
  const catalogRetention = catalogPrivacy.retention === undefined ? RETENTION_RANK.provider_default : RETENTION_RANK[catalogPrivacy.retention];
  const providerLocality = LOCALITY_RANK[provider.locality || "external"];
  const providerRetention = RETENTION_RANK[provider.retention || "provider_default"];
  if (providerLocality > Math.min(requestedLocality, catalogLocality) || providerRetention > Math.min(requestedRetention, catalogRetention)) return false;
  return true;
}

function effortFor(request, model, carrier) {
  const effort = request.effort || model.effort || model.efforts?.[0] || carrier.efforts[0];
  if (!validEffort(effort) || !carrier.efforts.includes(effort) || (model.efforts && !model.efforts.includes(effort))) return null;
  return effort;
}

function fallbackSetDigest(model) {
  return stableDigest([model.requestedModel, ...(model.fallbackSet || [])].sort());
}

function freshRate(candidate, now) {
  const resolvedModel = candidate.observedModel === "unknown" ? candidate.model.requestedModel : candidate.observedModel;
  const resolvedModelDigest = stableDigest(resolvedModel);
  const eligible = [];
  for (const rate of candidate.model.rates || []) {
    const checkedAt = Date.parse(rate.checkedAt);
    const effectiveAt = Date.parse(rate.effectiveAt);
    const expiresAt = rate.promotionExpiresAt ? Date.parse(rate.promotionExpiresAt) : null;
    const staleAfter = (rate.staleAfterSeconds || DEFAULT_RATE_STALE_MS / 1000) * 1000;
    if (rate.carrierId !== candidate.model.carrierId || rate.carrierVersion !== candidate.carrier.version || rate.effort !== candidate.effort || rate.billingSurface !== candidate.provider.executionSurface || rate.resolvedModelDigest !== resolvedModelDigest || effectiveAt > now || checkedAt + staleAfter <= now || (expiresAt !== null && expiresAt <= now)) continue;
    const parsed = parseMeterAmount(rate.meter, rate.amount);
    if (parsed.ok) eligible.push({ meter: rate.meter, units: parsed.units, checkedAt, resolvedModelDigest, billingSurface: rate.billingSurface });
  }
  eligible.sort((left, right) => right.checkedAt - left.checkedAt || (left.meter === right.meter ? (left.units < right.units ? -1 : left.units > right.units ? 1 : 0) : left.meter.localeCompare(right.meter)));
  return eligible[0] || null;
}

function claudeIdentitySatisfied(model, observed) {
  const requested = parseClaudeFamily(model.requestedModel);
  const actual = parseClaudeFamily(observed);
  if (!requested || !actual || requested.family !== actual.family) return false;
  if (model.identityMode === "exact_pin") return requested.selector === actual.selector;
  if (model.minimumGeneration && actual.selector === "current") return false;
  return minimumGenerationSatisfied(model, observed);
}

function configuredCandidates(catalog, request, state, now, policyDigest, { trustedTransportAttestor, fixedReceiptProducers } = {}) {
  const roleRule = catalog.roles[request.role];
  if (!roleRule) return [{ ok: false, reason: "role_unconfigured", alias: null }];
  const output = [];
  for (let tierIndex = 0; tierIndex < roleRule.tiers.length; tierIndex += 1) {
    const tier = roleRule.tiers[tierIndex];
    const aliases = Array.isArray(tier) ? tier : tier.models;
    const priorities = tierIndex === 0 && isObject(tier) && tier.softPriorities !== undefined ? tier.softPriorities : [];
    for (let position = 0; position < aliases.length; position += 1) {
      const alias = aliases[position];
      const model = catalog.models[alias];
      const provider = catalog.providers[model.provider];
      const carrier = CARRIER_DESCRIPTORS[model.carrierId];
      if (!carrier) {
        output.push({ ok: false, alias, tierIndex, position, reason: "unsupported_adapter" });
        continue;
      }
      const adapterResult = adapterFor(request, carrier);
      if (!adapterResult.ok) {
        output.push({ ok: false, alias, tierIndex, position, reason: adapterResult.reason });
        continue;
      }
      if (model.roles && !model.roles.includes(request.role)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "role_ineligible" });
        continue;
      }
      if (!carrier.roles.includes(request.role)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "carrier_role_unsupported" });
        continue;
      }
      if (fixedReceiptProducers && !fixedReceiptProducers.has(adapterResult.adapter.receiptProducer)) {
        // A public CLI cannot select a configured route it cannot settle with
        // one of its source-owned fixed importers. Do not expose a partially
        // routable adapter as an operational path.
        output.push({ ok: false, alias, tierIndex, position, reason: "transport_unsupported" });
        continue;
      }
      if (carrier.transport === "claude-cli-via-ce" && request.ceSeam === undefined) {
        output.push({ ok: false, alias, tierIndex, position, reason: "ce_seam_required" });
        continue;
      }
      if (request.ceSeam !== undefined && !ceSeamAllows(request.ceSeam, request.role, model.carrierId)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "ce_seam_binding_mismatch" });
        continue;
      }
      if (carrier.executionSurface && provider.executionSurface !== carrier.executionSurface) {
        output.push({ ok: false, alias, tierIndex, position, reason: "execution_surface_mismatch" });
        continue;
      }
      const effort = effortFor(request, model, carrier);
      if (!effort) {
        output.push({ ok: false, alias, tierIndex, position, reason: "effort_unsupported" });
        continue;
      }
      if (!shapeMatches(model.workShape, request.workShape)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "work_shape_ineligible" });
        continue;
      }
      if (!privacyAllows(provider, model, carrier, request, catalog)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "privacy_ineligible" });
        continue;
      }
      const negativeCapability = capabilityFor(state, { carrierId: model.carrierId, carrier, adapterId: adapterResult.adapterId, provider, policyDigest, request, now, positive: false });
      if (negativeCapability) {
        output.push({ ok: false, alias, tierIndex, position, reason: negativeCapability.negativeReason, notBefore: negativeCapability.notBefore || negativeCapability.expiresAt, negativeClass: negativeCapability.negativeClass });
        continue;
      }
      const capability = capabilityFor(state, { carrierId: model.carrierId, carrier, adapterId: adapterResult.adapterId, provider, policyDigest, request, now });
      if (capability?.authState === "auth_context_unavailable") {
        output.push({ ok: false, alias, tierIndex, position, reason: "auth_context_unavailable" });
        continue;
      }
      if (carrier.requiresCallableAttestation && !capability) {
        output.push({ ok: false, alias, tierIndex, position, reason: "transport_unsupported" });
        continue;
      }
      const observedModel = capability?.observedModel || model.resolvedModel;
      if (model.identityMode === "provider_latest_family" && !observedModel) {
        output.push({ ok: false, alias, tierIndex, position, reason: "current_family_unattested" });
        continue;
      }
      if (model.identityMode === "provider_latest_family" && capability?.fallbackSetDigest !== fallbackSetDigest(model)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "fallback_set_unattested" });
        continue;
      }
      if (model.requiredCapabilities && model.requiredCapabilities.some((item) => !capability?.capabilities?.includes(item))) {
        output.push({ ok: false, alias, tierIndex, position, reason: "required_capability_unattested" });
        continue;
      }
      if (model.carrierId === "claude-ce-review" && !claudeIdentitySatisfied(model, observedModel || model.requestedModel)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "claude_identity_mismatch" });
        continue;
      }
      if (model.carrierId !== "claude-ce-review" && !minimumGenerationSatisfied(model, observedModel || model.requestedModel)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "minimum_generation_unmet" });
        continue;
      }
      const transport = transportDecision(request, adapterResult.adapter, trustedTransportAttestor);
      if (!transport.ok) {
        output.push({ ok: false, alias, tierIndex, position, reason: transport.reason });
        continue;
      }
      output.push({
        ok: true,
        alias,
        tierIndex,
        position,
        priorities,
        model,
        provider,
        carrier,
        adapter: adapterResult.adapter,
        adapterId: adapterResult.adapterId,
        effort,
        capability,
        transport,
        observedModel: observedModel || "unknown",
        exactRate: null,
      });
      output[output.length - 1].exactRate = freshRate(output[output.length - 1], now);
      output[output.length - 1].learning = learningHintForCandidate(state, request, output[output.length - 1]);
    }
  }
  return output;
}

function candidateSort(left, right) {
  if (left.tierIndex !== right.tierIndex) return left.tierIndex - right.tierIndex;
  for (const priority of left.priorities) {
    if (priority === "learnedEstimate") {
      // This is an explicitly configured, first-tier-only observational
      // tiebreak.  It is never an eligibility, fallback, or policy-ordering
      // input, and final alias order still breaks an equal learned estimate.
      if (left.tierIndex === 0 && right.tierIndex === 0) {
        const a = left.learning?.routeEffect?.tieBreakInfluence;
        const b = right.learning?.routeEffect?.tieBreakInfluence;
        const aKnown = Number.isFinite(a);
        const bKnown = Number.isFinite(b);
        if (aKnown !== bKnown) return aKnown ? -1 : 1;
        if (aKnown && a !== b) return b - a;
      }
      continue;
    }
    const direction = priority === "quality" || priority === "reliability" ? -1 : 1;
    if (priority === "cost" && left.exactRate && right.exactRate && left.exactRate.meter === right.exactRate.meter && left.exactRate.units !== right.exactRate.units) {
      return left.exactRate.units < right.exactRate.units ? -1 : 1;
    }
    const key = priority === "cost" ? "relativeCostIndex" : priority;
    const a = left.model[key];
    const b = right.model[key];
    const aKnown = Number.isFinite(a);
    const bKnown = Number.isFinite(b);
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && a !== b) return direction * (a - b);
  }
  return left.position - right.position;
}

function fixedRuntimeDecision(trustedRuntimeAttestor) {
  // Luna's default identity is a fixed router-owned runtime fact.  The caller
  // cannot supply a runtime object; Terra is accepted only from the separate
  // fixed host-attestor path below.
  if (typeof trustedRuntimeAttestor !== "function") return {
    lunaAvailability: "available",
    provenance: "fixed_runtime_attestor",
    attestorId: RUNTIME_ATTESTOR,
    attestationDigest: stableDigest({ runtime: "codex", lunaAvailability: "available", model: CARRIER_DESCRIPTORS["codex-luna"].requestedModel }),
  };
  let attestation;
  try { attestation = trustedRuntimeAttestor(Object.freeze({ contractVersion: CONTRACT_VERSION, runtime: "codex" })); }
  catch { return null; }
  if (!isObject(attestation) || !onlyFields(attestation, new Set(["attestorId", "attestationDigest", "lunaAvailability", "terra"])) || attestation.attestorId !== RUNTIME_ATTESTOR || !validDigest(attestation.attestationDigest) || !["available", "unavailable", "unselectable", "unknown"].includes(attestation.lunaAvailability)) return null;
  if (attestation.terra !== undefined && (!onlyFields(attestation.terra, new Set(["verified", "model", "effort"])) || attestation.terra.verified !== true || !validModel(attestation.terra.model) || attestation.terra.effort !== "max")) return null;
  return { ...attestation, provenance: "measured_fact" };
}

function defaultRoute(request, { trustedRuntimeAttestor, trustedTransportAttestor } = {}) {
  const implementation = request.role === "implementation" || request.role?.startsWith("implementation.");
  const complex = request.risk === "high" || request.risk === "critical" || request.complex === true;
  let carrierId = implementation ? "codex-luna" : "codex-sol";
  let effort = implementation ? "max" : complex ? "max" : "high";
  let substitute = null;
  const runtime = fixedRuntimeDecision(trustedRuntimeAttestor);
  if (!runtime) return { ok: false, reason: "invalid_runtime_attestation" };
  if (implementation && ["unavailable", "unselectable"].includes(runtime.lunaAvailability) && !request.explicitModelRequirement) {
    const terra = runtime.terra;
    if (!isObject(terra) || terra.verified !== true || !validModel(terra.model) || terra.effort !== "max") {
      return { ok: false, reason: "preferred_unavailable" };
    }
    carrierId = "codex-terra-runtime";
    effort = "max";
    substitute = "implementation_model_substitute";
  }
  const carrier = CARRIER_DESCRIPTORS[carrierId];
  const adapterResult = adapterFor(request, carrier);
  if (!adapterResult.ok) return { ok: false, reason: adapterResult.reason };
  const transport = transportDecision(request, adapterResult.adapter, trustedTransportAttestor);
  if (!transport.ok) return { ok: false, reason: transport.reason };
  const model = carrierId === "codex-terra-runtime" ? runtime.terra.model : carrier.requestedModel;
  return {
    ok: true,
    alias: carrierId,
    model: { carrierId, requestedModel: model, relativeCostIndex: undefined },
    provider: { executionSurface: "codex", carrierId },
    carrier,
    adapterId: adapterResult.adapterId,
    adapter: adapterResult.adapter,
    effort,
    transport,
    observedModel: "unknown",
    substitute,
    capability: null,
    tierIndex: 0,
    priorities: [],
    runtime,
  };
}

function disclosureFacet(value, provenance = "unknown") {
  return {
    value: value === undefined || value === null ? "unknown" : clone(value),
    provenance,
  };
}

function notApplicableFacet() {
  return disclosureFacet("not_applicable", "not_applicable");
}

function meterDisclosure(value, provenance) {
  if (value === undefined || value === null) return disclosureFacet("unknown", "unknown");
  if (value === "not_applicable") return notApplicableFacet();
  return disclosureFacet(value, provenance);
}

function normalizedChargedMeters(value) {
  if (value === undefined || value === null) return "not_applicable";
  if (!isObject(value)) return "unknown";
  const normalized = {};
  for (const [meter, amount] of ownEntries(value)) {
    if (!validMeter(meter) || (typeof amount !== "number" && typeof amount !== "string")) return "unknown";
    normalized[meter] = String(amount);
  }
  return validMeterMap(normalized) ? normalized : "unknown";
}

/**
 * R28 is a deliberately content-free disclosure.  It never accepts prompt,
 * response, command, endpoint URL, filesystem path, or provider payload data.
 */
function r28RouteDisclosure(candidate, request, {
  route = "selected",
  reasonCode = "selected",
  rejectedAlternatives = [],
  forecast,
  reservation,
  actual,
  charged,
  receipt,
  notApplicable = false,
} = {}) {
  const model = candidate?.model || {};
  const provider = candidate?.provider || {};
  const carrier = candidate?.carrier || {};
  const capability = candidate?.capability || null;
  const observedModel = receipt?.observedModel || candidate?.observedModel;
  const requested = notApplicable
    ? Object.fromEntries(["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"].map((field) => [field, notApplicableFacet()]))
    : {
      provider: disclosureFacet(model.provider || "not_applicable", model.provider ? "catalog" : "not_applicable"),
      endpointClass: disclosureFacet(provider.executionSurface || "unknown", provider.executionSurface ? "catalog" : "unknown"),
      executionSurface: disclosureFacet(provider.executionSurface || "unknown", provider.executionSurface ? "catalog" : "unknown"),
      billingSurface: disclosureFacet(model.billingSurface || provider.executionSurface || "unknown", model.billingSurface || provider.executionSurface ? "catalog" : "unknown"),
      model: disclosureFacet(model.requestedModel || "unknown", model.requestedModel ? "catalog" : "unknown"),
      effort: disclosureFacet(candidate?.effort || "unknown", candidate?.effort ? "catalog" : "unknown"),
    };
  const configured = notApplicable
    ? Object.fromEntries(["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"].map((field) => [field, notApplicableFacet()]))
    : {
      provider: disclosureFacet(model.provider || "not_applicable", model.provider ? "catalog" : "not_applicable"),
      endpointClass: disclosureFacet(provider.executionSurface || "unknown", provider.executionSurface ? "catalog" : "unknown"),
      executionSurface: disclosureFacet(provider.executionSurface || "unknown", provider.executionSurface ? "catalog" : "unknown"),
      billingSurface: disclosureFacet(model.billingSurface || provider.executionSurface || "unknown", model.billingSurface || provider.executionSurface ? "catalog" : "unknown"),
      model: disclosureFacet(model.requestedModel || "unknown", model.requestedModel ? "catalog" : "unknown"),
      effort: disclosureFacet(candidate?.effort || "unknown", candidate?.effort ? "catalog" : "unknown"),
    };
  return {
    schema: "yardmaster/r28-route-disclosure/v1",
    route,
    reasonCode,
    requested,
    configured,
    observed: {
      provider: disclosureFacet("unknown", "unknown"),
      endpointClass: disclosureFacet(receipt?.executionSurface || provider.executionSurface || "unknown", receipt?.executionSurface || provider.executionSurface ? "adapter_receipt" : "unknown"),
      executionSurface: disclosureFacet(receipt?.executionSurface || provider.executionSurface || "unknown", receipt?.executionSurface || provider.executionSurface ? "adapter_receipt" : "unknown"),
      billingSurface: disclosureFacet(receipt?.billingSurface || provider.executionSurface || "unknown", receipt?.billingSurface || provider.executionSurface ? "adapter_receipt" : "unknown"),
      model: disclosureFacet(observedModel || "unknown", observedModel ? (receipt ? "adapter_receipt" : "capability_attestation") : "unknown"),
      effort: disclosureFacet(receipt?.effectiveEffort || "unknown", receipt?.effectiveEffort ? "adapter_receipt" : "unknown"),
    },
    carrier: {
      carrierId: disclosureFacet(notApplicable ? "not_applicable" : (candidate?.model?.carrierId || candidate?.alias || "unknown"), notApplicable ? "not_applicable" : "catalog"),
      carrierVersion: disclosureFacet(notApplicable ? "not_applicable" : (carrier.version || candidate?.selected?.carrierVersion || "unknown"), notApplicable ? "not_applicable" : "catalog"),
      adapterId: disclosureFacet(notApplicable ? "not_applicable" : (candidate?.adapterId || "unknown"), notApplicable ? "not_applicable" : "catalog"),
      adapterVersion: disclosureFacet(notApplicable ? "not_applicable" : (candidate?.adapter?.version || "unknown"), notApplicable ? "not_applicable" : "catalog"),
      probeId: disclosureFacet(capability?.probeId || "unknown", capability?.probeId ? "capability_attestation" : "unknown"),
      probeVersion: disclosureFacet(capability?.probeVersion || "unknown", capability?.probeVersion ? "capability_attestation" : "unknown"),
      probeDigest: disclosureFacet(capability?.probeDigest || "unknown", capability?.probeDigest ? "capability_attestation" : "unknown"),
    },
    meters: {
      forecast: meterDisclosure(forecast, forecast === undefined ? "unknown" : "request"),
      reservation: meterDisclosure(reservation, reservation === undefined ? "unknown" : "reservation"),
      actual: meterDisclosure(actual, actual === undefined ? "unknown" : "adapter_receipt"),
      charged: meterDisclosure(charged, charged === undefined ? "not_applicable" : "adapter_receipt"),
    },
    capability: {
      state: disclosureFacet(capability?.state || "unknown", capability ? "capability_attestation" : "unknown"),
      freshness: disclosureFacet(capability?.expiresAt || "unknown", capability ? "capability_attestation" : "unknown"),
      provenance: disclosureFacet(capability ? "measured_fact" : "unknown", capability ? "capability_attestation" : "unknown"),
    },
    privacy: {
      egress: disclosureFacet(notApplicable ? "not_applicable" : (carrier.externalEgress === true ? "external" : "adapter_defined"), notApplicable ? "not_applicable" : "router_calculation"),
      locality: disclosureFacet(notApplicable ? "not_applicable" : (provider.locality || "unknown"), notApplicable ? "not_applicable" : (provider.locality ? "catalog" : "unknown")),
      retention: disclosureFacet(notApplicable ? "not_applicable" : (provider.retention || "unknown"), notApplicable ? "not_applicable" : (provider.retention ? "catalog" : "unknown")),
    },
    rejectedAlternatives: rejectedAlternatives.map((item) => ({ modelAlias: item.modelAlias || "unknown", reason: item.reason || "unknown" })),
    attribution: {
      parent: notApplicableFacet(),
      child: disclosureFacet(notApplicable ? "not_applicable" : "carrier_execution", notApplicable ? "not_applicable" : "router_calculation"),
      boundary: disclosureFacet(notApplicable ? "not_applicable" : "router_selects_adapter_executes", notApplicable ? "not_applicable" : "router_calculation"),
    },
    escalation: {
      state: disclosureFacet("not_requested", "not_applicable"),
      provenance: notApplicableFacet(),
    },
  };
}

function settlementDisclosure(reservation, receipt) {
  const disclosure = clone(reservation.decision.disclosure);
  disclosure.route = "settlement";
  disclosure.reasonCode = receipt.status === "settled" && (receipt.reason === undefined || receipt.reason === null) ? "settled" : (receipt.reason || receipt.status);
  disclosure.observed.model = disclosureFacet(receipt.observedModel || disclosure.observed.model.value || "unknown", receipt.observedModel ? "adapter_receipt" : disclosure.observed.model.provenance);
  disclosure.observed.effort = disclosureFacet(receipt.effectiveEffort || "unknown", receipt.effectiveEffort ? "adapter_receipt" : "unknown");
  disclosure.observed.endpointClass = disclosureFacet(receipt.executionSurface || disclosure.observed.endpointClass.value || "unknown", receipt.executionSurface ? "adapter_receipt" : disclosure.observed.endpointClass.provenance);
  disclosure.observed.executionSurface = disclosureFacet(receipt.executionSurface || disclosure.observed.executionSurface.value || "unknown", receipt.executionSurface ? "adapter_receipt" : disclosure.observed.executionSurface.provenance);
  disclosure.meters = {
    forecast: meterDisclosure(reservation.forecast, "request"),
    reservation: meterDisclosure(reservation.forecast, "reservation"),
    actual: meterDisclosure(receipt.measuredUsage || {}, "adapter_receipt"),
    charged: meterDisclosure(normalizedChargedMeters(receipt.chargedMeters), receipt.chargedMeters ? "adapter_receipt" : "not_applicable"),
  };
  disclosure.capability = {
    state: disclosureFacet(receipt.authReadiness || disclosure.capability.state.value || "unknown", receipt.authReadiness ? "adapter_receipt" : disclosure.capability.state.provenance),
    freshness: disclosureFacet(receipt.expiresAt || disclosure.capability.freshness.value || "unknown", receipt.expiresAt ? "adapter_receipt" : disclosure.capability.freshness.provenance),
    provenance: disclosureFacet(receipt.authReadiness || receipt.expiresAt ? "measured_fact" : disclosure.capability.provenance.value, receipt.authReadiness || receipt.expiresAt ? "adapter_receipt" : disclosure.capability.provenance.provenance),
  };
  return disclosure;
}

function decisionFromCandidate(candidate, request, policy, now, rejected = []) {
  const selectedModel = candidate.observedModel === "unknown"
    ? candidate.model.requestedModel
    : candidate.observedModel;
  const hostScope = request.hostScope || request.destinationScope || request.priorRoute?.hostScope || candidate.capability?.hostScope || "local";
  const accountScope = request.accountScope || request.priorRoute?.accountScope || candidate.capability?.accountScope || candidate.provider.account || "local";
  const readiness = request.r52 === undefined ? null : r52Binding(request.r52);
  const requestDigest = stableDigest({
    role: request.role,
    callerKind: request.callerKind || "local",
    adapterId: candidate.adapterId,
    dispatchKind: request.dispatchKind || candidate.adapter.dispatchKinds[0],
    workShape: request.workShape || {},
    policyDigest: policy.digest,
    model: selectedModel,
    effort: candidate.effort,
    transport: candidate.transport,
    hostScope,
    accountScope,
    contextFork: request.contextFork || "not_applicable",
    r52Digest: readiness?.digest || "not_applicable",
  });
  const decision = {
    decisionId: opaqueId("decision", requestDigest),
    policy: policy,
    role: request.role,
    requested: {
      model: candidate.model.requestedModel,
      effort: candidate.effort,
      provider: candidate.model.provider || "codex",
    },
    selected: {
      modelAlias: candidate.alias,
      model: selectedModel,
      effort: candidate.effort,
      carrierId: candidate.model.carrierId || candidate.alias,
      carrierVersion: candidate.carrier.version,
      executionSurface: candidate.provider.executionSurface,
      transport: candidate.carrier.transport,
      adapterId: candidate.adapterId,
      adapterVersion: candidate.adapter.version,
      completionState: completionStateFor(candidate.carrier, candidate.capability),
      observedModel: candidate.observedModel,
    },
    binding: {
      adapterId: candidate.adapterId,
      adapterVersion: candidate.adapter.version,
      dispatchKind: request.dispatchKind || candidate.adapter.dispatchKinds[0],
      budgetEffect: request.budgetEffect || (candidate.adapter.budgetEffect === "request-classified" ? "none" : candidate.adapter.budgetEffect),
      controls: candidate.adapter.controls,
      transportPath: candidate.transport.path,
      bridgePhase: candidate.transport.bridgePhase,
      hostScope,
      accountScope,
    },
    requestedVsActual: {
      requestedModel: candidate.model.requestedModel,
      observedModel: candidate.observedModel,
      requestedEffort: candidate.effort,
      effectiveEffort: "unknown",
    },
    capability: {
      status: candidate.capability?.state || "unknown",
      freshness: candidate.capability?.expiresAt || "unknown",
      provenance: candidate.capability ? "measured_fact" : "maintainer_heuristic",
    },
    privacy: {
      egress: candidate.carrier.externalEgress === true ? "external" : "adapter-defined",
      locality: candidate.provider.locality || "external",
      retention: candidate.provider.retention || "provider_default",
    },
    rejectedAlternatives: rejected,
    generatedAt: nowIso(now),
    workClassDigest: derivedWorkClassDigest(request),
  };
  if (request.contextFork !== undefined) decision.binding.contextFork = request.contextFork;
  if (readiness) decision.binding.r52 = readiness;
  decision.learning = candidate.learning || "not_applicable";
  decision.disclosure = r28RouteDisclosure(candidate, request, { rejectedAlternatives: rejected });
  decision.fallbackReceipt = candidate.substitute
    ? r28RouteDisclosure(candidate, request, { route: "fallback", reasonCode: candidate.substitute, rejectedAlternatives: rejected })
    : r28RouteDisclosure(candidate, request, { route: "fallback", reasonCode: "not_applicable", rejectedAlternatives: [], notApplicable: true });
  if (candidate.carrier.implementationEngine) decision.implementationEngine = clone(candidate.carrier.implementationEngine);
  if (candidate.substitute) decision.fallback = { reason: candidate.substitute, actualModel: selectedModel, effort: candidate.effort, disclosure: clone(decision.fallbackReceipt) };
  if (candidate.carrier.fixedProfile) decision.binding.profile = candidate.carrier.fixedProfile;
  if (candidate.adapter.composite) decision.binding.compositeReservations = ["controller", "claude_child"];
  if (request.ceSeam) {
    decision.binding.ceSeam = clone(request.ceSeam);
    decision.executionOverride = {
      contractVersion: "yardmaster/ce-execution-override/v1",
      seam: clone(request.ceSeam),
      replacement: {
        carrierId: decision.selected.carrierId,
        carrierVersion: decision.selected.carrierVersion,
        adapterId: decision.binding.adapterId,
        adapterVersion: decision.binding.adapterVersion,
      },
      preserve: ["ce_workflow", "ce_persona", "ce_authority"],
    };
  }
  if ((candidate.model.carrierId || candidate.alias) === "oracle-browser") {
    decision.oracle = {
      route: {
        adapter: "oracle-browser",
        requestedModel: "chatgpt_current_pro",
        executionSurface: "chatgpt_standard",
      },
      requestedModel: "chatgpt_current_pro",
      executionSurface: "chatgpt_standard",
      authReadiness: candidate.capability?.authState || "unknown",
      automaticAuthenticationRecovery: "unsupported",
      api: "unsupported",
    };
  }
  return decision;
}

function allowedInheritedAdapterTransition(previousAdapterId, nextAdapterId, carrierId, dispatchKind) {
  if (previousAdapterId === nextAdapterId) return true;
  const key = `${previousAdapterId}->${nextAdapterId}`;
  const allowed = new Set([
    "codex-task-create->codex-task-message",
    "native-subagent-create->native-subagent-message",
    "native-subagent-create->native-subagent-followup",
    "native-subagent-message->native-subagent-followup",
  ]);
  return carrierId.startsWith("codex-") && dispatchKind === "task_message" && key === "codex-task-create->codex-task-message" || carrierId.startsWith("codex-") && dispatchKind.startsWith("subagent_") && allowed.has(key);
}

function inheritedRouteIssue(request, state, decision, catalog) {
  if (!["task_message", "subagent_message", "subagent_followup"].includes(request.dispatchKind)) return null;
  if (!validatePriorRoute(request.priorRoute)) return "prior_route_unknown";
  if (!validDispatchIdentity(request.dispatchIdentity, ADAPTER_DESCRIPTORS[decision.binding.adapterId]?.receiptProducer) || request.dispatchIdentity.dispatchKind !== decision.binding.dispatchKind || request.dispatchIdentity.toolVersion !== decision.binding.adapterVersion) return "prior_destination_identity_required";
  const prior = state.reservations[request.priorRoute.reservationId];
  if (!prior || !ACTIVE_CLAIM_PHASES.has(prior.phase) || prior.claimId !== request.priorRoute.claimId) return "prior_route_unknown";
  const currentWorkClassDigest = decision.workClassDigest;
  if (!validDigest(currentWorkClassDigest) || !validDigest(request.priorWorkClassDigest) || !validDigest(request.priorRoute.workClassDigest) || !validDigest(prior.workClassDigest)) return "prior_work_class_unknown";
  if (request.priorWorkClassDigest !== currentWorkClassDigest || request.priorRoute.workClassDigest !== prior.workClassDigest || prior.workClassDigest !== currentWorkClassDigest) return "prior_work_class_changed_requires_fresh_route";
  const priorIdentity = prior.claimed;
  if (!priorIdentity || request.priorRoute.hostScope !== priorIdentity.hostScope || request.priorRoute.accountScope !== priorIdentity.accountScope || request.priorRoute.sessionId !== priorIdentity.sessionId || request.priorRoute.toolId !== priorIdentity.toolId || request.priorRoute.toolVersion !== priorIdentity.toolVersion) return "prior_destination_identity_mismatch";
  if (request.dispatchIdentity.hostScope !== priorIdentity.hostScope || request.dispatchIdentity.accountScope !== priorIdentity.accountScope || request.dispatchIdentity.sessionId !== priorIdentity.sessionId || request.dispatchIdentity.toolId !== priorIdentity.toolId || request.dispatchIdentity.toolVersion !== priorIdentity.toolVersion) return "prior_destination_identity_mismatch";
  if (decision.binding.hostScope !== priorIdentity.hostScope || decision.binding.accountScope !== priorIdentity.accountScope) return "prior_destination_identity_mismatch";
  const priorR52Digest = prior.binding.r52?.digest || "not_applicable";
  const currentR52Digest = decision.binding.r52?.digest || "not_applicable";
  const declaredR52Digest = request.priorRoute.r52Digest || "not_applicable";
  if (priorR52Digest !== currentR52Digest || declaredR52Digest !== priorR52Digest) return "prior_r52_binding_mismatch";
  if (prior.policyDigest !== decision.policy.digest || request.priorRoute.policyDigest !== decision.policy.digest || prior.selected.carrierId !== request.priorRoute.carrierId || prior.selected.model !== request.priorRoute.model || prior.selected.effort !== request.priorRoute.effort || prior.binding.adapterId !== request.priorRoute.adapterId || prior.binding.adapterVersion !== request.priorRoute.adapterVersion) return "prior_route_binding_mismatch";
  if (decision.selected.carrierId !== prior.selected.carrierId || decision.selected.model !== prior.selected.model || decision.selected.effort !== prior.selected.effort || !allowedInheritedAdapterTransition(prior.binding.adapterId, decision.binding.adapterId, decision.selected.carrierId, decision.binding.dispatchKind)) return "prior_route_binding_mismatch";
  return null;
}

function resolveInternal(request, { catalog = null, state = createEmptyState(), now = Date.now(), trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers } = {}) {
  const catalogValidation = validateCatalog(catalog);
  if (!catalogValidation.ok) return catalogValidation;
  const stateValidation = validateState(state);
  if (!stateValidation.ok) return stateValidation;
  if (!request.role) return error("role_required");
  const workClass = workClassForRequest(request);
  if (!workClass.ok) return workClass;
  let candidate;
  let rejected = [];
  if (!catalog) {
    candidate = defaultRoute(request, { trustedRuntimeAttestor, trustedTransportAttestor });
    if (!candidate.ok) return error(candidate.reason, { policy: clone(DEFAULT_POLICY) });
  } else {
    const candidates = configuredCandidates(catalog, request, state, now, catalogValidation.policy.digest, { trustedTransportAttestor, fixedReceiptProducers });
    const eligible = candidates.filter((item) => item.ok).sort(candidateSort);
    rejected = candidates.filter((item) => !item.ok).map((item) => ({ modelAlias: item.alias, reason: item.reason }));
    if (eligible.length === 0) {
      // In the public CLI this is a concrete fixed-bridge limitation, not an
      // ambiguous policy miss.  Surface the closed reason directly so a
      // caller cannot mistake an unimportable configured adapter for a route
      // that needs another discovery retry.
      if (rejected.length > 0 && rejected.every((item) => item.reason === "transport_unsupported")) return error("transport_unsupported", { policy: catalogValidation.policy, rejectedAlternatives: rejected });
      return error("no_eligible_route", { policy: catalogValidation.policy, rejectedAlternatives: rejected });
    }
    candidate = eligible[0];
    rejected.push(...eligible.slice(1).map((item) => ({ modelAlias: item.alias, reason: item.tierIndex === candidate.tierIndex ? "lower_ranked" : "lower_preference_tier" })));
  }
  const decision = decisionFromCandidate(candidate, request, catalogValidation.policy, now, rejected);
  if (request.ceSeam !== undefined && !ceSeamAllows(request.ceSeam, decision.role, decision.selected.carrierId)) return error("ce_seam_binding_mismatch", { policy: catalogValidation.policy });
  const inheritedIssue = inheritedRouteIssue(request, state, decision, catalog);
  if (inheritedIssue) return error(inheritedIssue, { policy: catalogValidation.policy });
  if (decision.binding.budgetEffect === "none") {
    if (!validId(request.actionId)) return error("action_id_required");
    decision.actionReceipt = actionReceiptFor(request, decision);
    if (!decision.actionReceipt) return error("invalid_action_receipt");
  }
  return result(true, "resolved", { decision });
}

function validMeter(meter) {
  return typeof meter === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(meter);
}

function isUsdMeter(meter) {
  return /usd/i.test(meter);
}

function parseMeterAmount(meter, value) {
  if (!validMeter(meter) || typeof value !== "string") return { ok: false };
  if (isUsdMeter(meter)) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return { ok: false };
    const [whole, fraction = ""] = value.split(".");
    return { ok: true, units: BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6)), kind: "micro-usd" };
  }
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return { ok: false };
  return { ok: true, units: BigInt(value), kind: "integer" };
}

export function meterAmount(meter, value) {
  const parsed = parseMeterAmount(meter, value);
  return parsed.ok ? parsed.units : null;
}

function formatMeterAmount(meter, units) {
  if (isUsdMeter(meter)) {
    const whole = units / 1_000_000n;
    const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  }
  return units.toString();
}

function normalizeForecast(forecast = {}) {
  if (!isObject(forecast)) return { ok: false, reason: "invalid_forecast" };
  const normalized = {};
  for (const [meter, amount] of ownEntries(forecast)) {
    const parsed = parseMeterAmount(meter, amount);
    if (!parsed.ok) return { ok: false, reason: "invalid_forecast" };
    normalized[meter] = amount;
  }
  return { ok: true, value: normalized };
}

function budgetRules(catalog, scopeKind) {
  return catalog?.budgets?.[scopeKind] || {};
}

function spentFor(state, scope, meter) {
  const amount = state.spendAggregates?.[scopeAccountingId(scope)]?.[meter]?.hardAccounted || "0";
  return parseMeterAmount(meter, amount).units;
}

function reservedFor(state, scope, meter) {
  let total = 0n;
  for (const reservation of Object.values(state.reservations || {})) {
    if (!(reservation.scopes || [reservation.scope]).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id) || ["settled", "no_start"].includes(reservation.phase)) continue;
    const lease = reservation.leaseId ? state.leases?.[reservation.leaseId] : null;
    if (lease && (lease.allocatorScopes || []).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id)) continue;
    const value = reservation.forecast?.[meter];
    if (value !== undefined) total += parseMeterAmount(meter, value).units;
  }
  return total;
}

function leasedFor(state, scope, meter) {
  let total = 0n;
  for (const lease of Object.values(state.leases || {})) {
    if (!(lease.allocatorScopes || []).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id)) continue;
    const remaining = lease.remainingCeiling?.[meter];
    if (lease.released !== true && remaining !== undefined) total += parseMeterAmount(meter, remaining).units;
    for (const allocation of Object.values(lease.allocations || {})) {
      const amount = allocation.forecast?.[meter];
      if (amount !== undefined) total += parseMeterAmount(meter, amount).units;
    }
  }
  return total;
}

function carrierEnforces(candidate, meter) {
  return Array.isArray(candidate.carrier.enforcedMeters) && candidate.carrier.enforcedMeters.includes(meter);
}

function budgetAdmission(catalog, state, scope, forecast, candidate) {
  const rules = budgetRules(catalog, scope.kind);
  const warnings = [];
  for (const [meter, rule] of ownEntries(rules)) {
    if ((rule.hardAdmission !== undefined || rule.strict !== undefined) && !Object.hasOwn(forecast, meter)) return { ok: false, reason: "forecast_required", meter };
  }
  for (const [meter, raw] of ownEntries(forecast)) {
    const amount = parseMeterAmount(meter, raw).units;
    const rule = rules[meter] || {};
    for (const [key, reason] of [["hardAdmission", "hard_budget_exceeded"], ["strict", "strict_budget_exceeded"]]) {
      if (rule[key] === undefined) continue;
      const limit = parseMeterAmount(meter, rule[key]);
      if (!limit.ok) return { ok: false, reason: "invalid_budget_limit" };
      if (key === "strict" && !carrierEnforces(candidate, meter)) return { ok: false, reason: "strict_limit_unenforceable", meter };
      if (spentFor(state, scope, meter) + reservedFor(state, scope, meter) + leasedFor(state, scope, meter) + amount > limit.units) return { ok: false, reason, meter };
    }
    if (rule.soft !== undefined) {
      const limit = parseMeterAmount(meter, rule.soft);
      if (!limit.ok) return { ok: false, reason: "invalid_budget_limit" };
      if (spentFor(state, scope, meter) + reservedFor(state, scope, meter) + leasedFor(state, scope, meter) + amount > limit.units) warnings.push({ meter, reason: "soft_budget_exceeded" });
    }
  }
  return { ok: true, warnings };
}

function budgetAdmissionAll(catalog, state, scopes, forecast, candidate) {
  const warnings = [];
  for (const scope of scopes) {
    if (state.budgetEpochs[scopeAccountingId(scope)]?.frozen) return { ok: false, reason: "budget_scope_frozen", scope };
    const admitted = budgetAdmission(catalog, state, scope, forecast, candidate);
    if (!admitted.ok) return { ...admitted, scope };
    warnings.push(...admitted.warnings.map((warning) => ({ ...warning, scope: scope.kind, scopeId: scope.id })));
  }
  return { ok: true, warnings };
}

function scopeFor(request) {
  if (request.scopes !== undefined) {
    const scopes = ownEntries(request.scopes).map(([kind, id]) => ({ kind, id }));
    return validScopes(scopes) ? scopes : null;
  }
  if (request.scope !== undefined) return validScope(request.scope) ? [request.scope] : null;
  return null;
}

function authorityFacts(authority) {
  const facts = {
    authorityId: authority.authorityId,
    objectiveEpoch: authority.objectiveEpoch,
    objectiveDigest: authority.objectiveDigest,
    senderOwner: authority.senderOwner,
    accountScope: authority.accountScope,
    carrierId: authority.carrierId,
    adapterId: authority.adapterId,
    policyDigest: authority.policyDigest,
    destinationScope: authority.destinationScope,
    destinationClass: authority.destinationClass,
    maxTaskCount: authority.maxTaskCount,
    currentTurn: authority.currentTurn,
    expiresAt: authority.expiresAt,
    explicitUserInstructionDigest: authority.explicitUserInstructionDigest || authority.sourceReceiptDigest,
  };
  if (authority.controller !== undefined) facts.controller = authority.controller;
  return facts;
}

function authorityMatches(authority, request, decision, now, identity = null, controllerRuntime) {
  if (!authority || authority.usedTaskCount >= authority.maxTaskCount) return false;
  if (Date.parse(authority.expiresAt) <= now) return false;
  // Older cooperative callers did not need to state the local account on every
  // admission.  Treat that omission as the fixed local scope, never as a
  // wildcard: a non-local authority still has to be named explicitly.
  const requestAccountScope = request.accountScope || "local";
  if (authority.objectiveEpoch !== request.objectiveEpoch || authority.senderOwner !== request.senderOwner || authority.accountScope !== requestAccountScope) return false;
  if (!validDigest(authority.objectiveDigest) || authority.objectiveDigest !== request.objectiveDigest || authority.sourceReceiptDigest !== request.instructionDigest) return false;
  if (controllerRuntime !== undefined && (!validControllerRuntime(controllerRuntime) || !sameControllerRuntime(authority.controller, controllerRuntime))) return false;
  const decisionPolicyDigest = decision.policyDigest || decision.policy?.digest;
  if (authority.carrierId !== decision.selected.carrierId || authority.policyDigest !== decisionPolicyDigest) return false;
  if (authority.adapterId !== decision.binding.adapterId) return false;
  if (decision.binding.hostScope !== authority.destinationScope || decision.binding.accountScope !== authority.accountScope) return false;
  const expectedClass = ADAPTER_DESCRIPTORS[decision.binding.adapterId]?.visibleTask ? "visible_task" : "delegated_slot";
  if (authority.destinationClass !== expectedClass || authority.destinationClass !== request.destinationClass || authority.destinationScope !== request.destinationScope || authority.currentTurn !== request.currentTurn) return false;
  if (identity && (!validDispatchIdentity(identity, ADAPTER_DESCRIPTORS[decision.binding.adapterId]?.receiptProducer) || identity.hostScope !== authority.destinationScope || identity.accountScope !== authority.accountScope || identity.dispatchKind !== decision.binding.dispatchKind || identity.toolVersion !== decision.binding.adapterVersion)) return false;
  return true;
}

function consumeTaskAuthority(state, request, decision, reservation, identity, now, controllerRuntime) {
  if (!decision.binding || !ADAPTER_DESCRIPTORS[decision.binding.adapterId]?.requiresTaskAuthority) return { ok: true };
  const binding = reservation.authorityBinding;
  const id = binding?.authorityId;
  const authority = state.taskAuthority[id];
  if (!validId(id) || request.taskAuthorityId !== id || !authority || stableDigest(authorityFacts(authority)) !== binding.authorityFactsDigest || authority.attestationDigest !== binding.attestationDigest || !authorityMatches(authority, {
    objectiveEpoch: binding.objectiveEpoch,
    senderOwner: binding.senderOwner,
    objectiveDigest: binding.objectiveDigest,
    instructionDigest: binding.instructionDigest,
    destinationScope: binding.destinationScope,
    accountScope: binding.accountScope,
    destinationClass: binding.destinationClass,
    currentTurn: binding.currentTurn,
  }, decision, now, identity, controllerRuntime)) return { ok: false, reason: "visible_task_authority_required" };
  state.taskAuthority[id].usedTaskCount += 1;
  if (state.taskAuthority[id].usedTaskCount === state.taskAuthority[id].maxTaskCount) state.taskAuthority[id].consumedAt = nowIso(now);
  return { ok: true, authorityId: id };
}

function authorityIssueForAdmission(request, state, decision, now, { controllerRuntime, requireControllerRuntime = false } = {}) {
  const adapter = ADAPTER_DESCRIPTORS[decision.binding.adapterId];
  if (!adapter?.requiresTaskAuthority) return null;
  if (requireControllerRuntime && !validControllerRuntime(controllerRuntime)) return "controller_runtime_unavailable";
  const authority = request.taskAuthorityId ? state.taskAuthority[request.taskAuthorityId] : null;
  if (!authority || !authorityMatches(authority, request, decision, now, null, controllerRuntime)) return "visible_task_authority_required";
  return null;
}

function decisionForState(decision) {
  return {
    decisionId: decision.decisionId,
    policyDigest: decision.policy.digest,
    role: decision.role,
    selected: clone(decision.selected),
    binding: clone(decision.binding),
    disclosure: clone(decision.disclosure),
    workClassDigest: decision.workClassDigest,
  };
}

function reservationFromDecision(request, decision, scopes, forecast, now, authority = null) {
  const identity = { requestId: request.requestId, decisionId: decision.decisionId, scopes, policy: decision.policy.digest };
  const reservation = {
    reservationId: opaqueId("reservation", identity),
    decisionId: decision.decisionId,
    requestId: request.requestId,
    requestDigest: stableDigest({ ...request, command: undefined }),
    frozenInputDigest: request.frozenInputDigest,
    workClassDigest: decision.workClassDigest,
    phase: "reserved",
    scope: clone(scopes[0]),
    scopes: clone(scopes),
    forecast,
    selected: decision.selected,
    binding: decision.binding,
    policyDigest: decision.policy.digest,
    createdAt: nowIso(now),
    updatedAt: nowIso(now),
    claimId: null,
    receiptIds: [],
    decision: decisionForState(decision),
    workShape: clone(request.workShape || {}),
    learningAllowed: request.privacy?.retention !== "none" && decision.privacy.retention !== "none",
  };
  if (request.objectiveDigest !== undefined) reservation.objectiveDigest = request.objectiveDigest;
  if (request.instructionDigest !== undefined) reservation.instructionDigest = request.instructionDigest;
  if (authority) {
    reservation.authorityBinding = {
      authorityId: authority.authorityId,
      objectiveEpoch: authority.objectiveEpoch,
      objectiveDigest: authority.objectiveDigest,
      instructionDigest: authority.sourceReceiptDigest,
      senderOwner: authority.senderOwner,
      accountScope: authority.accountScope,
      destinationScope: authority.destinationScope,
      destinationClass: authority.destinationClass,
      currentTurn: authority.currentTurn,
      controller: clone(authority.controller),
      authorityFactsDigest: stableDigest(authorityFacts(authority)),
      attestationDigest: authority.attestationDigest,
    };
  }
  if (request.risk !== undefined) reservation.risk = request.risk;
  if (request.contextClass !== undefined) reservation.contextClass = request.contextClass;
  return reservation;
}

function mintTaskAuthorityInternal(request, context) {
  const { catalog, state, now, trustedTaskAuthorityAttestor, controllerRuntime, requireControllerRuntime = false } = context;
  const authority = request.authority;
  if (!validateAuthorityInput(authority)) return error("invalid_task_authority");
  const policy = validateCatalog(catalog).policy;
  if (authority.policyDigest !== policy.digest) return error("task_authority_policy_mismatch");
  const carrier = CARRIER_DESCRIPTORS[authority.carrierId];
  if (!carrier.adapters.includes(authority.adapterId)) return error("carrier_adapter_mismatch");
  if (Date.parse(authority.expiresAt) <= now) return error("task_authority_expired");
  const expectedClass = ADAPTER_DESCRIPTORS[authority.adapterId].visibleTask ? "visible_task" : "delegated_slot";
  if (authority.destinationClass !== expectedClass) return error("task_authority_destination_mismatch");
  if (requireControllerRuntime && !validControllerRuntime(controllerRuntime)) return error("controller_runtime_unavailable");
  if (typeof trustedTaskAuthorityAttestor !== "function") return error("trusted_task_authority_attestor_unavailable");
  const inputFacts = authorityFacts(authority);
  let attestation;
  try {
    attestation = trustedTaskAuthorityAttestor(Object.freeze({ authority: Object.freeze(clone(inputFacts)), generatedAt: nowIso(now) }));
  } catch {
    return error("trusted_task_authority_attestor_failed");
  }
  if (!isObject(attestation) || !onlyFields(attestation, new Set(["attestorId", "attestationDigest", "attestedAt", "authorityFactsDigest", "controller"])) || attestation.attestorId !== TASK_AUTHORITY_ATTESTOR || !validDigest(attestation.attestationDigest) || !validIsoInstant(attestation.attestedAt) || !validDigest(attestation.authorityFactsDigest) || !validControllerRuntime(attestation.controller) || (requireControllerRuntime && !sameControllerRuntime(attestation.controller, controllerRuntime)) || Date.parse(attestation.attestedAt) < now - 5 * 60_000 || Date.parse(attestation.attestedAt) > now + 60_000) return error("invalid_task_authority_attestation");
  const facts = authorityFacts({ ...authority, controller: attestation.controller });
  if (attestation.authorityFactsDigest !== stableDigest(facts)) return error("invalid_task_authority_attestation");
  const existing = state.taskAuthority[authority.authorityId];
  if (existing) {
    const same = existing.objectiveEpoch === authority.objectiveEpoch && existing.objectiveDigest === authority.objectiveDigest && existing.senderOwner === authority.senderOwner && existing.accountScope === authority.accountScope && existing.carrierId === authority.carrierId && existing.adapterId === authority.adapterId && existing.policyDigest === authority.policyDigest && existing.destinationScope === authority.destinationScope && existing.destinationClass === authority.destinationClass && existing.maxTaskCount === authority.maxTaskCount && existing.currentTurn === authority.currentTurn && existing.expiresAt === authority.expiresAt && existing.sourceReceiptDigest === authority.explicitUserInstructionDigest && sameControllerRuntime(existing.controller, attestation.controller);
    return same ? result(true, "task_authority_replayed", { authority: clone(existing), stateChanged: false }) : error("task_authority_conflict");
  }
  const record = {
    authorityId: authority.authorityId,
    objectiveEpoch: authority.objectiveEpoch,
    objectiveDigest: authority.objectiveDigest,
    senderOwner: authority.senderOwner,
    accountScope: authority.accountScope,
    carrierId: authority.carrierId,
    adapterId: authority.adapterId,
    policyDigest: authority.policyDigest,
    destinationScope: authority.destinationScope,
    destinationClass: authority.destinationClass,
    maxTaskCount: authority.maxTaskCount,
    usedTaskCount: 0,
    currentTurn: authority.currentTurn,
    issuedAt: nowIso(now),
    expiresAt: authority.expiresAt,
    source: "explicit_user_instruction",
    sourceReceiptDigest: authority.explicitUserInstructionDigest,
    controller: clone(attestation.controller),
    attestorId: attestation.attestorId,
    attestationDigest: attestation.attestationDigest,
    attestedAt: attestation.attestedAt,
    authorityFactsDigest: attestation.authorityFactsDigest,
    cooperative: true,
  };
  state.taskAuthority[record.authorityId] = record;
  return result(true, "task_authority_minted", { authority: clone(record), cooperative: true, stateChanged: true });
}

function issueLeaseInternal(request, context) {
  const { catalog, state, now } = context;
  const input = request.lease;
  if (!validateLeaseInput(input)) return error("invalid_lease");
  const policy = validateCatalog(catalog).policy;
  const carrier = CARRIER_DESCRIPTORS[input.carrierId];
  const adapter = ADAPTER_DESCRIPTORS[input.adapterId];
  if (!carrier.adapters.includes(input.adapterId)) return error("carrier_adapter_mismatch");
  if (Date.parse(input.expiresAt) <= now) return error("lease_expired");
  if (state.budgetEpochs[leaseEpochAccountingId(input.epochId)]?.frozen) return error("budget_epoch_sealed");
  const allocatorScopes = scopeFor({ scopes: input.allocatorScopes });
  if (!allocatorScopes) return error("invalid_allocator_scopes");
  const existing = state.leases[input.leaseId];
  if (existing) {
    const same = existing.issuerScope === input.issuerScope && stableDigest(existing.allocatorScopes) === stableDigest(allocatorScopes) && existing.destinationScope === input.destinationScope && existing.destinationAccountScope === input.destinationAccountScope && existing.epochId === input.epochId && existing.policyDigest === policy.digest && existing.carrierId === input.carrierId && existing.adapterId === input.adapterId && stableDigest(existing.ceiling) === stableDigest(input.ceiling) && existing.maxSlots === input.maxSlots && existing.expiresAt === input.expiresAt && existing.allocatorReceiptDigest === input.allocatorReceiptDigest;
    return same ? result(true, "lease_replayed", { lease: clone(existing), stateChanged: false }) : error("lease_conflict");
  }
  if (Object.keys(state.leases).length >= MAX_LEASES) return error("lease_capacity_exhausted");
  const admitted = budgetAdmissionAll(catalog, state, allocatorScopes, input.ceiling, { carrier });
  if (!admitted.ok) return error(admitted.reason, { meter: admitted.meter, scope: admitted.scope });
  const headroom = ensureStateHeadroom(state, now);
  if (!headroom.ok) return headroom;
  const lease = {
    leaseId: input.leaseId,
    issuerScope: input.issuerScope,
    allocatorScopes: clone(allocatorScopes),
    destinationScope: input.destinationScope,
    destinationAccountScope: input.destinationAccountScope,
    policyDigest: policy.digest,
    epochId: input.epochId,
    carrierId: input.carrierId,
    carrierVersion: carrier.version,
    adapterId: input.adapterId,
    adapterVersion: adapter.version,
    ceiling: clone(input.ceiling),
    remainingCeiling: clone(input.ceiling),
    maxSlots: input.maxSlots,
    slotsClaimed: 0,
    allocations: {},
    issuedAt: nowIso(now),
    expiresAt: input.expiresAt,
    allocatorReceiptDigest: input.allocatorReceiptDigest,
    accepted: false,
    released: false,
    cooperative: true,
  };
  state.leases[lease.leaseId] = lease;
  return result(true, "lease_issued", { lease: clone(lease), cooperative: true, stateChanged: true });
}

function acceptLeaseInternal(request, context) {
  const { state, now } = context;
  const reference = request.lease;
  if (!validateLeaseReference(reference)) return error("invalid_lease");
  const lease = state.leases[reference.leaseId];
  if (!lease) return error("lease_unknown");
  if (lease.destinationScope !== reference.destinationScope || lease.destinationAccountScope !== reference.destinationAccountScope || (request.hostScope !== undefined && request.hostScope !== lease.destinationScope) || (request.accountScope !== undefined && request.accountScope !== lease.destinationAccountScope)) return error("lease_destination_mismatch");
  if (lease.released || Date.parse(lease.expiresAt) <= now || state.budgetEpochs[leaseEpochAccountingId(lease.epochId)]?.frozen) return error("lease_unavailable");
  if (lease.accepted) return result(true, "lease_accepted_replayed", { lease: clone(lease), stateChanged: false });
  lease.accepted = true;
  lease.acceptedAt = nowIso(now);
  return result(true, "lease_accepted", { lease: clone(lease), cooperative: true, stateChanged: true });
}

function claimSlotInternal(request, context) {
  const { state, now } = context;
  const reference = request.lease;
  if (!validateLeaseReference(reference) || !validId(request.reservationId)) return error("invalid_lease_claim");
  const lease = state.leases[reference.leaseId];
  const reservation = state.reservations[request.reservationId];
  if (!lease || !reservation) return error(!lease ? "lease_unknown" : "reservation_unknown");
  if (!lease.accepted || lease.released || lease.slotsClaimed >= lease.maxSlots || lease.destinationScope !== reference.destinationScope || lease.destinationAccountScope !== reference.destinationAccountScope || (request.hostScope !== undefined && request.hostScope !== lease.destinationScope) || (request.accountScope !== undefined && request.accountScope !== lease.destinationAccountScope) || request.dispatchIdentity?.hostScope !== lease.destinationScope || request.dispatchIdentity?.accountScope !== lease.destinationAccountScope || Date.parse(lease.expiresAt) <= now || state.budgetEpochs[leaseEpochAccountingId(lease.epochId)]?.frozen) return error("lease_unavailable");
  if (lease.policyDigest !== reservation.policyDigest || lease.carrierId !== reservation.selected.carrierId || lease.carrierVersion !== reservation.selected.carrierVersion || lease.adapterId !== reservation.binding.adapterId || lease.adapterVersion !== reservation.binding.adapterVersion || reservation.binding.hostScope !== lease.destinationScope || reservation.binding.accountScope !== lease.destinationAccountScope) return error("lease_binding_mismatch");
  for (const [meter, raw] of ownEntries(reservation.forecast)) {
    if (!Object.hasOwn(lease.remainingCeiling, meter) || parseMeterAmount(meter, raw).units > parseMeterAmount(meter, lease.remainingCeiling[meter]).units) return error("lease_ceiling_exceeded", { meter });
  }
  const claimed = claimInternal(request, context);
  if (!claimed.ok) return claimed;
  if (claimed.reason === "claim_replayed") return error("lease_claim_replayed");
  for (const [meter, raw] of ownEntries(reservation.forecast)) {
    const left = parseMeterAmount(meter, lease.remainingCeiling[meter]).units - parseMeterAmount(meter, raw).units;
    lease.remainingCeiling[meter] = formatMeterAmount(meter, left);
  }
  lease.slotsClaimed += 1;
  lease.allocations[reservation.reservationId] = { claimId: reservation.claimId, forecast: clone(reservation.forecast), at: nowIso(now) };
  reservation.leaseId = lease.leaseId;
  return result(true, "delegated_slot_claimed", { claimId: reservation.claimId, reservation: clone(reservation), lease: clone(lease), cooperative: true, stateChanged: true });
}

function releaseLeaseInternal(request, context) {
  const { state, now } = context;
  const reference = request.lease;
  if (!validateLeaseReference(reference)) return error("invalid_lease");
  const lease = state.leases[reference.leaseId];
  if (!lease) return error("lease_unknown");
  if (lease.destinationScope !== reference.destinationScope || lease.destinationAccountScope !== reference.destinationAccountScope || (request.hostScope !== undefined && request.hostScope !== lease.destinationScope) || (request.accountScope !== undefined && request.accountScope !== lease.destinationAccountScope)) return error("lease_destination_mismatch");
  if (lease.released) return result(true, "lease_released_replayed", { lease: clone(lease), stateChanged: false });
  for (const meter of Object.keys(lease.remainingCeiling)) lease.remainingCeiling[meter] = formatMeterAmount(meter, 0n);
  lease.released = true;
  lease.releasedAt = nowIso(now);
  return result(true, "lease_released", { lease: clone(lease), cooperative: true, stateChanged: true });
}

function sealEpochInternal(request, state, now) {
  if (!validId(request.epochId)) return error("epoch_id_required");
  const key = leaseEpochAccountingId(request.epochId);
  const existing = state.budgetEpochs[key];
  if (existing?.frozen) return result(true, "epoch_already_sealed", { epoch: clone(existing), stateChanged: false });
  if (epochHasActiveLeaseWork(state, request.epochId)) return error("epoch_active_allocations");
  const epoch = { frozen: true, reason: "manual_seal", sealedAt: nowIso(now), epoch: (existing?.epoch || 0) + 1 };
  state.budgetEpochs[key] = epoch;
  return result(true, "epoch_sealed", { epoch: clone(epoch), cooperative: true, stateChanged: true });
}

function admitInternal(request, context) {
  const { catalog, state, now, trustedTransportAttestor, fixedReceiptProducers, controllerRuntime, requireControllerRuntime } = context;
  if (!validId(request.requestId)) return error("request_id_required");
  const existing = Object.values(state.reservations).find((record) => record.requestId === request.requestId);
  const requestDigest = stableDigest({ ...request, command: undefined });
  if (existing) {
    if (existing.requestDigest !== requestDigest) return error("request_id_conflict");
    return result(true, "admission_replayed", { decision: existing.decision, reservation: clone(existing) });
  }
  if (!catalog) {
    const resolved = resolveInternal(request, context);
    if (!resolved.ok) return resolved;
    if (ADAPTER_DESCRIPTORS[resolved.decision.binding.adapterId]?.requiresTaskAuthority) return error("visible_task_authority_required");
    if (resolved.decision.binding.budgetEffect === "none") return result(true, "default_message_no_state", { decision: resolved.decision, reservation: "not_applicable", claimRequired: false });
    if (resolved.decision.binding.budgetEffect === "adjust_active") {
      const actionReceipt = actionReceiptFor(request, resolved.decision);
      if (!actionReceipt) return error("invalid_action_receipt");
      resolved.decision.actionReceipt = actionReceipt;
      return result(true, "default_active_adjustment_no_state", { decision: resolved.decision, actionReceipt, reservation: "not_applicable", claimRequired: false, accounting: "not_applicable" });
    }
    return result(true, "default_route_no_state", { decision: resolved.decision, reservation: "not_applicable", claimRequired: false });
  }
  if (!validDigest(request.frozenInputDigest)) return error("frozen_input_digest_required");
  const scopes = scopeFor(request);
  if (!scopes) return error("invalid_budget_scope");
  const resolved = resolveInternal(request, context);
  if (!resolved.ok) return resolved;
  if (resolved.decision.binding.budgetEffect === "none") return error("budget_neutral_admission_not_allowed");
  if (resolved.decision.binding.budgetEffect === "adjust_active") {
    if (!validId(request.activeReservationId)) return error("active_reservation_required");
    const active = state.reservations[request.activeReservationId];
    if (!active || !["claimed", "started"].includes(active.phase)) return error("active_attempt_unknown");
    if (!validDigest(active.workClassDigest) || active.workClassDigest !== resolved.decision.workClassDigest) return error("prior_work_class_changed_requires_fresh_route");
    if (stableDigest(active.scopes) !== stableDigest(scopes) || active.policyDigest !== resolved.decision.policy.digest || active.selected.carrierId !== resolved.decision.selected.carrierId || active.selected.model !== resolved.decision.selected.model || active.selected.effort !== resolved.decision.selected.effort || !allowedInheritedAdapterTransition(active.binding.adapterId, resolved.decision.binding.adapterId, active.selected.carrierId, resolved.decision.binding.dispatchKind)) return error("context_override_conflict");
    const adjustmentDigest = stableDigest({ ...request, command: undefined });
    active.adjustments ||= {};
    const previous = active.adjustments[request.requestId];
    if (previous) {
      if (previous.requestDigest !== adjustmentDigest) return error("request_id_conflict");
      return result(true, "active_adjustment_replayed", { reservation: clone(active), adjustment: clone(previous), actionReceipt: clone(previous.actionReceipt) });
    }
    const adjustment = normalizeForecast(request.forecast || {});
    if (!adjustment.ok) return error(adjustment.reason);
    const budget = budgetAdmissionAll(catalog, state, scopes, adjustment.value, { carrier: CARRIER_DESCRIPTORS[active.selected.carrierId] });
    if (!budget.ok) return error(budget.reason, { meter: budget.meter, scope: budget.scope });
    const headroom = ensureStateHeadroom(state, now);
    if (!headroom.ok) return headroom;
    for (const [meter, raw] of ownEntries(adjustment.value)) {
      const previousAmount = parseMeterAmount(meter, active.forecast[meter] || "0").units;
      active.forecast[meter] = formatMeterAmount(meter, previousAmount + parseMeterAmount(meter, raw).units);
    }
    const actionReceipt = actionReceiptFor(request, resolved.decision, {
      budget: { kind: "top_up", forecast: adjustment.value, warningCount: budget.warnings.length },
    });
    if (!actionReceipt) return error("invalid_action_receipt");
    active.adjustments[request.requestId] = { requestDigest: adjustmentDigest, forecast: adjustment.value, at: nowIso(now), actionReceipt };
    active.updatedAt = nowIso(now);
    return result(true, "active_budget_adjusted", { reservation: clone(active), adjustment: clone(active.adjustments[request.requestId]), actionReceipt: clone(actionReceipt), stateChanged: true });
  }
  const forecast = normalizeForecast(request.forecast || {});
  if (!forecast.ok) return error(forecast.reason);
  const policy = validateCatalog(catalog).policy;
  const configured = configuredCandidates(catalog, request, state, now, policy.digest, { trustedTransportAttestor, fixedReceiptProducers }).filter((candidate) => candidate.ok).sort(candidateSort);
  const rejectedByBudget = [];
  let decision = null;
  let budget = null;
  let admittedAuthority = null;
  let admittedForecast = null;
  for (const candidate of configured) {
    const attempted = decisionFromCandidate(candidate, request, policy, now);
    if (attempted.binding.budgetEffect !== "start") {
      rejectedByBudget.push({ modelAlias: candidate.alias, reason: "budget_effect_ineligible" });
      continue;
    }
    const authorityIssue = authorityIssueForAdmission(request, state, attempted, now, { controllerRuntime, requireControllerRuntime });
    if (authorityIssue) {
      rejectedByBudget.push({ modelAlias: candidate.alias, reason: authorityIssue });
      continue;
    }
    const learned = learnedForecastForCandidate(state, request, candidate, forecast.value, catalog);
    const admitted = budgetAdmissionAll(catalog, state, scopes, learned.forecast, candidate);
    if (!admitted.ok) {
      rejectedByBudget.push({ modelAlias: candidate.alias, reason: admitted.reason, meter: admitted.meter, scope: admitted.scope?.kind });
      continue;
    }
    attempted.learning = {
      ...(learned.learning || { provenance: "not_applicable", policyOrdering: "unchanged" }),
      forecastAdjusted: learned.adjusted,
      requestedForecast: clone(forecast.value),
      admittedForecast: clone(learned.forecast),
      hardConstraintTreatment: "never_lowered",
    };
    attempted.disclosure = r28RouteDisclosure(candidate, request, {
      forecast: learned.forecast,
      reservation: learned.forecast,
      rejectedAlternatives: rejectedByBudget,
    });
    decision = attempted;
    budget = admitted;
    admittedAuthority = ADAPTER_DESCRIPTORS[attempted.binding.adapterId]?.requiresTaskAuthority ? state.taskAuthority[request.taskAuthorityId] : null;
    admittedForecast = learned.forecast;
    break;
  }
  if (!decision || !budget) {
    const first = rejectedByBudget[0] || {};
    return error(first.reason || "no_budget_eligible_route", { meter: first.meter, rejectedAlternatives: rejectedByBudget });
  }
  if (decision.selected.modelAlias !== resolved.decision.selected.modelAlias) {
    decision.budgetFallback = {
      reason: "higher_ranked_candidate_cannot_fit_hard_constraint",
      rejectedAlternatives: rejectedByBudget,
      disclosure: r28RouteDisclosure(configured.find((candidate) => candidate.alias === decision.selected.modelAlias), request, {
        route: "fallback",
        reasonCode: "higher_ranked_candidate_cannot_fit_hard_constraint",
        forecast: admittedForecast,
        reservation: admittedForecast,
        rejectedAlternatives: rejectedByBudget,
      }),
    };
  }
  if (decision.binding.bridgePhase === "activation") {
    const bridge = state.bridges[request.bridgeLifecycleId];
    if (!bridge?.acknowledged || bridge.carrierId !== decision.selected.carrierId || bridge.adapterId !== decision.binding.adapterId || (request.hostScope !== undefined && request.hostScope !== state.reservations[bridge.reservationId]?.claimed?.hostScope) || (request.accountScope !== undefined && request.accountScope !== state.reservations[bridge.reservationId]?.claimed?.accountScope)) return error("bridge_acknowledgement_required");
  }
  const headroom = ensureStateHeadroom(state, now);
  if (!headroom.ok) return headroom;
  const reservation = reservationFromDecision(request, decision, scopes, admittedForecast, now, admittedAuthority);
  reservation.learningAllowed = reservation.learningAllowed && catalog.learning?.enabled !== false;
  reservation.budgetWarnings = budget.warnings;
  if (decision.binding.bridgePhase === "bootstrap") {
    reservation.bridgeLifecycleId = request.bridgeLifecycleId || opaqueId("bridge", { reservation: reservation.reservationId });
  } else if (decision.binding.bridgePhase === "activation") {
    reservation.bridgeLifecycleId = request.bridgeLifecycleId;
  }
  state.reservations[reservation.reservationId] = reservation;
  return result(true, "admitted", { decision, reservation: clone(reservation), stateChanged: true });
}

function claimInternal(request, context) {
  const { state, now, controllerRuntime, requireControllerRuntime = false } = context;
  if (!validId(request.reservationId)) return error("reservation_id_required");
  const reservation = state.reservations[request.reservationId];
  if (!reservation) return error("reservation_unknown");
  if (!validDigest(request.frozenInputDigest) || request.frozenInputDigest !== reservation.frozenInputDigest) return error("claim_input_mismatch");
  const adapter = ADAPTER_DESCRIPTORS[reservation.binding.adapterId];
  const identity = request.dispatchIdentity;
  if (!validDispatchIdentity(identity, adapter?.receiptProducer) || identity.dispatchKind !== reservation.binding.dispatchKind || identity.toolVersion !== reservation.binding.adapterVersion) return error("dispatch_identity_required");
  if (identity.hostScope !== reservation.binding.hostScope || identity.accountScope !== reservation.binding.accountScope) return error("dispatch_identity_mismatch");
  if ((request.hostScope !== undefined && request.hostScope !== identity.hostScope) || (request.accountScope !== undefined && request.accountScope !== identity.accountScope)) return error("dispatch_identity_mismatch");
  if (ACTIVE_CLAIM_PHASES.has(reservation.phase)) {
    if (dispatchIdentityDigest(identity) !== dispatchIdentityDigest(reservation.claimed)) return error("dispatch_identity_mismatch");
    return result(true, "claim_replayed", { claimId: reservation.claimId, claimed: clone(reservation.claimed), reservation: clone(reservation) });
  }
  if (reservation.phase !== "reserved") return error("claim_not_allowed", { phase: reservation.phase });
  if (reservation.authorityBinding && requireControllerRuntime && !validControllerRuntime(controllerRuntime)) return error("controller_runtime_unavailable");
  if (reservation.authorityBinding?.controller && controllerRuntime !== undefined && !sameControllerRuntime(reservation.authorityBinding.controller, controllerRuntime)) return error("controller_identity_mismatch");
  if (reservation.binding.bridgePhase === "activation") {
    const bridge = state.bridges[reservation.bridgeLifecycleId];
    if (!bridge?.acknowledged || bridge.identityDigest !== dispatchIdentityDigest(identity)) return error("bridge_dispatch_identity_mismatch");
  }
  const authority = consumeTaskAuthority(state, request, reservation.decision, reservation, identity, now, controllerRuntime);
  if (!authority.ok) return error(authority.reason);
  let lifecycleRequirement = null;
  if (reservation.decision.role === "review" || reservation.decision.role.startsWith("review.")) {
    const pending = Object.values(state.lifecycleReviewRequirements).filter((item) => item.fulfilled !== true && Date.parse(item.expiresAt) > now && item.hostScope === identity.hostScope && item.accountScope === identity.accountScope && item.policyDigest === reservation.policyDigest);
    if (pending.length > 0) {
      if (!validId(request.postLifecycleRequirementId)) return error("fresh_post_lifecycle_review_required");
      lifecycleRequirement = state.lifecycleReviewRequirements[request.postLifecycleRequirementId];
      if (!lifecycleRequirement || lifecycleRequirement.fulfilled || Date.parse(lifecycleRequirement.expiresAt) <= now || lifecycleRequirement.hostScope !== identity.hostScope || lifecycleRequirement.accountScope !== identity.accountScope || lifecycleRequirement.policyDigest !== reservation.policyDigest || lifecycleRequirement.reviewClaimId !== undefined) return error("fresh_post_lifecycle_review_required");
    }
  }
  reservation.phase = "claimed";
  reservation.claimId = opaqueId("claim", { reservationId: reservation.reservationId, decisionId: reservation.decisionId });
  reservation.claimed = {
    id: reservation.claimId,
    state: "claimed",
    hostScope: identity.hostScope,
    accountScope: identity.accountScope,
    dispatchKind: identity.dispatchKind,
    sessionId: identity.sessionId,
    toolId: identity.toolId,
    toolVersion: identity.toolVersion,
    frozenInputDigest: reservation.frozenInputDigest,
    at: nowIso(now),
  };
  if (reservation.authorityBinding?.currentTurn !== undefined) reservation.claimed.currentTurn = reservation.authorityBinding.currentTurn;
  if (authority.authorityId !== undefined) reservation.claimed.authorityId = authority.authorityId;
  if (lifecycleRequirement) {
    lifecycleRequirement.reviewClaimId = reservation.claimId;
    reservation.claimed.postLifecycleRequirementId = lifecycleRequirement.requirementId;
    reservation.postLifecycleRequirementId = lifecycleRequirement.requirementId;
  }
  reservation.updatedAt = nowIso(now);
  return result(true, "dispatch_claimed", { claimId: reservation.claimId, claimed: clone(reservation.claimed), reservation: clone(reservation), stateChanged: true });
}

function normalUsage(raw = {}) {
  const normalized = normalizeForecast(raw);
  return normalized.ok ? normalized : { ok: false, reason: "invalid_measured_usage" };
}

function addSpent(state, scope, meter, amount, provenance, now) {
  const scopeId = scopeAccountingId(scope);
  const current = spentFor(state, scope, meter);
  state.spendAggregates[scopeId] ||= {};
  state.spendAggregates[scopeId][meter] = {
    hardAccounted: formatMeterAmount(meter, current + amount),
    provenance,
    at: nowIso(now),
  };
}

function normalizedLearningShape(shape = {}) {
  return Object.fromEntries(SHAPE_FIELDS.map((field) => [field, shape[field] || "unknown"]));
}

function learningBaseBucket({ role, risk, contextClass, workShape }) {
  return stableDigest({
    role,
    risk: risk || "unknown",
    contextClass: contextClass || "unknown",
    workShape: normalizedLearningShape(workShape),
  });
}

function learningRouteEffectBucket(baseBucket, selected) {
  return stableDigest({
    baseBucket,
    resolvedModel: selected.model || "unknown",
    carrierId: selected.carrierId,
    carrierVersion: selected.carrierVersion || CARRIER_DESCRIPTORS[selected.carrierId]?.version || "unknown",
    effort: selected.effort,
    billingSurface: selected.executionSurface || "unknown",
  });
}

function boundedInfluence(value) {
  return Math.max(-MAX_LEARNING_SAMPLE_INFLUENCE, Math.min(MAX_LEARNING_SAMPLE_INFLUENCE, value));
}

function addLearningMeters(target, source) {
  for (const [meter, amount] of ownEntries(source || {})) {
    const parsed = parseMeterAmount(meter, amount);
    if (!parsed.ok) continue;
    const current = parseMeterAmount(meter, target[meter] || "0");
    target[meter] = formatMeterAmount(meter, current.units + parsed.units);
  }
}

function updateLearningAggregate(aggregate, receipt, forecast) {
  aggregate.count += 1;
  aggregate.totalDurationMs += receipt.durationMs || 0;
  aggregate.totalRetries += receipt.retryCount || 0;
  if (receipt.status !== "settled" || receipt.verification === "failed") aggregate.failures += 1;
  if (receipt.verification === "passed") aggregate.verified += 1;
  aggregate.ratingTotal += receipt.rating || 0;
  if (aggregate.usageTotals) addLearningMeters(aggregate.usageTotals, receipt.measuredUsage || {});
  if (aggregate.forecastTotals) addLearningMeters(aggregate.forecastTotals, forecast || {});
}

function refreshLearningInfluence(aggregate) {
  if (aggregate.count < LEARNING_SAMPLE_FLOOR) return;
  if (aggregate.forecastInfluenceByMeter) {
    for (const meter of Object.keys(aggregate.forecastTotals)) {
      const forecast = parseMeterAmount(meter, aggregate.forecastTotals[meter]);
      const usage = parseMeterAmount(meter, aggregate.usageTotals[meter] || "0");
      if (!forecast.ok || !usage.ok || forecast.units === 0n) continue;
      const basisPoints = Number((usage.units * 10_000n) / forecast.units) / 10_000;
      aggregate.forecastInfluenceByMeter[meter] = boundedInfluence(basisPoints - 1);
    }
  }
  if (Object.hasOwn(aggregate, "tieBreakInfluence")) {
    const ratingDelta = aggregate.ratingTotal === 0 ? 0 : (aggregate.ratingTotal / aggregate.count - 3) / 10;
    const verificationSignal = aggregate.verified / aggregate.count / 10;
    const failurePenalty = aggregate.failures / aggregate.count / 5;
    aggregate.tieBreakInfluence = boundedInfluence(ratingDelta + verificationSignal - failurePenalty);
  }
}

function boundedLearningAggregate(state, id, factory) {
  if (!state.learningAggregates[id] && Object.keys(state.learningAggregates).length >= MAX_AGGREGATES) {
    const evictable = Object.entries(state.learningAggregates).sort(([, left], [, right]) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")))[0]?.[0];
    if (evictable) delete state.learningAggregates[evictable];
  }
  return state.learningAggregates[id] ||= factory();
}

function updateLearning(state, reservation, receipt, now, catalog = null) {
  if (catalog?.learning?.enabled === false || state.learningControl.disabled === true || reservation.learningAllowed === false || receipt.status !== "settled" || !receipt.outcomeId || !validId(receipt.outcomeId)) return;
  if (state.learningOutcomes[receipt.outcomeId]) return;
  const outcomes = Object.keys(state.learningOutcomes);
  if (outcomes.length >= MAX_OUTCOMES) {
    outcomes.sort((left, right) => state.learningOutcomes[left].at.localeCompare(state.learningOutcomes[right].at));
    delete state.learningOutcomes[outcomes[0]];
  }
  const role = reservation.decision.role;
  const workShape = normalizedLearningShape(reservation.workShape || {});
  const risk = reservation.risk || "unknown";
  const contextClass = reservation.contextClass || "unknown";
  const baseBucket = learningBaseBucket({ role, risk, contextClass, workShape });
  // A no-config default-terminal receipt intentionally records only demand.
  // It no longer fabricates a Luna route effect for a terminal result whose
  // actual selected runtime route was not retained in state.
  const routeLearningEligible = reservation.routeLearningEligible !== false;
  const resolvedModelBucket = routeLearningEligible
    ? stableDigest({ carrierId: reservation.selected.carrierId, model: reservation.selected.model })
    : null;
  const routeEffectBucket = routeLearningEligible
    ? learningRouteEffectBucket(baseBucket, reservation.selected)
    : null;
  const baseId = opaqueId("learning", { kind: "baseDemand", baseBucket });
  const routeId = routeLearningEligible
    ? opaqueId("learning", { kind: "routeEffect", routeEffectBucket })
    : null;
  const outcome = {
    at: nowIso(now),
    role,
    risk,
    contextClass,
    workShape,
    baseBucket,
    result: receipt.status,
    usage: clone(receipt.measuredUsage || {}),
    measuredBilled: receipt.measuredBilled === true,
  };
  if (routeLearningEligible) Object.assign(outcome, {
    routeEffectBucket,
    carrierId: reservation.selected.carrierId,
    carrierVersion: reservation.selected.carrierVersion,
    effort: reservation.selected.effort,
    billingSurface: reservation.selected.executionSurface,
    resolvedModelBucket,
  });
  for (const key of ["durationMs", "retryCount", "verification", "rating"]) if (receipt[key] !== undefined) outcome[key] = receipt[key];
  state.learningOutcomes[receipt.outcomeId] = outcome;
  const base = boundedLearningAggregate(state, baseId, () => ({
    kind: "baseDemand", baseBucket, role, risk, contextClass, workShape,
    count: 0, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 0, ratingTotal: 0,
    usageTotals: {}, forecastTotals: {}, forecastInfluenceByMeter: {}, updatedAt: nowIso(now),
  }));
  const route = routeLearningEligible
    ? boundedLearningAggregate(state, routeId, () => ({
      kind: "routeEffect", baseBucket, routeEffectBucket, role, risk, contextClass, workShape,
      carrierId: reservation.selected.carrierId, carrierVersion: reservation.selected.carrierVersion,
      effort: reservation.selected.effort, billingSurface: reservation.selected.executionSurface,
      resolvedModelBucket, count: 0, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 0,
      ratingTotal: 0, tieBreakInfluence: 0, updatedAt: nowIso(now),
    }))
    : null;
  updateLearningAggregate(base, receipt, reservation.forecast);
  if (route) updateLearningAggregate(route, receipt, reservation.forecast);
  refreshLearningInfluence(base);
  if (route) refreshLearningInfluence(route);
  base.updatedAt = nowIso(now);
  if (route) route.updatedAt = nowIso(now);
}

function learningHintForCandidate(state, request, candidate) {
  const role = request.role;
  const workShape = normalizedLearningShape(request.workShape || {});
  const risk = request.risk || "unknown";
  const contextClass = request.contextClass || "unknown";
  const baseBucket = learningBaseBucket({ role, risk, contextClass, workShape });
  const routeEffectBucket = learningRouteEffectBucket(baseBucket, {
    model: candidate.observedModel === "unknown" ? candidate.model.requestedModel : candidate.observedModel,
    carrierId: candidate.model.carrierId,
    carrierVersion: candidate.carrier.version,
    effort: candidate.effort,
    executionSurface: candidate.provider.executionSurface,
  });
  const baseDemand = Object.values(state.learningAggregates).find((item) => item.kind === "baseDemand" && item.baseBucket === baseBucket && item.count >= LEARNING_SAMPLE_FLOOR) || null;
  const routeEffect = Object.values(state.learningAggregates).find((item) => item.kind === "routeEffect" && item.routeEffectBucket === routeEffectBucket && item.count >= LEARNING_SAMPLE_FLOOR) || null;
  if (!baseDemand && !routeEffect) return null;
  return {
    baseBucket,
    routeEffectBucket,
    sampleFloor: LEARNING_SAMPLE_FLOOR,
    baseDemand: baseDemand ? { sampleCount: baseDemand.count, forecastInfluenceByMeter: clone(baseDemand.forecastInfluenceByMeter) } : "unknown",
    routeEffect: routeEffect ? { sampleCount: routeEffect.count, tieBreakInfluence: routeEffect.tieBreakInfluence } : "unknown",
    provenance: "learned_estimate",
    policyOrdering: "unchanged",
  };
}

function learnedForecastForCandidate(state, request, candidate, forecast, catalog) {
  const hint = candidate.learning || learningHintForCandidate(state, request, candidate);
  if (!hint || hint.baseDemand === "unknown") return { forecast, learning: hint, adjusted: false };
  const updated = clone(forecast);
  let adjusted = false;
  for (const [meter, original] of ownEntries(forecast)) {
    const influence = hint.baseDemand.forecastInfluenceByMeter?.[meter];
    if (!Number.isFinite(influence)) continue;
    const parsed = parseMeterAmount(meter, original);
    if (!parsed.ok) continue;
    // Keep accounting in integer space.  Converting a meter value through a
    // Number would silently lose precision for a large but valid budget.
    const scale = BigInt(Math.max(0, Math.round((1 + boundedInfluence(influence)) * 1_000_000)));
    let units = (parsed.units * scale + 999_999n) / 1_000_000n;
    const hardMeter = scopeFor(request)?.some((scope) => {
      const rule = budgetRules(catalog, scope.kind)[meter] || {};
      return rule.hardAdmission !== undefined || rule.strict !== undefined;
    });
    // A learned optimistic estimate may not enlarge hard/strict headroom.
    if (hardMeter && units < parsed.units) units = parsed.units;
    const next = formatMeterAmount(meter, units);
    if (next !== original) adjusted = true;
    updated[meter] = next;
  }
  return { forecast: updated, learning: hint, adjusted };
}

function validFixedOracleMeterSurface(value) {
  return isObject(value) && onlyFields(value, new Set(["marginalUsd", "codexCredits", "openaiApiSpend"])) && value.marginalUsd === 0 && value.codexCredits === 0 && value.openaiApiSpend === 0;
}

function normalizeReceipt(receipt, adapter, reservation) {
  const common = new Set(["receiptId", "producer", "adapterVersion", "claimId", "frozenInputDigest", "status", "outcomeId", "measuredUsage", "measuredBilled", "identityVerified", "acknowledgementVerified", "hostScope", "accountScope", "dispatchKind", "sessionId", "toolId", "toolVersion", "durationMs", "retryCount", "verification", "rating"]);
  const oracle = new Set([...common, "reason", "retryAfterSeconds", "requestedModel", "adapterModelControl", "documentedProductLabel", "observedModel", "executionSurface", "chargedMeters", "originalHostDigest", "recordedAt", "expiresAt", "outputTrusted", "carrierVersion", "authReadiness", "retentionClass", "resultArtifact", "reattached", "beforeVersion", "afterVersion", "formula", "freshReviewRequired"]);
  const isOracle = ["oracle-browser", "oracle-homebrew-lifecycle"].includes(adapter.receiptProducer);
  const allowed = isOracle ? oracle : common;
  if (!onlyFields(receipt, allowed) || !validId(receipt.receiptId) || !validId(receipt.producer) || !validId(receipt.adapterVersion) || !validId(receipt.claimId) || !validDigest(receipt.frozenInputDigest) || !RECEIPT_STATUSES.has(receipt.status)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  const identity = { hostScope: receipt.hostScope, accountScope: receipt.accountScope, dispatchKind: receipt.dispatchKind, sessionId: receipt.sessionId, toolId: receipt.toolId, toolVersion: receipt.toolVersion };
  if (!validDispatchIdentity(identity, adapter.receiptProducer) || identity.dispatchKind !== reservation.binding.dispatchKind || identity.hostScope !== reservation.claimed?.hostScope || identity.accountScope !== reservation.claimed?.accountScope || identity.sessionId !== reservation.claimed?.sessionId || identity.toolId !== reservation.claimed?.toolId || identity.toolVersion !== reservation.claimed?.toolVersion) return { ok: false, reason: "receipt_dispatch_identity_mismatch" };
  if (receipt.outcomeId !== undefined && !validId(receipt.outcomeId)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.measuredUsage !== undefined && !validMeterMap(receipt.measuredUsage)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.measuredBilled !== undefined && typeof receipt.measuredBilled !== "boolean") return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.durationMs !== undefined && (!Number.isInteger(receipt.durationMs) || receipt.durationMs < 0 || receipt.durationMs > 86_400_000)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.retryCount !== undefined && (!Number.isInteger(receipt.retryCount) || receipt.retryCount < 0 || receipt.retryCount > 99)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.verification !== undefined && !["passed", "failed", "not_run", "unknown"].includes(receipt.verification)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (receipt.rating !== undefined && (!Number.isInteger(receipt.rating) || receipt.rating < 1 || receipt.rating > 5)) return { ok: false, reason: "invalid_reconciliation_receipt" };
  if (isOracle) {
    if (!validDigest(receipt.originalHostDigest) || !validIsoInstant(receipt.recordedAt) || !validIsoInstant(receipt.expiresAt) || Date.parse(receipt.expiresAt) <= Date.parse(receipt.recordedAt) || receipt.outputTrusted !== false || !validFixedOracleMeterSurface(receipt.chargedMeters) || (receipt.reason !== null && receipt.reason !== undefined && !validId(receipt.reason)) || (receipt.retryAfterSeconds !== undefined && (!Number.isInteger(receipt.retryAfterSeconds) || receipt.retryAfterSeconds < 1 || receipt.retryAfterSeconds > 86_400)) || (receipt.authReadiness !== undefined && !["unknown", "authenticated", "fresh_success", "auth_context_unavailable"].includes(receipt.authReadiness)) || (receipt.retentionClass !== undefined && !/^local-private-\d{1,3}h$/.test(receipt.retentionClass)) || (receipt.reattached !== undefined && typeof receipt.reattached !== "boolean") || (receipt.freshReviewRequired !== undefined && typeof receipt.freshReviewRequired !== "boolean")) return { ok: false, reason: "invalid_oracle_receipt" };
    if (adapter.receiptProducer === "oracle-browser" && (receipt.requestedModel !== "chatgpt_current_pro" || receipt.executionSurface !== "chatgpt_standard" || typeof receipt.adapterModelControl !== "string" || typeof receipt.documentedProductLabel !== "string" || (receipt.observedModel !== undefined && !validModel(receipt.observedModel)))) return { ok: false, reason: "invalid_oracle_receipt" };
    if (adapter.receiptProducer === "oracle-homebrew-lifecycle" && receipt.status === "settled" && receipt.reason === null && receipt.freshReviewRequired !== true) return { ok: false, reason: "fresh_post_lifecycle_review_required" };
    if (receipt.resultArtifact !== undefined) {
      const artifact = receipt.resultArtifact;
      if (!isObject(artifact) || !onlyFields(artifact, new Set(["artifactId", "path", "sha256", "bytes", "sessionId"])) || !validId(artifact.artifactId) || typeof artifact.path !== "string" || !path.isAbsolute(artifact.path) || !validDigest(artifact.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 2 * 1024 * 1024 || artifact.sessionId !== receipt.sessionId) return { ok: false, reason: "invalid_oracle_receipt" };
    }
  }
  return {
    ok: true,
    value: {
      receiptId: receipt.receiptId,
      producer: receipt.producer,
      adapterVersion: receipt.adapterVersion,
      claimId: receipt.claimId,
      frozenInputDigest: receipt.frozenInputDigest,
      status: receipt.status,
      outcomeId: receipt.outcomeId,
      measuredUsage: receipt.measuredUsage || {},
      measuredBilled: receipt.measuredBilled === true,
      identityVerified: receipt.identityVerified,
      acknowledgementVerified: receipt.acknowledgementVerified,
      durationMs: receipt.durationMs,
      retryCount: receipt.retryCount,
      verification: receipt.verification,
      rating: receipt.rating,
      reason: receipt.reason,
      retryAfterSeconds: receipt.retryAfterSeconds,
      authReadiness: receipt.authReadiness,
      chargedMeters: receipt.chargedMeters,
      requestedModel: receipt.requestedModel,
      observedModel: receipt.observedModel,
      executionSurface: receipt.executionSurface,
      carrierVersion: receipt.carrierVersion,
      expiresAt: receipt.expiresAt,
      freshReviewRequired: receipt.freshReviewRequired,
    },
  };
}

function importTrustedReceipt(rawReceipt, reservation, adapter, trustedReceiptImporter, now) {
  if (typeof trustedReceiptImporter !== "function") return { ok: false, reason: "trusted_receipt_importer_unavailable" };
  const expected = {
    contractVersion: CONTRACT_VERSION,
    reservationId: reservation.reservationId,
    claimId: reservation.claimId,
    frozenInputDigest: reservation.frozenInputDigest,
    policyDigest: reservation.policyDigest,
    selected: { carrierId: reservation.selected.carrierId, carrierVersion: reservation.selected.carrierVersion, executionSurface: reservation.selected.executionSurface },
    binding: {
      adapterId: reservation.binding.adapterId,
      adapterVersion: reservation.binding.adapterVersion,
      dispatchKind: reservation.binding.dispatchKind,
      hostScope: reservation.binding.hostScope,
      accountScope: reservation.binding.accountScope,
      contextFork: reservation.binding.contextFork || "not_applicable",
      r52Digest: reservation.binding.r52?.digest || "not_applicable",
    },
    workClassDigest: reservation.workClassDigest || "unknown",
    objectiveDigest: reservation.objectiveDigest || "unknown",
    instructionDigest: reservation.instructionDigest || "unknown",
    authorityBinding: reservation.authorityBinding ? clone(reservation.authorityBinding) : "not_applicable",
    dispatchIdentity: {
      hostScope: reservation.claimed.hostScope,
      accountScope: reservation.claimed.accountScope,
      dispatchKind: reservation.claimed.dispatchKind,
      sessionId: reservation.claimed.sessionId,
      toolId: reservation.claimed.toolId,
      toolVersion: reservation.claimed.toolVersion,
    },
    importerId: TRUSTED_RECEIPT_IMPORTER_ID,
    importerVersion: TRUSTED_RECEIPT_IMPORTER_VERSION,
    importedAt: nowIso(now),
  };
  let imported;
  try {
    imported = trustedReceiptImporter(Object.freeze({ expected: Object.freeze(clone(expected)), untrustedReceipt: Object.freeze(clone(rawReceipt)) }));
  } catch (cause) {
    // Only the source-owned public bridge can surface one of its closed error
    // codes. Generic trusted embeddings retain the deliberately opaque error.
    return { ok: false, reason: typeof cause?.fixedBridgeReason === "string" && validId(cause.fixedBridgeReason) ? cause.fixedBridgeReason : "trusted_receipt_importer_failed" };
  }
  if (!isObject(imported) || !onlyFields(imported, new Set(["importerId", "importerVersion", "attestationDigest", "attestedAt", "receipt"])) || imported.importerId !== TRUSTED_RECEIPT_IMPORTER_ID || imported.importerVersion !== TRUSTED_RECEIPT_IMPORTER_VERSION || !validDigest(imported.attestationDigest) || !validIsoInstant(imported.attestedAt) || Date.parse(imported.attestedAt) < now - 5 * 60_000 || Date.parse(imported.attestedAt) > now + 60_000) return { ok: false, reason: "invalid_trusted_receipt_import" };
  const normalized = normalizeReceipt(imported.receipt, adapter, reservation);
  if (!normalized.ok) return normalized;
  const expectedDigest = receiptImportAttestationDigest(imported.importerId, imported.importerVersion, expected, imported.receipt);
  if (imported.attestationDigest !== expectedDigest) return { ok: false, reason: "trusted_receipt_attestation_mismatch" };
  return { ok: true, value: normalized.value, importer: { id: imported.importerId, version: imported.importerVersion, attestationDigest: imported.attestationDigest } };
}

// `attestedAt` is a freshness proof, not part of a receipt's durable identity.
// Excluding only the import timestamp lets a public bridge replay the exact
// same closed evidence in a later process while still rejecting any changed
// reservation binding or receipt field.
function receiptImportAttestationDigest(importerId, importerVersion, expected, receipt) {
  const { importedAt: _importedAt, ...binding } = expected;
  return stableDigest({ importerId, importerVersion, expected: binding, receipt });
}

function scopeUnion(left, right) {
  const unique = new Map();
  for (const scope of [...left, ...right]) unique.set(`${scope.kind}:${scope.id}`, scope);
  return [...unique.values()];
}

function capabilityRecordId({ carrierId, carrierVersion, adapterId, adapterVersion, hostScope, accountScope, policyDigest }) {
  return opaqueId("capability", { carrierId, carrierVersion, adapterId, adapterVersion, hostScope, accountScope, policyDigest });
}

function recordNegativeCapability(state, {
  carrierId,
  carrierVersion,
  adapterId,
  adapterVersion,
  hostScope,
  accountScope,
  policyDigest,
  reason,
  retryAfterSeconds,
}, catalog, now) {
  const negativeClass = negativeClassFor(reason);
  if (!negativeClass) return { ok: false, reason: "invalid_negative_capability_reason" };
  const configuredTtl = negativeTtlSeconds(catalog, negativeClass);
  const cappedRetryAfter = retryAfterSeconds === undefined
    ? undefined
    : Math.min(retryAfterMaximumSeconds(catalog), Math.max(1, retryAfterSeconds));
  const holdSeconds = Math.max(configuredTtl, cappedRetryAfter || 0);
  const record = {
    carrierId,
    carrierVersion,
    adapterId,
    adapterVersion,
    hostScope,
    accountScope,
    policyDigest,
    state: "unavailable",
    negativeReason: reason,
    negativeClass,
    notBefore: nowIso(now + holdSeconds * 1000),
    expiresAt: nowIso(now + holdSeconds * 1000),
  };
  if (cappedRetryAfter !== undefined) record.retryAfterSeconds = cappedRetryAfter;
  if (negativeClass === "unsupported") record.invalidation = "policy_or_adapter_digest";
  state.capabilities[capabilityRecordId(record)] = record;
  return { ok: true, record };
}

function recordOracleNegative(state, reservation, receipt, catalog, now) {
  if (reservation.selected.carrierId !== "oracle-browser") return;
  const reason = receipt.reason || (receipt.authReadiness === "auth_context_unavailable" ? "auth_context_unavailable" : null);
  if (!negativeClassFor(reason)) return;
  const adapter = ADAPTER_DESCRIPTORS[reservation.binding.adapterId];
  recordNegativeCapability(state, {
    carrierId: reservation.selected.carrierId,
    carrierVersion: reservation.selected.carrierVersion,
    adapterId: reservation.binding.adapterId,
    adapterVersion: adapter.version,
    hostScope: reservation.claimed.hostScope,
    accountScope: reservation.claimed.accountScope,
    policyDigest: reservation.policyDigest,
    reason,
    retryAfterSeconds: receipt.retryAfterSeconds,
  }, catalog, now);
}

function recordOracleReceiptCapability(state, reservation, receipt, imported, now) {
  if (reservation.selected.carrierId !== "oracle-browser" || receipt.status !== "settled" || receipt.reason !== null || receipt.authReadiness !== "fresh_success") return;
  const adapter = ADAPTER_DESCRIPTORS[reservation.binding.adapterId];
  const observedModel = receipt.observedModel || "unknown";
  const expiresAt = validIsoInstant(receipt.expiresAt) && Date.parse(receipt.expiresAt) > now
    ? receipt.expiresAt
    : nowIso(now + 5 * 60 * 1000);
  const record = {
    carrierId: reservation.selected.carrierId,
    carrierVersion: reservation.selected.carrierVersion,
    adapterId: reservation.binding.adapterId,
    adapterVersion: adapter.version,
    hostScope: reservation.claimed.hostScope,
    accountScope: reservation.claimed.accountScope,
    policyDigest: reservation.policyDigest,
    state: "live_carrier_verified",
    observedModel,
    resolvedModelDigest: stableDigest(observedModel),
    capabilities: ["private_receipt_bridge"],
    authState: "authenticated",
    expiresAt,
    attestedAt: nowIso(now),
    attestorId: ADAPTER_RECEIPT_ATTESTOR,
  };
  record.attestedFactsDigest = stableDigest({
    carrierId: record.carrierId,
    carrierVersion: record.carrierVersion,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    hostScope: record.hostScope,
    accountScope: record.accountScope,
    policyDigest: record.policyDigest,
    observedModel,
    receiptId: receipt.receiptId,
    importerAttestationDigest: imported.attestationDigest,
  });
  record.attestationDigest = stableDigest({ attestorId: record.attestorId, facts: record.attestedFactsDigest });
  state.capabilities[capabilityRecordId(record)] = record;
}

function releaseLeaseAllocation(lease, reservation, { restore = false } = {}) {
  const allocation = lease?.allocations?.[reservation.reservationId];
  if (!allocation) return;
  if (restore && lease.released !== true) {
    for (const [meter, raw] of ownEntries(allocation.forecast)) {
      const current = parseMeterAmount(meter, lease.remainingCeiling[meter] || "0").units;
      const ceiling = parseMeterAmount(meter, lease.ceiling[meter] || "0").units;
      lease.remainingCeiling[meter] = formatMeterAmount(meter, current + parseMeterAmount(meter, raw).units > ceiling ? ceiling : current + parseMeterAmount(meter, raw).units);
    }
  }
  delete lease.allocations[reservation.reservationId];
}

function receiptTransitionAllowed(phase, status) {
  if (["settled", "no_start"].includes(phase)) return false;
  const allowed = {
    claimed: new Set(["started", "settled", "no_start", "ambiguous", "bridge_acknowledged"]),
    started: new Set(["started", "settled", "ambiguous"]),
    ambiguous: new Set(["ambiguous", "settled", "no_start"]),
  };
  if (!allowed[phase]?.has(status)) return false;
  // A bridge acknowledgement is proof of a bootstrap handoff only.  It must
  // be the first terminal fact for its dedicated bootstrap reservation.
  return status !== "bridge_acknowledged" || phase === "claimed";
}

function epochHasActiveLeaseWork(state, epochId) {
  return Object.values(state.leases).some((lease) => {
    if (lease.epochId !== epochId || lease.released === true) return false;
    if (Object.keys(lease.allocations || {}).length > 0) return true;
    return Object.values(state.reservations).some((reservation) => reservation.leaseId === lease.leaseId && !["settled", "no_start"].includes(reservation.phase));
  });
}

function reconcileInternal(request, context) {
  const { state, now, catalog, trustedReceiptImporter } = context;
  if (!isObject(request.receipt) || !validId(request.reservationId)) return error("invalid_reconciliation_receipt");
  const reservation = state.reservations[request.reservationId];
  if (!reservation) return error("reservation_unknown");
  const adapter = ADAPTER_DESCRIPTORS[reservation.binding.adapterId];
  if (!adapter) return error("untrusted_receipt");
  if (request.frozenInputDigest !== reservation.frozenInputDigest || reservation.claimed?.frozenInputDigest !== reservation.frozenInputDigest) return error("receipt_input_mismatch");
  const imported = importTrustedReceipt(request.receipt, reservation, adapter, trustedReceiptImporter, now);
  if (!imported.ok) return error(imported.reason);
  const receipt = imported.value;
  const tombstone = state.settlementTombstones[receipt.receiptId];
  if (tombstone) {
    if (tombstone.reservationId !== reservation.reservationId || tombstone.claimId !== receipt.claimId || tombstone.frozenInputDigest !== receipt.frozenInputDigest || tombstone.producer !== receipt.producer || tombstone.adapterVersion !== receipt.adapterVersion || tombstone.attestationDigest !== imported.importer.attestationDigest) return error("receipt_replay_cross_claim");
    return result(true, "reconciliation_replayed", { reservation: clone(reservation), disclosure: clone(tombstone.settlementDisclosure) });
  }
  if (receipt.producer !== adapter.receiptProducer || receipt.adapterVersion !== adapter.version || receipt.claimId !== reservation.claimId || receipt.frozenInputDigest !== reservation.frozenInputDigest) return error("untrusted_receipt");
  if (!receiptTransitionAllowed(reservation.phase, receipt.status)) return error("invalid_receipt_transition");
  const headroom = ensureStateHeadroom(state, now);
  if (!headroom.ok) return headroom;
  const lease = reservation.leaseId ? state.leases[reservation.leaseId] : null;
  if (receipt.status === "settled" && lease && state.budgetEpochs[leaseEpochAccountingId(lease.epochId)]?.frozen) return error("budget_epoch_sealed");
  if (receipt.status === "bridge_acknowledged") {
    if (!reservation.bridgeLifecycleId || receipt.identityVerified !== true || receipt.acknowledgementVerified !== true) return error("bridge_acknowledgement_invalid");
    state.bridges[reservation.bridgeLifecycleId] = {
      acknowledged: true,
      reservationId: reservation.reservationId,
      claimId: reservation.claimId,
      at: nowIso(now),
      identityDigest: dispatchIdentityDigest(reservation.claimed),
      carrierId: reservation.selected.carrierId,
      adapterId: reservation.binding.adapterId,
    };
    reservation.phase = "settled";
  } else if (receipt.status === "started") {
    reservation.phase = "started";
  } else if (receipt.status === "ambiguous") {
    reservation.phase = "ambiguous";
  } else if (receipt.status === "no_start") {
    reservation.phase = "no_start";
    if (lease) releaseLeaseAllocation(lease, reservation, { restore: true });
  } else {
    const usage = normalUsage(receipt.measuredUsage);
    if (!usage.ok) return error(usage.reason);
    let ceilingBreached = false;
    let leaseCeilingBreached = false;
    const allocation = lease?.allocations?.[reservation.reservationId];
    const charge = { ...reservation.forecast, ...usage.value };
    for (const [meter, raw] of ownEntries(charge)) {
      const measured = parseMeterAmount(meter, raw).units;
      const reserved = parseMeterAmount(meter, reservation.forecast[meter] || "0").units;
      if (lease && (!allocation || !Object.hasOwn(allocation.forecast, meter) || measured > parseMeterAmount(meter, allocation.forecast[meter]).units)) leaseCeilingBreached = true;
      const settledScopes = scopeUnion(reservation.scopes, lease?.allocatorScopes || []);
      for (const scope of settledScopes) {
        const scopeId = scopeAccountingId(scope);
        if (state.budgetEpochs[scopeId]?.reason === "manual_seal") return error("budget_epoch_sealed");
        addSpent(state, scope, meter, measured > reserved ? measured : reserved, receipt.measuredBilled === true ? "measured_billed" : "calculated_estimate", now);
      }
      ceilingBreached ||= measured > reserved;
    }
    if (ceilingBreached) for (const scope of reservation.scopes) {
      const scopeId = scopeAccountingId(scope);
      state.budgetEpochs[scopeId] = { ...(state.budgetEpochs[scopeId] || {}), frozen: true, reason: "ceiling_breached", sealedAt: nowIso(now) };
    }
    if (leaseCeilingBreached && lease) {
      const epochKey = leaseEpochAccountingId(lease.epochId);
      state.budgetEpochs[epochKey] = { ...(state.budgetEpochs[epochKey] || {}), frozen: true, reason: "ceiling_breached", sealedAt: nowIso(now) };
    }
    reservation.phase = "settled";
    if (lease) releaseLeaseAllocation(lease, reservation);
    updateLearning(state, reservation, receipt, now, catalog);
  }
  if (["settled", "no_start"].includes(receipt.status)) recordOracleNegative(state, reservation, receipt, catalog, now);
  if (receipt.status === "settled") recordOracleReceiptCapability(state, reservation, receipt, imported.importer, now);
  if (reservation.selected.carrierId === "oracle-homebrew-lifecycle" && receipt.status === "settled" && receipt.reason === null) {
    const requirementId = opaqueId("fresh-review", { reservationId: reservation.reservationId, claimId: reservation.claimId, policyDigest: reservation.policyDigest });
    state.lifecycleReviewRequirements[requirementId] ||= {
      requirementId,
      hostScope: reservation.claimed.hostScope,
      accountScope: reservation.claimed.accountScope,
      policyDigest: reservation.policyDigest,
      lifecycleReservationId: reservation.reservationId,
      lifecycleClaimId: reservation.claimId,
      createdAt: nowIso(now),
      expiresAt: nowIso(now + DAY_MS),
      fulfilled: false,
    };
  }
  if (receipt.status === "settled" && (receipt.reason === undefined || receipt.reason === null) && reservation.postLifecycleRequirementId) {
    const requirement = state.lifecycleReviewRequirements[reservation.postLifecycleRequirementId];
    if (requirement && requirement.reviewClaimId === reservation.claimId) {
      requirement.fulfilled = true;
      requirement.fulfilledAt = nowIso(now);
    }
  }
  reservation.receiptIds.push(receipt.receiptId);
  reservation.updatedAt = nowIso(now);
  const disclosure = settlementDisclosure(reservation, receipt);
  state.settlementTombstones[receipt.receiptId] = { reservationId: reservation.reservationId, claimId: reservation.claimId, frozenInputDigest: reservation.frozenInputDigest, phase: reservation.phase, at: nowIso(now), producer: receipt.producer, adapterVersion: receipt.adapterVersion, identityDigest: stableDigest(reservation.claimed), importerId: imported.importer.id, importerVersion: imported.importer.version, attestationDigest: imported.importer.attestationDigest, settlementDisclosure: disclosure };
  const breached = receipt.status === "settled" && reservation.scopes.some((scope) => state.budgetEpochs[scopeAccountingId(scope)]?.reason === "ceiling_breached");
  return result(true, breached ? "ceiling_breached" : "reconciled", { reservation: clone(reservation), disclosure, stateChanged: true });
}

function defaultTerminalInternal(request, state, now) {
  const receipt = request.receipt;
  if (!isObject(receipt) || receipt.kind !== "default_terminal" || receipt.policyDigest !== DEFAULT_POLICY.digest || !validId(receipt.outcomeId)) {
    return error("invalid_default_terminal_receipt");
  }
  if (state.learningOutcomes[receipt.outcomeId]) return result(true, "default_terminal_replayed");
  const pseudoReservation = {
    decision: { role: validRole(receipt.role) ? receipt.role : "implementation" },
    selected: {
      carrierId: "codex-luna",
      carrierVersion: CARRIER_DESCRIPTORS["codex-luna"].version,
      model: "gpt-5.6-luna",
      effort: "max",
      executionSurface: "codex",
    },
    workShape: {},
    forecast: {},
    learningAllowed: true,
    routeLearningEligible: false,
  };
  updateLearning(state, pseudoReservation, { outcomeId: receipt.outcomeId, status: "settled" }, now);
  return result(true, "default_terminal_reconciled", { stateChanged: true });
}

function statusInternal(state, now, catalog = null) {
  const readiness = {};
  for (const [id, capability] of ownEntries(state.capabilities)) {
    readiness[id] = {
      carrierId: capability.carrierId,
      adapterId: capability.adapterId,
      state: capability.state,
      freshness: capability.expiresAt && Date.parse(capability.expiresAt) <= now ? "stale" : "fresh",
    };
  }
  return result(true, "status", {
    readiness,
    reservations: Object.values(state.reservations).map((record) => ({ reservationId: record.reservationId, phase: record.phase, scope: record.scope, selected: record.selected })),
    spend: clone(state.spendAggregates),
    learning: { enabled: catalog?.learning?.enabled !== false && state.learningControl.disabled !== true, outcomes: Object.keys(state.learningOutcomes).length, aggregates: Object.keys(state.learningAggregates).length },
  });
}

function inspectClaimInternal(request, state) {
  if (!validId(request.claimId)) return error("claim_id_required");
  let reservation;
  if (request.reservationId !== undefined) {
    reservation = state.reservations[request.reservationId];
    if (!reservation) return error("claim_unknown");
    if (reservation.claimId !== request.claimId) return error("claim_binding_mismatch");
  } else {
    const matches = Object.values(state.reservations).filter((record) => record.claimId === request.claimId);
    if (matches.length !== 1) return error(matches.length === 0 ? "claim_unknown" : "claim_ambiguous");
    reservation = matches[0];
  }
  if (!ACTIVE_CLAIM_PHASES.has(reservation.phase) || reservation.claimed?.frozenInputDigest !== reservation.frozenInputDigest) return error("claim_not_active");
  return result(true, "claim_verified", {
    claim: {
      claimId: reservation.claimId,
      reservationId: reservation.reservationId,
      state: reservation.phase,
      policyDigest: reservation.policyDigest,
      selected: {
        carrierId: reservation.selected.carrierId,
        carrierVersion: reservation.selected.carrierVersion,
        executionSurface: reservation.selected.executionSurface,
      },
      binding: {
        adapterId: reservation.binding.adapterId,
        adapterVersion: reservation.binding.adapterVersion,
        dispatchKind: reservation.binding.dispatchKind,
        hostScope: reservation.binding.hostScope,
        accountScope: reservation.binding.accountScope,
        contextFork: reservation.binding.contextFork || "not_applicable",
        r52Digest: reservation.binding.r52?.digest || "not_applicable",
      },
      dispatchIdentity: {
        hostScope: reservation.claimed.hostScope,
        accountScope: reservation.claimed.accountScope,
        dispatchKind: reservation.claimed.dispatchKind,
        sessionId: reservation.claimed.sessionId,
        toolId: reservation.claimed.toolId,
        toolVersion: reservation.claimed.toolVersion,
      },
      frozenInputDigest: reservation.frozenInputDigest,
      workClassDigest: reservation.workClassDigest || "unknown",
      objectiveDigest: reservation.objectiveDigest || "unknown",
      instructionDigest: reservation.instructionDigest || "unknown",
    },
  });
}

function capabilityAttestationFacts(record, attestation) {
  const facts = {
    carrierId: record.carrierId,
    carrierVersion: record.carrierVersion,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    hostScope: record.hostScope,
    accountScope: record.accountScope,
    policyDigest: record.policyDigest,
    observedModel: attestation.observedModel,
    authState: attestation.authState,
    capabilities: [...attestation.capabilities].sort(),
    fallbackSetDigest: attestation.fallbackSetDigest,
    expiresAt: attestation.expiresAt,
  };
  if (attestation.attestorId === FIXED_LOCAL_PROBE_ATTESTOR) {
    facts.probeId = attestation.probeId;
    facts.probeVersion = attestation.probeVersion;
    facts.probeDigest = attestation.probeDigest;
  }
  return facts;
}

function refreshInternal(request, context) {
  const { state, now, catalog, trustedCapabilityAttestor } = context;
  if (request.remoteProbe === true) return error("remote_probe_unsupported");
  if (request.capability === undefined) return result(true, "refresh_noop", { stateChanged: false });
  const capability = request.capability;
  const fields = new Set(["carrierId", "adapterId", "hostScope", "accountScope", "state", "negativeReason", "retryAfterSeconds"]);
  if (!onlyFields(capability, fields) || !isKnownCarrier(capability.carrierId) || !ADAPTER_DESCRIPTORS[capability.adapterId] || !validId(capability.hostScope) || !validId(capability.accountScope) || ![...POSITIVE_CAPABILITY_STATES, ...NEGATIVE_CAPABILITY_STATES].includes(capability.state)) return error("invalid_capability_evidence");
  const carrier = CARRIER_DESCRIPTORS[capability.carrierId];
  const adapter = ADAPTER_DESCRIPTORS[capability.adapterId];
  if (!carrier.adapters.includes(capability.adapterId)) return error("carrier_adapter_mismatch");
  const policy = validateCatalog(catalog).policy;
  const provider = catalog && Object.values(catalog.providers).find((item) => item.carrierId === capability.carrierId && item.account === capability.accountScope);
  if (!provider) return error("capability_account_unconfigured");
  if (NEGATIVE_CAPABILITY_STATES.has(capability.state)) {
    if (typeof capability.negativeReason !== "string" || !negativeClassFor(capability.negativeReason) || (capability.retryAfterSeconds !== undefined && (!Number.isInteger(capability.retryAfterSeconds) || capability.retryAfterSeconds < 1 || capability.retryAfterSeconds > 86_400))) return error("invalid_capability_evidence");
    const negative = recordNegativeCapability(state, {
      carrierId: capability.carrierId,
      carrierVersion: carrier.version,
      adapterId: capability.adapterId,
      adapterVersion: adapter.version,
      hostScope: capability.hostScope,
      accountScope: capability.accountScope,
      policyDigest: policy.digest,
      reason: capability.negativeReason,
      retryAfterSeconds: capability.retryAfterSeconds,
    }, catalog, now);
    return negative.ok
      ? result(true, "capability_refreshed", { capabilityId: capabilityRecordId(negative.record), stateChanged: true })
      : error(negative.reason);
  }
  if (capability.negativeReason !== undefined || capability.retryAfterSeconds !== undefined) return error("invalid_capability_evidence");
  const ttlMs = (catalog?.discovery?.positiveTtlSeconds || DEFAULT_POSITIVE_TTL_MS / 1000) * 1000;
  const id = capabilityRecordId({ carrierId: capability.carrierId, carrierVersion: carrier.version, adapterId: capability.adapterId, adapterVersion: adapter.version, hostScope: capability.hostScope, accountScope: capability.accountScope, policyDigest: policy.digest });
  const record = {
    carrierId: capability.carrierId,
    carrierVersion: carrier.version,
    adapterId: capability.adapterId,
    adapterVersion: adapter.version,
    hostScope: capability.hostScope,
    accountScope: capability.accountScope,
    policyDigest: policy.digest,
    state: capability.state,
    expiresAt: nowIso(now + ttlMs),
  };
  if (POSITIVE_CAPABILITY_STATES.has(capability.state)) {
    if (typeof trustedCapabilityAttestor !== "function") return error("trusted_attestor_unavailable");
    let attestation;
    try {
      attestation = trustedCapabilityAttestor(Object.freeze({ ...record, generatedAt: nowIso(now) }));
    } catch {
      return error("trusted_attestor_failed");
    }
    const attestationFields = new Set(["attestorId", "attestationDigest", "attestedAt", "expiresAt", "observedModel", "authState", "capabilities", "fallbackSetDigest", "attestedFactsDigest", "probeId", "probeVersion", "probeDigest"]);
    const fixedProbe = attestation?.attestorId === FIXED_LOCAL_PROBE_ATTESTOR;
    if (!isObject(attestation) || !onlyFields(attestation, attestationFields) || ![HOST_CAPABILITY_ATTESTOR, FIXED_LOCAL_PROBE_ATTESTOR].includes(attestation.attestorId) || !validDigest(attestation.attestationDigest) || !validIsoInstant(attestation.attestedAt) || !validIsoInstant(attestation.expiresAt) || Date.parse(attestation.expiresAt) <= now || Date.parse(attestation.expiresAt) > now + ttlMs || !validModel(attestation.observedModel) || !["unknown", "authenticated", "auth_context_unavailable"].includes(attestation.authState) || !Array.isArray(attestation.capabilities) || attestation.capabilities.some((item) => !validId(item)) || (attestation.fallbackSetDigest !== undefined && !validDigest(attestation.fallbackSetDigest)) || !validDigest(attestation.attestedFactsDigest) || (fixedProbe ? (!validId(attestation.probeId) || !validId(attestation.probeVersion) || !validDigest(attestation.probeDigest)) : (attestation.probeId !== undefined || attestation.probeVersion !== undefined || attestation.probeDigest !== undefined))) return error("invalid_trusted_attestation");
    const facts = capabilityAttestationFacts(record, attestation);
    if (attestation.attestedFactsDigest !== stableDigest(facts)) return error("trusted_attestation_fact_mismatch");
    Object.assign(record, attestation, { resolvedModelDigest: stableDigest(attestation.observedModel) });
  }
  state.capabilities[id] = record;
  return result(true, "capability_refreshed", { capabilityId: id, stateChanged: true });
}

function learningInternal(command, state) {
  if (command === "learning.inspect") return result(true, "learning_status", { enabled: state.learningControl.disabled !== true, outcomes: clone(state.learningOutcomes), aggregates: clone(state.learningAggregates) });
  if (command === "learning.clear") {
    state.learningOutcomes = {};
    state.learningAggregates = {};
    state.learningControl.clearedAt = new Date().toISOString();
    return result(true, "learning_cleared", { stateChanged: true });
  }
  if (command === "learning.disable") {
    state.learningControl.disabled = true;
    return result(true, "learning_disabled", { stateChanged: true });
  }
  if (command === "learning.enable") {
    state.learningControl.disabled = false;
    return result(true, "learning_enabled", { stateChanged: true });
  }
  return error("unknown_command");
}

/**
 * Pure command dispatcher used by tests and host adapters.  Pass an explicit
 * state object to keep tests fully offline; callers persist it with runCli.
 */
export function handleRequest(input, {
  catalog = null,
  state = createEmptyState(),
  now = Date.now(),
  platform = process.platform,
  trustedCapabilityAttestor,
  trustedReceiptImporter,
  trustedTaskAuthorityAttestor,
  trustedRuntimeAttestor,
  trustedTransportAttestor,
  fixedReceiptProducers,
  controllerRuntime,
  requireControllerRuntime = false,
} = {}) {
  const command = normalizeCommand(input || {});
  const requestIssue = validateRequest(input, command);
  if (requestIssue) return { response: requestIssue, state, changed: false };
  const catalogValidation = validateCatalog(catalog);
  if (!catalogValidation.ok) return { response: catalogValidation, state, changed: false };
  const stateValidation = validateState(state);
  if (!stateValidation.ok) return { response: stateValidation, state, changed: false };
  const mutatesState = MUTATING_COMMANDS.has(command) && !(command === "admit" && catalog === null);
  if (platform === "win32" && mutatesState) return { response: error("secure_state_unsupported"), state, changed: false };

  let response;
  if (command === "validate") response = result(true, "validated", { config: catalogValidation.policy, state: { digest: stateValidation.digest } });
  else if (command === "resolve") response = resolveInternal(input, { catalog, state, now, trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers });
  else if (command === "admit") response = admitInternal(input, { catalog, state, now, trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers, controllerRuntime, requireControllerRuntime });
  else if (command === "claim-dispatch") response = claimInternal(input, { catalog, state, now, controllerRuntime, requireControllerRuntime });
  else if (command === "mint-task-authority") response = mintTaskAuthorityInternal(input, { catalog, state, now, trustedTaskAuthorityAttestor, controllerRuntime, requireControllerRuntime });
  else if (command === "issue-lease") response = issueLeaseInternal(input, { catalog, state, now });
  else if (command === "accept-lease") response = acceptLeaseInternal(input, { catalog, state, now });
  else if (command === "claim-slot") response = claimSlotInternal(input, { catalog, state, now, controllerRuntime, requireControllerRuntime });
  else if (command === "release-lease") response = releaseLeaseInternal(input, { catalog, state, now });
  else if (command === "seal-epoch") response = sealEpochInternal(input, state, now);
  else if (command === "build-work-contract") response = buildInvariantWorkContract(input.workContract);
  else if (command === "reconcile") response = catalog === null && input.receipt?.kind === "default_terminal"
    ? defaultTerminalInternal(input, state, now)
    : reconcileInternal(input, { catalog, state, now, trustedReceiptImporter });
  else if (command === "status") response = statusInternal(state, now, catalog);
  else if (command === "inspect-claim") response = inspectClaimInternal(input, state);
  else if (command === "refresh") response = refreshInternal(input, { catalog, state, now, trustedCapabilityAttestor });
  else if (command?.startsWith("learning.")) response = learningInternal(command, state);
  else response = error("unknown_command");
  const changed = response.ok && response.stateChanged === true;
  if (changed) {
    const postMutation = validateState(state);
    if (!postMutation.ok) return { response: error("state_mutation_invalid", { field: postMutation.field }), state, changed: false };
  }
  if (Object.hasOwn(response, "stateChanged")) delete response.stateChanged;
  return { response, state, changed };
}

/** Offline-only benchmark receipt for the no-config selector path. */
export function measureFastPath(input, { iterations = 17, now = Date.now() } = {}) {
  if (!Number.isInteger(iterations) || iterations < 5 || iterations > 101) return error("invalid_fast_path_iterations");
  const state = createEmptyState();
  const before = stableDigest(state);
  const baselineSamples = [];
  const routedSamples = [];
  let decisionId = null;
  let baselineModel = null;
  let routedModel = null;
  for (let index = 0; index < iterations; index += 1) {
    const baselineStarted = process.hrtime.bigint();
    const baseline = defaultRoute({ ...input, command: undefined });
    if (!baseline.ok) return error("fast_path_unavailable", { cause: baseline.reason });
    baselineModel ||= baseline.model.requestedModel;
    baselineSamples.push(Number(process.hrtime.bigint() - baselineStarted) / 1_000_000);
    const started = process.hrtime.bigint();
    const handled = handleRequest({ ...input, command: "resolve" }, { state, now });
    if (!handled.response.ok || handled.changed) return error("fast_path_unavailable", { cause: handled.response.reason });
    decisionId ||= handled.response.decision.decisionId;
    routedModel ||= handled.response.decision.selected.model;
    routedSamples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  }
  const stats = (samples) => {
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
      workflowWallMs: samples.reduce((total, value) => total + value, 0),
    };
  };
  const baseline = stats(baselineSamples);
  const routed = stats(routedSamples);
  const receipt = {
    contractVersion: CONTRACT_VERSION,
    mode: "offline_default_selector",
    iterations,
    medianMs: routed.medianMs,
    p95Ms: routed.p95Ms,
    paired: {
      baseline: { ...baseline, toolCalls: 0, externalCalls: 0, tokenDelta: 0, stateWrites: 0, model: baselineModel },
      routed: { ...routed, toolCalls: 0, externalCalls: 0, tokenDelta: 0, stateWrites: 0, model: routedModel },
      delta: {
        medianMs: routed.medianMs - baseline.medianMs,
        p95Ms: routed.p95Ms - baseline.p95Ms,
        workflowWallMs: routed.workflowWallMs - baseline.workflowWallMs,
        toolCalls: 0,
        tokenDelta: 0,
        modelChanged: baselineModel !== routedModel,
      },
    },
    stateWrites: 0,
    externalCalls: 0,
    toolCalls: 0,
    tokenDelta: 0,
    decisionId,
    modelEvidence: { baseline: baselineModel, routed: routedModel, unchanged: baselineModel === routedModel },
    writeEvidence: { stateDigestBefore: before, stateDigestAfter: stableDigest(state), writes: 0 },
    conservativeNoiseThresholdMs: { median: 50, p95: 100 },
  };
  receipt.withinNoiseBudget = receipt.medianMs <= receipt.conservativeNoiseThresholdMs.median && receipt.p95Ms <= receipt.conservativeNoiseThresholdMs.p95;
  receipt.receiptBytes = Buffer.byteLength(JSON.stringify(receipt));
  if (stableDigest(state) !== before || receipt.receiptBytes > 4096) return error("fast_path_integrity_failed");
  return result(true, "fast_path_measured", { receipt });
}

function loadCatalogForCli(paths) {
  const loaded = readPrivateJson(paths.config.path, { missingOk: true, maxBytes: MAX_JSON_BYTES });
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    if (paths.config.source === "config-override") return error("selected_policy_missing", { source: paths.config.source });
    return result(true, "config_default", { catalog: null, source: paths.config.source });
  }
  const validation = validateCatalog(loaded.value);
  return validation.ok ? result(true, "catalog_loaded", { catalog: loaded.value, source: paths.config.source, digest: validation.policy.digest }) : validation;
}

function loadStateForCli(paths) {
  const loaded = readPrivateJson(paths.state.path, { missingOk: true, maxBytes: MAX_STATE_BYTES });
  if (!loaded.ok) return loaded;
  const state = loaded.value === null ? createEmptyState() : loaded.value;
  const validation = validateState(state);
  return validation.ok ? result(true, "state_loaded", { state }) : validation;
}

function fixedPrivateDirectoryIssue(directory) {
  const stat = safeStat(directory);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return "fixed_adapter_artifact_unavailable";
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "fixed_adapter_artifact_unavailable";
  return (stat.mode & 0o077) === 0 ? null : "fixed_adapter_artifact_unavailable";
}

function fixedOracleRouteRoot(home) {
  return path.join(path.resolve(home), ".local", "state", "yardmaster", "oracle-route");
}

function fixedOracleAdapterProbe() {
  // This is a fixed source path within this plugin, not a user-supplied
  // command or adapter hook.  It establishes only bridge availability; it
  // deliberately does not assert account entitlement or browser auth.
  const source = fileURLToPath(new URL("../skills/oracle/scripts/oracle-route.mjs", import.meta.url));
  const stat = safeStat(source);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return null;
  try {
    return {
      id: "oracle_route_private_receipt_bridge",
      version: "v1",
      digest: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
    };
  } catch {
    return null;
  }
}

function fixedCliCapabilityAttestor() {
  const probe = fixedOracleAdapterProbe();
  return (record) => {
    if (!probe || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(record.carrierId) || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(record.adapterId)) return null;
    const generatedAt = Date.parse(record.generatedAt);
    if (!Number.isFinite(generatedAt)) return null;
    const details = {
      attestorId: FIXED_LOCAL_PROBE_ATTESTOR,
      attestedAt: record.generatedAt,
      expiresAt: record.expiresAt,
      observedModel: "unknown",
      authState: "unknown",
      capabilities: ["private_receipt_bridge"],
      probeId: probe.id,
      probeVersion: probe.version,
      probeDigest: probe.digest,
    };
    const facts = capabilityAttestationFacts(record, details);
    return {
      ...details,
      attestedFactsDigest: stableDigest(facts),
      attestationDigest: stableDigest({ attestorId: details.attestorId, facts }),
    };
  };
}

function fixedBridgeFailure(reason) {
  const failure = new Error(reason);
  failure.fixedBridgeReason = reason;
  throw failure;
}

function fixedCliReceiptImporter(home) {
  return ({ expected, untrustedReceipt }) => {
    if (!FIXED_CLI_RECEIPT_PRODUCERS.has(expected.dispatchIdentity.toolId) || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(expected.binding.adapterId)) fixedBridgeFailure("receipt_importer_unsupported");
    if (!isObject(untrustedReceipt) || !onlyFields(untrustedReceipt, new Set(["receiptId"])) || typeof untrustedReceipt.receiptId !== "string" || !/^receipt_[a-f0-9]{32}$/.test(untrustedReceipt.receiptId)) fixedBridgeFailure("fixed_receipt_reference_required");
    const root = fixedOracleRouteRoot(home);
    const receipts = path.join(root, "receipts");
    if (fixedPrivateDirectoryIssue(root) || fixedPrivateDirectoryIssue(receipts)) fixedBridgeFailure("fixed_adapter_artifact_unavailable");
    const file = path.join(receipts, `${untrustedReceipt.receiptId}.json`);
    const loaded = readPrivateJson(file, { missingOk: false, maxBytes: MAX_JSON_BYTES });
    if (!loaded.ok || !isObject(loaded.value)) fixedBridgeFailure("fixed_adapter_artifact_unavailable");
    const receipt = loaded.value;
    const identity = expected.dispatchIdentity;
    if (receipt.receiptId !== untrustedReceipt.receiptId || receipt.producer !== identity.toolId || receipt.adapterVersion !== expected.binding.adapterVersion || receipt.claimId !== expected.claimId || receipt.frozenInputDigest !== expected.frozenInputDigest || receipt.hostScope !== identity.hostScope || receipt.accountScope !== identity.accountScope || receipt.dispatchKind !== identity.dispatchKind || receipt.sessionId !== identity.sessionId || receipt.toolId !== identity.toolId || receipt.toolVersion !== identity.toolVersion) fixedBridgeFailure("fixed_receipt_binding_mismatch");
    return {
      importerId: TRUSTED_RECEIPT_IMPORTER_ID,
      importerVersion: TRUSTED_RECEIPT_IMPORTER_VERSION,
      attestationDigest: receiptImportAttestationDigest(TRUSTED_RECEIPT_IMPORTER_ID, TRUSTED_RECEIPT_IMPORTER_VERSION, expected, receipt),
      attestedAt: expected.importedAt,
      receipt,
    };
  };
}

function fixedCliBridge(home) {
  return {
    trustedCapabilityAttestor: fixedCliCapabilityAttestor(),
    trustedReceiptImporter: fixedCliReceiptImporter(home),
    fixedReceiptProducers: FIXED_CLI_RECEIPT_PRODUCERS,
    requireControllerRuntime: false,
  };
}

export function runCli(input, options = {}) {
  const command = normalizeCommand(input || {});
  const suppliedEnv = options.env || process.env;
  const protectedInspection = command === "inspect-claim" && !(options.trustedEmbedding === true && options.trustedPathOverrides === true);
  const routingEnv = protectedInspection
    ? {
      ...suppliedEnv,
      YARDMASTER_MODEL_POLICY_PATH: undefined,
      YARDMASTER_MODEL_STATE_PATH: undefined,
      XDG_CONFIG_HOME: undefined,
      XDG_STATE_HOME: undefined,
      LOCALAPPDATA: undefined,
    }
    : suppliedEnv;
  const paths = resolvePaths({ ...options, env: routingEnv, ...(protectedInspection ? { home: os.homedir() } : {}) });
  if (!paths.ok) return paths;
  const cliHome = protectedInspection ? os.homedir() : (options.home || os.homedir());
  const bridge = options.trustedEmbedding === true
    ? {
      trustedCapabilityAttestor: options.trustedCapabilityAttestor,
      trustedReceiptImporter: options.trustedReceiptImporter,
      trustedTaskAuthorityAttestor: options.trustedTaskAuthorityAttestor,
      trustedRuntimeAttestor: options.trustedRuntimeAttestor,
      trustedTransportAttestor: options.trustedTransportAttestor,
      fixedReceiptProducers: options.fixedReceiptProducers,
      controllerRuntime: options.controllerRuntime,
      requireControllerRuntime: options.requireControllerRuntime === true,
    }
    : fixedCliBridge(cliHome);
  const catalogLoaded = loadCatalogForCli(paths);
  if (!catalogLoaded.ok) return catalogLoaded;
  const handleOptions = (state) => ({
    catalog: catalogLoaded.catalog,
    state,
    now: options.now ?? Date.now(),
    platform: options.platform || process.platform,
    ...bridge,
  });
  const platform = options.platform || process.platform;
  const mutatesState = MUTATING_COMMANDS.has(command) && !(command === "admit" && catalogLoaded.catalog === null);
  if (platform === "win32" && mutatesState) return error("secure_state_unsupported");
  if (mutatesState) {
    return withStateLock(paths.state.path, () => {
      const loaded = loadStateForCli(paths);
      if (!loaded.ok) return loaded;
      const handled = handleRequest(input, handleOptions(loaded.state));
      if (!handled.changed) return handled.response;
      const written = writePrivateJsonLocked(paths.state.path, handled.state);
      return written.ok ? handled.response : written;
    });
  }
  const needsState = command === "inspect-claim" || (command !== "resolve" && command !== "validate" && command !== "status" ? catalogLoaded.catalog !== null : command === "status");
  let state = createEmptyState();
  if (needsState || catalogLoaded.catalog !== null) {
    const loaded = loadStateForCli(paths);
    if (!loaded.ok) return loaded;
    state = loaded.state;
  }
  const handled = handleRequest(input, handleOptions(state));
  return handled.response;
}

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function main() {
  let input;
  try {
    const raw = readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
    if (process.argv[2] && input.command === undefined) input.command = process.argv[2];
  } catch {
    process.stdout.write(`${JSON.stringify(error("invalid_json_input"))}\n`);
    process.exitCode = 2;
    return;
  }
  const output = runCli(input);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.ok ? 0 : 1;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main();
