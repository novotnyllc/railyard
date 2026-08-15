/** Validators for every persisted record and the state document itself. */

import {
  boundedIssue,
  error,
  isKnownCarrier,
  isObject,
  onlyFields,
  ownEntries,
  parseMeterAmount,
  result,
  stableDigest,
  validContextFork,
  validControllerRuntime,
  validDigest,
  validEffort,
  validId,
  validIsoInstant,
  validMeter,
  validMeterMap,
  validModel,
  validPolicyDigest,
  validR52Binding,
  validRole,
  validScope,
  validScopes,
  validShape,
} from "./bounds.mjs";
import {
  ACTION_FALLBACK_REASONS,
  ACTION_INHERITANCE_REASONS,
  ACTION_RECEIPT_REASONS,
  ACTION_RECEIPT_SCHEMA,
  ACTIVE_CLAIM_PHASES,
  ADAPTER_DESCRIPTORS,
  ADAPTER_RECEIPT_ATTESTOR,
  BUDGET_EFFECTS,
  CARRIER_DESCRIPTORS,
  CE_SEAMS,
  HARNESS_KINDS,
  DEFAULT_NEGATIVE_TTL_MS,
  DEFAULT_RETRY_AFTER_MAX_SECONDS,
  DISCLOSURE_PROVENANCE,
  DISPATCH_KINDS,
  EXECUTION_SURFACES,
  FIXED_LOCAL_PROBE_ATTESTOR,
  HOST_CAPABILITY_ATTESTOR,
  MAX_LEARNING_SAMPLE_INFLUENCE,
  MAX_LEASE_SLOTS,
  MAX_SESSION_ID,
  NEGATIVE_CAPABILITY_STATES,
  NEGATIVE_REASON_CLASS,
  NEGATIVE_TTL_DEFAULTS,
  POSITIVE_CAPABILITY_STATES,
  STATE_PURPOSE,
  STATE_SCHEMA_VERSION,
  TASK_AUTHORITY_ATTESTOR,
  TRUSTED_RECEIPT_IMPORTER_ID,
  TRUSTED_RECEIPT_IMPORTER_VERSION,
} from "./registries.mjs";
import {
  validDaybreakAvailability,
} from "./daybreak-availability.mjs";

/**
 * Persisted records are described by field tables rather than by one
 * kilobyte-long boolean chain.  A table is `{ field: check(value, record) }`,
 * its keys are the complete set of permitted fields, and the checks run in
 * declaration order so a later field may rely on an earlier one having passed.
 */
function recordValid(record, ...tables) {
  const table = Object.assign({}, ...tables);
  if (!onlyFields(record, new Set(Object.keys(table)))) return false;
  for (const [field, check] of Object.entries(table)) if (!check(record[field], record)) return false;
  return true;
}

const optional = (check) => (value, record) => value === undefined || check(value, record);
const absent = (value) => value === undefined;
const is = (...allowed) => (value) => allowed.includes(value);
const boundedInteger = (min, max) => (value) => Number.isInteger(value) && value >= min && value <= max;
const digestOr = (...allowed) => (value) => allowed.includes(value) || validDigest(value);
const idList = (value) => Array.isArray(value) && value.every(validId);
const isBoolean = (value) => typeof value === "boolean";

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

/** v4 had the same durable records, before Daybreak's optional cache field. */
export function migrateState(state) {
  if (!isObject(state) || state.purpose !== STATE_PURPOSE || state.stateSchemaVersion !== 4) return state;
  return { ...state, stateSchemaVersion: STATE_SCHEMA_VERSION };
}

export function validSelected(value) {
  const fields = new Set(["modelAlias", "model", "effort", "carrierId", "carrierVersion", "executionSurface", "transport", "adapterId", "adapterVersion", "completionState", "observedModel"]);
  if (!onlyFields(value, fields) || !validId(value.modelAlias) || !validModel(value.model) || !validEffort(value.effort) || !isKnownCarrier(value.carrierId) || !validId(value.carrierVersion) || !EXECUTION_SURFACES.has(value.executionSurface) || typeof value.transport !== "string" || !validId(value.adapterId) || !validId(value.adapterVersion)) return false;
  const carrier = CARRIER_DESCRIPTORS[value.carrierId];
  const adapter = ADAPTER_DESCRIPTORS[value.adapterId];
  return carrier?.version === value.carrierVersion && adapter?.version === value.adapterVersion && carrier.adapters.includes(value.adapterId);
}

