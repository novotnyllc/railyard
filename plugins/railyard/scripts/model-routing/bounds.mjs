/** Bounded-value grammar: identifiers, digests, meters, canonical hashing. */

import crypto from "node:crypto";

import {
  CARRIER_DESCRIPTORS,
  CONTRACT_VERSION,
  CONTROLLER_ORIGINATORS,
  DEFAULT_POLICY,
  DIGEST_RE,
  EFFORTS,
  ID_RE,
  MAX_CONTEXT_FORK_TURNS,
  MAX_DEPTH,
  MAX_ENTRIES,
  MAX_STRING,
  MODEL_RE,
  R52_PLATFORM_CLASSES,
  R52_READINESS_SCHEMA,
  R52_READINESS_STATES,
  RESERVED_KEYS,
  ROLE_RE,
  SHAPE_FIELDS,
  SHAPE_VALUES,
} from "./registries.mjs";

export function nowIso(now) {
  return new Date(now).toISOString();
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function ownEntries(value) {
  return isObject(value) ? Object.entries(value) : [];
}

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function stableDigest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function opaqueId(prefix, value) {
  return `${prefix}_${stableDigest(value).slice(0, 24)}`;
}

export function result(ok, reason, fields = {}) {
  return { contractVersion: CONTRACT_VERSION, ok, reason, ...fields };
}

export function error(reason, details = {}) {
  return result(false, reason, details);
}

export function hasControl(value) {
  return typeof value === "string" && /[\u0000-\u001f\u007f]/.test(value);
}

export function walkBounded(value, state, depth = 0) {
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

export function boundedIssue(value) {
  return walkBounded(value, { count: 0 });
}

export function validId(value) {
  return typeof value === "string" && ID_RE.test(value);
}

export function validRole(value) {
  return typeof value === "string" && ROLE_RE.test(value);
}

export function validModel(value) {
  return typeof value === "string" && MODEL_RE.test(value) && !value.startsWith("-") && !value.includes("/") && !value.includes("\\") && !value.includes("@") && !value.includes("--");
}

export function validDigest(value) {
  return typeof value === "string" && DIGEST_RE.test(value);
}

export function validControllerValue(value) {
  // Codex thread IDs can be UUID-like and therefore need not satisfy the
  // router's lower-case opaque-ID grammar. They are still bounded, printable,
  // and never accepted from a request as a trust decision.
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

export function validControllerRuntime(value) {
  return isObject(value)
    && onlyFields(value, new Set(["threadId", "permissionProfile", "originator"]))
    && validControllerValue(value.threadId)
    && validControllerValue(value.permissionProfile)
    && CONTROLLER_ORIGINATORS.has(value.originator);
}

export function controllerIdentityDigest(value) {
  return stableDigest({
    threadId: value.threadId,
    permissionProfile: value.permissionProfile,
    originator: value.originator,
  });
}

export function sameControllerRuntime(left, right) {
  return validControllerRuntime(left)
    && validControllerRuntime(right)
    && left.threadId === right.threadId
    && left.permissionProfile === right.permissionProfile
    && left.originator === right.originator;
}

export function validEffort(value) {
  return EFFORTS.has(value);
}

export function validShape(shape) {
  if (shape === undefined) return null;
  if (!isObject(shape)) return "invalid_work_shape";
  for (const [key, value] of ownEntries(shape)) {
    if (!SHAPE_FIELDS.includes(key) || !SHAPE_VALUES.has(value)) return "invalid_work_shape";
  }
  return null;
}

export function validContextFork(value) {
  return value === undefined
    || value === "none"
    || (typeof value === "string" && /^[1-9]\d{0,2}$/.test(value) && Number(value) <= MAX_CONTEXT_FORK_TURNS);
}

export function validR52ReadinessFact(value) {
  return isObject(value)
    && onlyFields(value, new Set(["state", "evidenceDigest"]))
    && R52_READINESS_STATES.has(value.state)
    && validDigest(value.evidenceDigest);
}

export function validR52PlatformIdentity(value) {
  return isObject(value)
    && onlyFields(value, new Set(["identityDigest", "platform"]))
    && validDigest(value.identityDigest)
    && R52_PLATFORM_CLASSES.has(value.platform);
}

export function validR52Readiness(value) {
  return isObject(value)
    && onlyFields(value, new Set(["schema", "hostReadiness", "taskReadiness", "transportReadiness", "executionHost", "targetPlatform"]))
    && value.schema === R52_READINESS_SCHEMA
    && validR52ReadinessFact(value.hostReadiness)
    && validR52ReadinessFact(value.taskReadiness)
    && validR52ReadinessFact(value.transportReadiness)
    && validR52PlatformIdentity(value.executionHost)
    && validR52PlatformIdentity(value.targetPlatform);
}

export function r52Ready(value) {
  return validR52Readiness(value)
    && [value.hostReadiness, value.taskReadiness, value.transportReadiness].every((fact) => fact.state === "ready");
}

export function r52Binding(value) {
  if (!validR52Readiness(value)) return null;
  return { ...clone(value), digest: stableDigest(value) };
}

export function validR52Binding(value) {
  if (!isObject(value) || !onlyFields(value, new Set(["schema", "hostReadiness", "taskReadiness", "transportReadiness", "executionHost", "targetPlatform", "digest"])) || !validDigest(value.digest)) return false;
  const { digest, ...readiness } = value;
  return validR52Readiness(readiness) && digest === stableDigest(readiness);
}

export function normalizedWorkClassShape(shape = {}) {
  return Object.fromEntries(SHAPE_FIELDS.map((field) => [field, shape[field] || "unknown"]));
}

export function derivedWorkClassDigest(request) {
  return stableDigest({
    schema: "railyard/work-class/v1",
    role: request.role || "unknown",
    risk: request.risk || "unknown",
    contextClass: request.contextClass || "unknown",
    workShape: normalizedWorkClassShape(request.workShape),
  });
}

export function workClassForRequest(request) {
  const digest = derivedWorkClassDigest(request);
  if (request.workClassDigest !== undefined && request.workClassDigest !== digest) return error("work_class_digest_mismatch");
  return result(true, "work_class_resolved", { workClassDigest: digest });
}

export function validOpaque(value) {
  return validId(value);
}

export function isKnownCarrier(id) {
  return Object.hasOwn(CARRIER_DESCRIPTORS, id);
}

export function onlyFields(value, fields) {
  return isObject(value) && Object.keys(value).every((key) => fields.has(key));
}

export function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validSourceUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

export function parseClaudeFamily(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(?:claude-)?(fable|opus|sonnet|haiku)(?:[-:](current|\d+(?:\.\d+){0,3}))?$/i);
  if (!match) return null;
  return { family: match[1].toLowerCase(), selector: (match[2] || "current").toLowerCase() };
}

export function validClaudeFamily(value) {
  return Boolean(parseClaudeFamily(value));
}

export function validPolicyDigest(value) {
  return value === DEFAULT_POLICY.digest || validDigest(value);
}

export function validIsoInstant(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function validScope(value) {
  return isObject(value) && onlyFields(value, new Set(["kind", "id"])) && ["task", "run", "project"].includes(value.kind) && validId(value.id);
}

export function validScopes(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 3 && value.every(validScope) && new Set(value.map((scope) => `${scope.kind}:${scope.id}`)).size === value.length;
}

export function scopeAccountingId(scope) {
  return `scope_${stableDigest({ kind: scope.kind, id: scope.id }).slice(0, 24)}`;
}

export function leaseEpochAccountingId(epochId) {
  return `lease_epoch_${stableDigest(epochId).slice(0, 24)}`;
}

export function validMeterMap(value) {
  return isObject(value) && ownEntries(value).every(([meter, amount]) => parseMeterAmount(meter, amount).ok);
}

export function validMeter(meter) {
  return typeof meter === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(meter);
}

export function isUsdMeter(meter) {
  return /usd/i.test(meter);
}

export function parseMeterAmount(meter, value) {
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

export function formatMeterAmount(meter, units) {
  if (isUsdMeter(meter)) {
    const whole = units / 1_000_000n;
    const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : whole.toString();
  }
  return units.toString();
}
