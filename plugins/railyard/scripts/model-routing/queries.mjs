/** Read-only status/inspection commands plus local capability refresh. */

import {
  clone,
  error,
  isKnownCarrier,
  isObject,
  nowIso,
  onlyFields,
  ownEntries,
  result,
  stableDigest,
  validDigest,
  validId,
  validIsoInstant,
  validModel,
} from "./bounds.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  capabilityRecordId,
  recordNegativeCapability,
} from "./receipts.mjs";
import {
  ACTIVE_CLAIM_PHASES,
  ADAPTER_DESCRIPTORS,
  CARRIER_DESCRIPTORS,
  DEFAULT_POSITIVE_TTL_MS,
  FIXED_LOCAL_PROBE_ATTESTOR,
  HOST_CAPABILITY_ATTESTOR,
  NEGATIVE_CAPABILITY_STATES,
  POSITIVE_CAPABILITY_STATES,
} from "./registries.mjs";
import {
  negativeClassFor,
} from "./state-schema.mjs";
import {
  ensureStateHeadroom,
} from "./store.mjs";

export function statusInternal(state, now, catalog = null) {
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

export function inspectClaimInternal(request, state) {
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

export function capabilityAttestationFacts(record, attestation) {
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

export function refreshInternal(request, context) {
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
  // refresh is the only writer that grows state.capabilities, and it was the
  // one mutating path that never took headroom — so it filled the ceiling and
  // wedged every write. Both the positive and negative branches write below.
  const headroom = ensureStateHeadroom(state, now);
  if (!headroom.ok) return headroom;
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

export function learningInternal(command, state) {
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
