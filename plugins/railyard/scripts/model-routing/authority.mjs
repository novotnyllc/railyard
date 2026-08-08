/** Visible-task authority minting, matching, and consumption. */

import {
  clone,
  error,
  isObject,
  nowIso,
  onlyFields,
  result,
  sameControllerRuntime,
  stableDigest,
  validControllerRuntime,
  validDigest,
  validId,
  validIsoInstant,
} from "./bounds.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  ADAPTER_DESCRIPTORS,
  CARRIER_DESCRIPTORS,
  TASK_AUTHORITY_ATTESTOR,
} from "./registries.mjs";
import {
  validateAuthorityInput,
} from "./request.mjs";
import {
  authorityFacts,
  validDispatchIdentity,
} from "./state-schema.mjs";

export function authorityMatches(authority, request, decision, now, identity = null, controllerRuntime) {
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

export function consumeTaskAuthority(state, request, decision, reservation, identity, now, controllerRuntime) {
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

export function authorityIssueForAdmission(request, state, decision, now, { controllerRuntime, requireControllerRuntime = false } = {}) {
  const adapter = ADAPTER_DESCRIPTORS[decision.binding.adapterId];
  if (!adapter?.requiresTaskAuthority) return null;
  if (requireControllerRuntime && !validControllerRuntime(controllerRuntime)) return "controller_runtime_unavailable";
  const authority = request.taskAuthorityId ? state.taskAuthority[request.taskAuthorityId] : null;
  if (!authority || !authorityMatches(authority, request, decision, now, null, controllerRuntime)) return "visible_task_authority_required";
  return null;
}

export function mintTaskAuthorityInternal(request, context) {
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
