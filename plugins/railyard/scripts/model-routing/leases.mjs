/** Delegated-slot leases and budget epochs. */

import {
  claimInternal,
} from "./admit.mjs";
import {
  clone,
  error,
  formatMeterAmount,
  leaseEpochAccountingId,
  nowIso,
  ownEntries,
  parseMeterAmount,
  result,
  stableDigest,
  validId,
} from "./bounds.mjs";
import {
  budgetAdmissionAll,
  scopeFor,
} from "./budget.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  ADAPTER_DESCRIPTORS,
  CARRIER_DESCRIPTORS,
  MAX_LEASES,
} from "./registries.mjs";
import {
  validateLeaseInput,
  validateLeaseReference,
} from "./request.mjs";
import {
  ensureStateHeadroom,
} from "./store.mjs";

export function issueLeaseInternal(request, context) {
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

export function acceptLeaseInternal(request, context) {
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

export function claimSlotInternal(request, context) {
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

export function releaseLeaseInternal(request, context) {
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

export function sealEpochInternal(request, state, now) {
  if (!validId(request.epochId)) return error("epoch_id_required");
  const key = leaseEpochAccountingId(request.epochId);
  const existing = state.budgetEpochs[key];
  if (existing?.frozen) return result(true, "epoch_already_sealed", { epoch: clone(existing), stateChanged: false });
  if (epochHasActiveLeaseWork(state, request.epochId)) return error("epoch_active_allocations");
  const epoch = { frozen: true, reason: "manual_seal", sealedAt: nowIso(now), epoch: (existing?.epoch || 0) + 1 };
  state.budgetEpochs[key] = epoch;
  return result(true, "epoch_sealed", { epoch: clone(epoch), cooperative: true, stateChanged: true });
}

export function releaseLeaseAllocation(lease, reservation, { restore = false } = {}) {
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

export function epochHasActiveLeaseWork(state, epochId) {
  return Object.values(state.leases).some((lease) => {
    if (lease.epochId !== epochId || lease.released === true) return false;
    if (Object.keys(lease.allocations || {}).length > 0) return true;
    return Object.values(state.reservations).some((reservation) => reservation.leaseId === lease.leaseId && !["settled", "no_start"].includes(reservation.phase));
  });
}