export function validBinding(value) {
  const fields = new Set(["adapterId", "adapterVersion", "dispatchKind", "budgetEffect", "controls", "transportPath", "bridgePhase", "hostScope", "accountScope", "contextFork", "r52", "profile", "compositeReservations", "ceSeam", "harness", "crossHarnessReason"]);
  if (!onlyFields(value, fields) || !validId(value.adapterId) || !validId(value.adapterVersion) || !DISPATCH_KINDS.has(value.dispatchKind) || !BUDGET_EFFECTS.has(value.budgetEffect) || !isObject(value.controls) || (value.transportPath !== "native" && value.transportPath !== "visible_provider_task") || ![null, "activation", "bootstrap"].includes(value.bridgePhase) || !validId(value.hostScope) || !validId(value.accountScope)) return false;
  if (Object.hasOwn(value, "harness") !== Object.hasOwn(value, "crossHarnessReason")) return false;
  const adapter = ADAPTER_DESCRIPTORS[value.adapterId];
  if (!adapter || adapter.version !== value.adapterVersion || !adapter.dispatchKinds.includes(value.dispatchKind)) return false;
  if (stableDigest(value.controls) !== stableDigest(adapter.controls)) return false;
  if (value.profile !== undefined && !validId(value.profile)) return false;
  if (value.compositeReservations !== undefined && (!Array.isArray(value.compositeReservations) || value.compositeReservations.some((item) => !validId(item)))) return false;
  if (value.contextFork !== undefined && !validContextFork(value.contextFork)) return false;
  if (value.r52 !== undefined && !validR52Binding(value.r52)) return false;
  if (value.harness !== undefined && value.harness !== "unknown" && !HARNESS_KINDS.has(value.harness)) return false;
  if (value.crossHarnessReason !== undefined && !(typeof value.crossHarnessReason === "string" && value.crossHarnessReason.trim().toLowerCase() === "not_applicable") && (typeof value.crossHarnessReason !== "string" || value.crossHarnessReason.trim().length < 8 || value.crossHarnessReason.length > 256)) return false;
  return value.ceSeam === undefined || validCeSeam(value.ceSeam);
}

export function validCeSeam(value) {
  if (!onlyFields(value, new Set(["id", "skill", "artifact"]))) return false;
  const definition = CE_SEAMS[value.id];
  if (!definition || value.skill !== definition.skill || !isObject(value.artifact) || !onlyFields(value.artifact, new Set(["schema", "digest"]))) return false;
  return value.artifact.schema === definition.artifactSchema && validDigest(value.artifact.digest);
}

export function ceSeamAllows(value, role, carrierId) {
  const definition = value && CE_SEAMS[value.id];
  return validCeSeam(value) && Boolean(definition) && definition.roles.includes(role) && definition.carriers.includes(carrierId);
}

export function validStoredDecision(value) {
  if (!onlyFields(value, new Set(["decisionId", "policyDigest", "role", "selected", "binding", "disclosure", "workClassDigest"]))) return false;
  return validId(value.decisionId) && validPolicyDigest(value.policyDigest) && validRole(value.role) && validSelected(value.selected) && validBinding(value.binding) && validR28Disclosure(value.disclosure) && (value.workClassDigest === undefined || validDigest(value.workClassDigest)) && (value.binding.ceSeam === undefined || ceSeamAllows(value.binding.ceSeam, value.role, value.selected.carrierId));
}

export function negativeClassFor(reason) {
  return typeof reason === "string" ? NEGATIVE_REASON_CLASS[reason] || null : null;
}

