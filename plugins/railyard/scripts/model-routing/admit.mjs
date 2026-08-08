/** Admission and dispatch claiming. */

import {
  authorityIssueForAdmission,
  consumeTaskAuthority,
} from "./authority.mjs";
import {
  clone,
  error,
  formatMeterAmount,
  nowIso,
  opaqueId,
  ownEntries,
  parseMeterAmount,
  result,
  sameControllerRuntime,
  stableDigest,
  validControllerRuntime,
  validDigest,
  validId,
} from "./bounds.mjs";
import {
  budgetAdmissionAll,
  normalizeForecast,
  scopeFor,
} from "./budget.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  actionReceiptFor,
  allowedInheritedAdapterTransition,
  decisionFromCandidate,
  resolveInternal,
} from "./decision.mjs";
import {
  r28RouteDisclosure,
} from "./disclosure.mjs";
import {
  learnedForecastForCandidate,
} from "./learning.mjs";
import {
  ACTIVE_CLAIM_PHASES,
  ADAPTER_DESCRIPTORS,
  CARRIER_DESCRIPTORS,
} from "./registries.mjs";
import {
  candidateSort,
  configuredCandidates,
} from "./select.mjs";
import {
  authorityFacts,
  dispatchIdentityDigest,
  validDispatchIdentity,
} from "./state-schema.mjs";
import {
  ensureStateHeadroom,
} from "./store.mjs";

export function decisionForState(decision) {
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

export function reservationFromDecision(request, decision, scopes, forecast, now, authority = null) {
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
    // Cloned, like decisionForState: a persisted reservation must not alias the
    // live decision object a caller still holds.
    selected: clone(decision.selected),
    binding: clone(decision.binding),
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

export function admitInternal(request, context) {
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

export function claimInternal(request, context) {
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
