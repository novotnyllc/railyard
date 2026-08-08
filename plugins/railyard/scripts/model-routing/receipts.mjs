/** Trusted receipt import, reconciliation, and capability effects. */

import path from "node:path";

import {
  clone,
  error,
  isObject,
  leaseEpochAccountingId,
  nowIso,
  onlyFields,
  opaqueId,
  ownEntries,
  parseMeterAmount,
  result,
  scopeAccountingId,
  stableDigest,
  validDigest,
  validId,
  validIsoInstant,
  validMeterMap,
  validModel,
  validRole,
} from "./bounds.mjs";
import {
  addSpent,
  normalUsage,
} from "./budget.mjs";
import {
  settlementDisclosure,
} from "./disclosure.mjs";
import {
  updateLearning,
} from "./learning.mjs";
import {
  releaseLeaseAllocation,
} from "./leases.mjs";
import {
  ADAPTER_DESCRIPTORS,
  ADAPTER_RECEIPT_ATTESTOR,
  CARRIER_DESCRIPTORS,
  CONTRACT_VERSION,
  DAY_MS,
  DEFAULT_POLICY,
  RECEIPT_STATUSES,
  TRUSTED_RECEIPT_IMPORTER_ID,
  TRUSTED_RECEIPT_IMPORTER_VERSION,
} from "./registries.mjs";
import {
  dispatchIdentityDigest,
  negativeClassFor,
  negativeTtlSeconds,
  retryAfterMaximumSeconds,
  validDispatchIdentity,
} from "./state-schema.mjs";
import {
  ensureStateHeadroom,
} from "./store.mjs";

export function validFixedOracleMeterSurface(value) {
  return isObject(value) && onlyFields(value, new Set(["marginalUsd", "codexCredits", "openaiApiSpend"])) && value.marginalUsd === 0 && value.codexCredits === 0 && value.openaiApiSpend === 0;
}

export function normalizeReceipt(receipt, adapter, reservation) {
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

export function importTrustedReceipt(rawReceipt, reservation, adapter, trustedReceiptImporter, now) {
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
export function receiptImportAttestationDigest(importerId, importerVersion, expected, receipt) {
  const { importedAt: _importedAt, ...binding } = expected;
  return stableDigest({ importerId, importerVersion, expected: binding, receipt });
}

export function scopeUnion(left, right) {
  const unique = new Map();
  for (const scope of [...left, ...right]) unique.set(`${scope.kind}:${scope.id}`, scope);
  return [...unique.values()];
}

export function capabilityRecordId({ carrierId, carrierVersion, adapterId, adapterVersion, hostScope, accountScope, policyDigest }) {
  return opaqueId("capability", { carrierId, carrierVersion, adapterId, adapterVersion, hostScope, accountScope, policyDigest });
}

export function recordNegativeCapability(state, {
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

export function recordOracleNegative(state, reservation, receipt, catalog, now) {
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

export function recordOracleReceiptCapability(state, reservation, receipt, imported, now) {
  if (reservation.selected.carrierId !== "oracle-browser" || receipt.status !== "settled" || receipt.reason !== null || receipt.authReadiness !== "fresh_success") return;
  const adapter = ADAPTER_DESCRIPTORS[reservation.binding.adapterId];
  const observedModel = receipt.observedModel || "unknown";
  // `live_carrier_verified` asserts the router saw which model actually
  // answered.  A receipt that authenticated but reported no model identity is
  // host capability evidence, not carrier identity evidence: recording it as
  // live_carrier_verified with observedModel "unknown" collapsed two states the
  // contract keeps apart, and let an unidentified carrier satisfy a
  // provider_latest_family or minimum-generation check.
  const identified = observedModel !== "unknown" && validModel(observedModel);
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
    state: identified ? "live_carrier_verified" : "host_capability_attested",
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

export function receiptTransitionAllowed(phase, status) {
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

export function reconcileInternal(request, context) {
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

export function defaultTerminalInternal(request, state, now) {
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