export function negativeTtlSeconds(catalog, negativeClass) {
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

export function retryAfterMaximumSeconds(catalog) {
  return catalog?.discovery?.retryAfterMaxSeconds || DEFAULT_RETRY_AFTER_MAX_SECONDS;
}

const CAPABILITY_IDENTITY = {
  carrierId: isKnownCarrier,
  carrierVersion: (value, evidence) => validId(value) && CARRIER_DESCRIPTORS[evidence.carrierId].version === value,
  adapterId: (value, evidence) => Boolean(ADAPTER_DESCRIPTORS[value]) && CARRIER_DESCRIPTORS[evidence.carrierId].adapters.includes(value),
  adapterVersion: (value, evidence) => validId(value) && ADAPTER_DESCRIPTORS[evidence.adapterId].version === value,
  hostScope: validId,
  accountScope: validId,
  policyDigest: validPolicyDigest,
  state: (value) => POSITIVE_CAPABILITY_STATES.has(value) || NEGATIVE_CAPABILITY_STATES.has(value),
  authState: optional(is("unknown", "authenticated", "auth_context_unavailable")),
  expiresAt: validIsoInstant,
};

/** Positive evidence names the model it saw and carries a trusted attestation. */
const CAPABILITY_POSITIVE = {
  observedModel: validModel,
  resolvedModelDigest: (value, evidence) => value === stableDigest(evidence.observedModel),
  fallbackSetDigest: optional(validDigest),
  capabilities: optional(idList),
  attestorId: is(HOST_CAPABILITY_ATTESTOR, FIXED_LOCAL_PROBE_ATTESTOR, ADAPTER_RECEIPT_ATTESTOR),
  attestedAt: validIsoInstant,
  attestationDigest: validDigest,
  attestedFactsDigest: validDigest,
  probeId: (value, evidence) => (evidence.attestorId === FIXED_LOCAL_PROBE_ATTESTOR ? validId(value) : value === undefined),
  probeVersion: (value, evidence) => (evidence.attestorId === FIXED_LOCAL_PROBE_ATTESTOR ? validId(value) : value === undefined),
  probeDigest: (value, evidence) => (evidence.attestorId === FIXED_LOCAL_PROBE_ATTESTOR ? validDigest(value) : value === undefined),
  negativeReason: absent,
  negativeClass: absent,
  retryAfterSeconds: absent,
  notBefore: absent,
  invalidation: absent,
};

/** Negative evidence carries a classified reason and no attestation at all. */
const CAPABILITY_NEGATIVE = {
  negativeReason: (value) => negativeClassFor(value) !== null,
  negativeClass: (value, evidence) => value === negativeClassFor(evidence.negativeReason),
  retryAfterSeconds: optional(boundedInteger(1, 86_400)),
  notBefore: optional(validIsoInstant),
  // An "unsupported" hold is honored past expiry, so it must name the event
  // that invalidates it; every other class simply ages out.
  invalidation: (value, evidence) => (evidence.negativeClass === "unsupported" ? value === "policy_or_adapter_digest" : value === undefined),
  observedModel: absent,
  resolvedModelDigest: absent,
  fallbackSetDigest: absent,
  capabilities: absent,
  attestorId: absent,
  attestedAt: absent,
  attestationDigest: absent,
  attestedFactsDigest: absent,
  probeId: absent,
  probeVersion: absent,
  probeDigest: absent,
};

export function validateCapabilityRecord(id, evidence) {
  if (!validId(id) || !isObject(evidence)) return false;
  if (POSITIVE_CAPABILITY_STATES.has(evidence.state)) return recordValid(evidence, CAPABILITY_IDENTITY, CAPABILITY_POSITIVE);
  if (NEGATIVE_CAPABILITY_STATES.has(evidence.state)) return recordValid(evidence, CAPABILITY_IDENTITY, CAPABILITY_NEGATIVE);
  return false;
}

const TASK_AUTHORITY_FIELDS = {
  authorityId: validId,
  objectiveEpoch: validId,
  objectiveDigest: optional(validDigest),
  senderOwner: validId,
  accountScope: validId,
  carrierId: isKnownCarrier,
  adapterId: (value, authority) => Boolean(ADAPTER_DESCRIPTORS[value]) && CARRIER_DESCRIPTORS[authority.carrierId].adapters.includes(value),
  policyDigest: validPolicyDigest,
  destinationScope: validId,
  destinationClass: is("visible_task", "delegated_slot"),
  maxTaskCount: boundedInteger(1, MAX_LEASE_SLOTS),
  usedTaskCount: (value, authority) => boundedInteger(0, authority.maxTaskCount)(value),
  currentTurn: validId,
  issuedAt: validIsoInstant,
  expiresAt: (value, authority) => validIsoInstant(value) && Date.parse(value) > Date.parse(authority.issuedAt),
  // A fully spent authority records when it was consumed; a live one must not.
  consumedAt: (value, authority) => (authority.usedTaskCount === authority.maxTaskCount ? validIsoInstant(value) : value === undefined),
  source: is("explicit_user_instruction"),
  sourceReceiptDigest: validDigest,
  controller: optional(validControllerRuntime),
  attestorId: is(TASK_AUTHORITY_ATTESTOR),
  attestationDigest: validDigest,
  attestedAt: validIsoInstant,
  authorityFactsDigest: validDigest,
  cooperative: is(true),
};

export function validateTaskAuthorityRecord(id, authority) {
  return validId(id) && isObject(authority) && authority.authorityId === id && recordValid(authority, TASK_AUTHORITY_FIELDS);
}

const LEASE_FIELDS = {
  leaseId: validId,
  issuerScope: validId,
  allocatorScopes: validScopes,
  destinationScope: validId,
  destinationAccountScope: validId,
  policyDigest: validPolicyDigest,
  epochId: validId,
  carrierId: isKnownCarrier,
  carrierVersion: (value, lease) => CARRIER_DESCRIPTORS[lease.carrierId].version === value,
  adapterId: (value, lease) => Boolean(ADAPTER_DESCRIPTORS[value]) && CARRIER_DESCRIPTORS[lease.carrierId].adapters.includes(value),
  adapterVersion: (value, lease) => ADAPTER_DESCRIPTORS[lease.adapterId].version === value,
  ceiling: validMeterMap,
  remainingCeiling: validMeterMap,
  maxSlots: boundedInteger(1, MAX_LEASE_SLOTS),
  slotsClaimed: (value, lease) => boundedInteger(0, lease.maxSlots)(value),
  allocations: isObject,
  issuedAt: validIsoInstant,
  expiresAt: (value, lease) => validIsoInstant(value) && Date.parse(value) > Date.parse(lease.issuedAt),
  allocatorReceiptDigest: validDigest,
  accepted: isBoolean,
  acceptedAt: (value, lease) => (lease.accepted ? validIsoInstant(value) : value === undefined),
  released: isBoolean,
  releasedAt: (value, lease) => (lease.released ? validIsoInstant(value) : value === undefined),
  cooperative: is(true),
};

export function validateLeaseRecord(id, lease) {
  if (!validId(id) || !isObject(lease) || lease.leaseId !== id || !recordValid(lease, LEASE_FIELDS)) return false;
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

export function validDispatchIdentity(value, expectedProducer) {
  const fields = new Set(["hostScope", "accountScope", "dispatchKind", "sessionId", "toolId", "toolVersion"]);
  return onlyFields(value, fields) && validId(value.hostScope) && validId(value.accountScope) && DISPATCH_KINDS.has(value.dispatchKind) && validId(value.sessionId) && value.sessionId.length <= MAX_SESSION_ID && validId(value.toolId) && validId(value.toolVersion) && (expectedProducer === undefined || value.toolId === expectedProducer);
}

export function dispatchIdentityDigest(value) {
  return stableDigest({
    hostScope: value.hostScope,
    accountScope: value.accountScope,
    dispatchKind: value.dispatchKind,
    sessionId: value.sessionId,
    toolId: value.toolId,
    toolVersion: value.toolVersion,
  });
}

export function validLearningShape(value) {
  return value === undefined || validShape(value) === null;
}

export function validDisclosureScalar(value) {
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

export function validDisclosureFacet(value, { meters = false } = {}) {
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
export function validR28Disclosure(value) {
  const routeFields = new Set(["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"]);
  const carrierFields = new Set(["carrierId", "carrierVersion", "adapterId", "adapterVersion", "probeId", "probeVersion", "probeDigest"]);
  if (!isObject(value) || !onlyFields(value, new Set(["schema", "route", "reasonCode", "requested", "configured", "observed", "carrier", "meters", "capability", "privacy", "rejectedAlternatives", "attribution", "escalation"]))) return false;
  if (value.schema !== "railyard/r28-route-disclosure/v1" || !["selected", "fallback", "settlement"].includes(value.route) || !validId(value.reasonCode)) return false;
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

export function validActionModel(value, { actual = false } = {}) {
  return isObject(value)
    && onlyFields(value, new Set(["model", "effort"]))
    && (actual && value.model === "unknown" || validModel(value.model))
    && (actual && value.effort === "unknown" || validEffort(value.effort));
}

const ACTION_RECEIPT_FIELDS = {
  schema: is(ACTION_RECEIPT_SCHEMA),
  actionId: validId,
  actionDigest: validDigest,
  reason: (value) => ACTION_RECEIPT_REASONS.has(value),
  adapter: (value) => isObject(value)
    && onlyFields(value, new Set(["adapterId", "adapterVersion", "dispatchKind"]))
    && Boolean(ADAPTER_DESCRIPTORS[value.adapterId])
    && value.adapterVersion === ADAPTER_DESCRIPTORS[value.adapterId].version
    && DISPATCH_KINDS.has(value.dispatchKind),
  // A budget-neutral message starts no work; a top-up always does.
  startsWork: (value, receipt) => isBoolean(value) && value === (receipt.reason === "active_budget_top_up"),
  workClassDigest: validDigest,
  priorWorkClassDigest: digestOr("not_applicable"),
  priorRouteDigest: digestOr("not_applicable"),
  r52Digest: digestOr("not_applicable"),
  capability: (value) => isObject(value) && onlyFields(value, new Set(["state", "freshness"])) && typeof value.state === "string" && typeof value.freshness === "string",
  requested: (value) => validActionModel(value),
  actual: (value) => validActionModel(value, { actual: true }),
  inheritanceReason: (value, receipt) => ACTION_INHERITANCE_REASONS.has(value)
    && value === (receipt.priorRouteDigest === "not_applicable" ? "not_applicable" : "intentional_same_class_inheritance"),
  fallbackReason: (value) => ACTION_FALLBACK_REASONS.has(value),
  budget: (value, receipt) => (receipt.reason === "active_budget_top_up"
    ? isObject(value) && onlyFields(value, new Set(["kind", "forecast", "warningCount"])) && value.kind === "top_up" && validMeterMap(value.forecast) && boundedInteger(0, 64)(value.warningCount)
    : value === "not_applicable"),
};

export function validActionReceipt(value) {
  return recordValid(value, ACTION_RECEIPT_FIELDS);
}

export function validLearningOutcome(id, value) {
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

export function validLearningAggregate(id, value) {
  const common = new Set(["kind", "baseBucket", "role", "risk", "contextClass", "workShape", "count", "totalDurationMs", "totalRetries", "failures", "verified", "ratingTotal", "updatedAt"]);
  const baseFields = new Set([...common, "usageTotals", "forecastTotals", "forecastInfluenceByMeter"]);
  const routeFields = new Set([...common, "routeEffectBucket", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelBucket", "tieBreakInfluence"]);
  if (!validId(id) || !isObject(value) || !["baseDemand", "routeEffect"].includes(value.kind) || !onlyFields(value, value.kind === "baseDemand" ? baseFields : routeFields)) return false;
  if (!validDigest(value.baseBucket) || !validRole(value.role) || !["low", "medium", "high", "critical", "unknown"].includes(value.risk) || !validId(value.contextClass) || !validLearningShape(value.workShape) || !Number.isInteger(value.count) || value.count < 0 || !Number.isInteger(value.totalDurationMs) || value.totalDurationMs < 0 || !Number.isInteger(value.totalRetries) || value.totalRetries < 0 || !Number.isInteger(value.failures) || value.failures < 0 || !Number.isInteger(value.verified) || value.verified < 0 || !Number.isInteger(value.ratingTotal) || value.ratingTotal < 0 || !validIsoInstant(value.updatedAt)) return false;
  if (value.kind === "baseDemand") return validMeterMap(value.usageTotals) && validMeterMap(value.forecastTotals) && isObject(value.forecastInfluenceByMeter) && ownEntries(value.forecastInfluenceByMeter).every(([meter, influence]) => validMeter(meter) && Number.isFinite(influence) && Math.abs(influence) <= MAX_LEARNING_SAMPLE_INFLUENCE);
  return validDigest(value.routeEffectBucket) && isKnownCarrier(value.carrierId) && value.carrierVersion === CARRIER_DESCRIPTORS[value.carrierId].version && validEffort(value.effort) && EXECUTION_SURFACES.has(value.billingSurface) && validDigest(value.resolvedModelBucket) && Number.isFinite(value.tieBreakInfluence) && Math.abs(value.tieBreakInfluence) <= MAX_LEARNING_SAMPLE_INFLUENCE;
}

export function validLifecycleReviewRequirement(id, value) {
  const fields = new Set(["requirementId", "hostScope", "accountScope", "policyDigest", "lifecycleReservationId", "lifecycleClaimId", "createdAt", "expiresAt", "reviewClaimId", "fulfilled", "fulfilledAt"]);
  if (!validId(id) || !onlyFields(value, fields) || value.requirementId !== id || !validId(value.hostScope) || !validId(value.accountScope) || !validPolicyDigest(value.policyDigest) || !validId(value.lifecycleReservationId) || !validId(value.lifecycleClaimId) || !validIsoInstant(value.createdAt) || !validIsoInstant(value.expiresAt) || Date.parse(value.expiresAt) <= Date.parse(value.createdAt) || typeof value.fulfilled !== "boolean") return false;
  if (value.reviewClaimId !== undefined && !validId(value.reviewClaimId)) return false;
  return value.fulfilled ? validIsoInstant(value.fulfilledAt) && validId(value.reviewClaimId) : value.fulfilledAt === undefined;
}

export function validAuthorityBinding(value) {
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

const CLAIMED_FIELDS = new Set(["id", "state", "hostScope", "accountScope", "dispatchKind", "sessionId", "toolId", "toolVersion", "frozenInputDigest", "at", "currentTurn", "authorityId", "postLifecycleRequirementId"]);

/** The claim records the exact destination identity the reservation bound. */
function validClaimedRecord(claimed, reservation) {
  if (!isObject(claimed) || !onlyFields(claimed, CLAIMED_FIELDS)) return false;
  const identity = {
    hostScope: claimed.hostScope,
    accountScope: claimed.accountScope,
    dispatchKind: claimed.dispatchKind,
    sessionId: claimed.sessionId,
    toolId: claimed.toolId,
    toolVersion: claimed.toolVersion,
  };
  return claimed.id === reservation.claimId
    && ACTIVE_CLAIM_PHASES.has(claimed.state)
    && validDispatchIdentity(identity)
    && identity.hostScope === reservation.binding.hostScope
    && identity.accountScope === reservation.binding.accountScope
    && identity.dispatchKind === reservation.binding.dispatchKind
    && identity.toolId === ADAPTER_DESCRIPTORS[reservation.binding.adapterId].receiptProducer
    && identity.toolVersion === reservation.binding.adapterVersion
    && claimed.frozenInputDigest === reservation.frozenInputDigest
    && validIsoInstant(claimed.at)
    && optional(validId)(claimed.currentTurn)
    && optional(validId)(claimed.authorityId)
    && optional(validId)(claimed.postLifecycleRequirementId);
}

function validBudgetWarning(warning) {
  return recordValid(warning, {
    meter: validMeter,
    reason: is("soft_budget_exceeded"),
    scope: optional(is("task", "run", "project")),
    scopeId: optional(validId),
  });
}

function validAdjustment(adjustment) {
  return recordValid(adjustment, {
    requestDigest: validDigest,
    forecast: validMeterMap,
    at: validIsoInstant,
    actionReceipt: optional(validActionReceipt),
  });
}

const RESERVATION_FIELDS = {
  reservationId: validId,
  decisionId: validId,
  requestId: validId,
  requestDigest: validDigest,
  frozenInputDigest: validDigest,
  objectiveDigest: optional(validDigest),
  instructionDigest: optional(validDigest),
  workClassDigest: optional(validDigest),
  phase: is("reserved", "claimed", "started", "ambiguous", "settled", "no_start"),
  scope: validScope,
  scopes: (value, reservation) => validScopes(value) && stableDigest(reservation.scope) === stableDigest(value[0]),
  forecast: validMeterMap,
  selected: validSelected,
  binding: validBinding,
  policyDigest: validPolicyDigest,
  createdAt: validIsoInstant,
  updatedAt: validIsoInstant,
  claimId: (value, reservation) => (reservation.phase === "reserved" ? value === null : validId(value)),
  claimed: (value, reservation) => (reservation.phase === "reserved" ? value === undefined : validClaimedRecord(value, reservation)),
  receiptIds: (value) => idList(value) && new Set(value).size === value.length,
  // The stored decision is the reservation's own route, restated: it must agree
  // on identity, policy, and the exact selected/binding bytes.
  decision: (value, reservation) => validStoredDecision(value)
    && value.decisionId === reservation.decisionId
    && value.policyDigest === reservation.policyDigest
    && value.role !== undefined
    && stableDigest(value.selected) === stableDigest(reservation.selected)
    && stableDigest(value.binding) === stableDigest(reservation.binding)
    && (reservation.workClassDigest === undefined || value.workClassDigest === reservation.workClassDigest),
  budgetWarnings: optional((value) => Array.isArray(value) && value.every(validBudgetWarning)),
  bridgeLifecycleId: optional(validId),
  adjustments: optional((value) => isObject(value) && ownEntries(value).every(([key, adjustment]) => validId(key) && validAdjustment(adjustment))),
  leaseId: optional(validId),
  workShape: validLearningShape,
  risk: optional(is("low", "medium", "high", "critical")),
  contextClass: optional(validId),
  learningAllowed: optional(isBoolean),
  postLifecycleRequirementId: optional(validId),
  authorityBinding: (value, reservation) => (ADAPTER_DESCRIPTORS[reservation.binding.adapterId]?.requiresTaskAuthority ? validAuthorityBinding(value) : value === undefined),
};

export function validateReservationRecord(id, reservation) {
  return validId(id) && isObject(reservation) && reservation.reservationId === id && recordValid(reservation, RESERVATION_FIELDS);
}

const BUDGET_EPOCH_FIELDS = {
  frozen: isBoolean,
  reason: optional(is("ceiling_breached", "manual_seal")),
  sealedAt: optional(validIsoInstant),
  epoch: optional(boundedInteger(0, Number.MAX_SAFE_INTEGER)),
};

const SETTLEMENT_TOMBSTONE_FIELDS = {
  reservationId: validId,
  claimId: validId,
  frozenInputDigest: validDigest,
  phase: is("settled", "no_start", "ambiguous", "started"),
  at: validIsoInstant,
  producer: validId,
  adapterVersion: validId,
  identityDigest: validDigest,
  importerId: is(TRUSTED_RECEIPT_IMPORTER_ID),
  importerVersion: is(TRUSTED_RECEIPT_IMPORTER_VERSION),
  attestationDigest: validDigest,
  settlementDisclosure: validR28Disclosure,
};

const BRIDGE_FIELDS = {
  acknowledged: is(true),
  reservationId: validId,
  claimId: validId,
  at: validIsoInstant,
  identityDigest: validDigest,
  carrierId: isKnownCarrier,
  adapterId: (value) => Boolean(ADAPTER_DESCRIPTORS[value]),
};

function validSpendAggregate(scope, meters) {
  return /^scope_[a-f0-9]{24}$/.test(scope)
    && isObject(meters)
    && ownEntries(meters).every(([meter, value]) => validMeter(meter) && recordValid(value, {
      hardAccounted: (amount) => parseMeterAmount(meter, amount).ok,
      provenance: is("measured_billed", "calculated_estimate"),
      at: optional(validIsoInstant),
    }));
}

/** Every keyed record collection is `id -> record`, validated the same way. */
function everyRecordValid(records, check) {
  return ownEntries(records).every(([id, value]) => check(id, value));
}

export function validateState(state) {
  const bounded = boundedIssue(state);
  if (bounded) return error(bounded, { source: "state" });
  if (!isObject(state) || state.purpose !== STATE_PURPOSE || state.stateSchemaVersion !== STATE_SCHEMA_VERSION) {
    return error("unsupported_state_schema", { migration: "Remove only an obsolete model-routing state file after preserving required accounting evidence." });
  }
  const fields = new Set(["purpose", "stateSchemaVersion", "capabilities", "budgetEpochs", "taskAuthority", "leases", "reservations", "settlementTombstones", "spendAggregates", "bridges", "learningControl", "learningOutcomes", "learningAggregates", "lifecycleReviewRequirements", "daybreakAvailability"]);
  if (!onlyFields(state, fields)) return error("invalid_state", { field: "unknown" });
  for (const field of ["capabilities", "budgetEpochs", "taskAuthority", "leases", "reservations", "settlementTombstones", "spendAggregates", "bridges", "learningControl", "learningOutcomes", "learningAggregates", "lifecycleReviewRequirements"]) {
    if (!isObject(state[field])) return error("invalid_state", { field });
  }
  if (!everyRecordValid(state.capabilities, validateCapabilityRecord)) return error("invalid_state", { field: "capabilities" });
  if (!everyRecordValid(state.budgetEpochs, (id, value) => validId(id) && recordValid(value, BUDGET_EPOCH_FIELDS))) return error("invalid_state", { field: "budgetEpochs" });
  if (!everyRecordValid(state.taskAuthority, validateTaskAuthorityRecord)) return error("invalid_state", { field: "taskAuthority" });
  if (!everyRecordValid(state.leases, validateLeaseRecord)) return error("invalid_state", { field: "leases" });
  if (!everyRecordValid(state.reservations, validateReservationRecord)) return error("invalid_state", { field: "reservations" });
  if (Object.values(state.reservations).some((reservation) => reservation.authorityBinding && (!state.taskAuthority[reservation.authorityBinding.authorityId] || stableDigest(authorityFacts(state.taskAuthority[reservation.authorityBinding.authorityId])) !== reservation.authorityBinding.authorityFactsDigest || state.taskAuthority[reservation.authorityBinding.authorityId].attestationDigest !== reservation.authorityBinding.attestationDigest))) return error("invalid_state", { field: "reservationAuthorityBinding" });
  if (Object.values(state.reservations).some((reservation) => reservation.leaseId !== undefined && (!state.leases[reservation.leaseId] || (ACTIVE_CLAIM_PHASES.has(reservation.phase) && (!state.leases[reservation.leaseId].allocations[reservation.reservationId] || state.leases[reservation.leaseId].allocations[reservation.reservationId].claimId !== reservation.claimId))))) return error("invalid_state", { field: "reservationLeaseBinding" });
  if (Object.values(state.leases).some((lease) => ownEntries(lease.allocations).some(([reservationId, allocation]) => !state.reservations[reservationId] || state.reservations[reservationId].leaseId !== lease.leaseId || state.reservations[reservationId].claimId !== allocation.claimId || !ACTIVE_CLAIM_PHASES.has(state.reservations[reservationId].phase)))) return error("invalid_state", { field: "leaseReservationBinding" });
  if (!everyRecordValid(state.settlementTombstones, (id, value) => validId(id) && recordValid(value, SETTLEMENT_TOMBSTONE_FIELDS))) return error("invalid_state", { field: "settlementTombstones" });
  if (!everyRecordValid(state.spendAggregates, validSpendAggregate)) return error("invalid_state", { field: "spendAggregates" });
  if (!everyRecordValid(state.bridges, (id, value) => validId(id) && recordValid(value, BRIDGE_FIELDS))) return error("invalid_state", { field: "bridges" });
  if (!recordValid(state.learningControl, { disabled: optional(isBoolean), clearedAt: optional(validIsoInstant) })) return error("invalid_state", { field: "learningControl" });
  if (!everyRecordValid(state.learningOutcomes, validLearningOutcome)) return error("invalid_state", { field: "learningOutcomes" });
  if (!everyRecordValid(state.learningAggregates, validLearningAggregate)) return error("invalid_state", { field: "learningAggregates" });
  if (!everyRecordValid(state.lifecycleReviewRequirements, validLifecycleReviewRequirement)) return error("invalid_state", { field: "lifecycleReviewRequirements" });
  if (state.daybreakAvailability !== undefined && !validDaybreakAvailability(state.daybreakAvailability)) return error("invalid_state", { field: "daybreakAvailability" });
  return result(true, "state_valid", { digest: stableDigest(state) });
}

export function authorityFacts(authority) {
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
