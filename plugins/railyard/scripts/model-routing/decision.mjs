/** Decision and action-receipt assembly. */

import {
  clone,
  derivedWorkClassDigest,
  error,
  nowIso,
  opaqueId,
  r52Binding,
  result,
  stableDigest,
  validDigest,
  validId,
  workClassForRequest,
} from "./bounds.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  r28RouteDisclosure,
} from "./disclosure.mjs";
import {
  ACTION_RECEIPT_SCHEMA,
  ACTIVE_CLAIM_PHASES,
  ADAPTER_DESCRIPTORS,
  DEFAULT_POLICY,
} from "./registries.mjs";
import {
  validatePriorRoute,
} from "./request.mjs";
import {
  candidateSort,
  completionStateFor,
  configuredCandidates,
  defaultRoute,
} from "./select.mjs";
import {
  ceSeamAllows,
  createEmptyState,
  validActionReceipt,
  validDispatchIdentity,
  validateState,
} from "./state-schema.mjs";

export function actionReceiptFor(request, decision, {
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

export function decisionFromCandidate(candidate, request, policy, now, rejected = []) {
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
    harness: request.harness || "not_applicable",
    crossHarnessReason: request.crossHarnessReason || "not_applicable",
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
  if (request.harness !== undefined || request.crossHarnessReason !== undefined || candidate.provider.harness !== undefined) {
    decision.requested.harness = request.harness || "not_applicable";
    decision.requested.crossHarnessReason = request.crossHarnessReason || "not_applicable";
    decision.binding.harness = candidate.provider.harness || "unknown";
    decision.binding.crossHarnessReason = request.crossHarnessReason || "not_applicable";
  }
  if (request.contextFork !== undefined) decision.binding.contextFork = request.contextFork;
  if (readiness) decision.binding.r52 = readiness;
  decision.learning = candidate.learning || "not_applicable";
  decision.disclosure = r28RouteDisclosure(candidate, request, { rejectedAlternatives: rejected });
  decision.fallbackReceipt = candidate.substitute
    ? r28RouteDisclosure(candidate, request, { route: "fallback", reasonCode: candidate.substitute, rejectedAlternatives: rejected })
    : r28RouteDisclosure(candidate, request, { route: "fallback", reasonCode: "not_applicable", rejectedAlternatives: [], notApplicable: true });
  // The "must go to Codex" signal belongs to the implementation ROLE, not to
  // one carrier descriptor: sourcing it from codex-luna alone dropped it
  // exactly when Luna degraded to the Terra substitute. Model comes from the
  // selected carrier, so an attested Terra slug is what deliver is told to run.
  //
  // Strength is "require" only when Codex is proven present — a measured
  // runtime attestation (`provenance:"measured_fact"`, which the Terra
  // substitute path also carries) or an explicitly configured catalog route
  // (no `candidate.runtime`). The no-config fixed default assumes Luna without
  // proof: the public CLI supplies no runtime attestor, so demanding Codex
  // there dead-ends a Claude-Code-only host at the ce-work blocker before any
  // code is written. That default is "prefer" instead — deliver still routes
  // to Codex when its preflight proves it available, and falls back to a native
  // Claude implementation when it is not.
  if ((request.role === "implementation" || request.role?.startsWith("implementation."))
    && (candidate.provider.executionSurface === "codex" || candidate.provider.harness === "codex")) {
    const codexProven = candidate.runtime ? candidate.runtime.provenance === "measured_fact" : true;
    decision.implementationEngine = { mode: codexProven ? "require" : "prefer", target: "codex", model: selectedModel, source: "deliver" };
  }
  if (candidate.substitute) decision.fallback = { reason: candidate.substitute, actualModel: selectedModel, effort: candidate.effort, disclosure: clone(decision.fallbackReceipt) };
  if (candidate.carrier.fixedProfile) decision.binding.profile = candidate.carrier.fixedProfile;
  if (candidate.adapter.composite) decision.binding.compositeReservations = ["controller", "claude_child"];
  if (request.ceSeam) {
    decision.binding.ceSeam = clone(request.ceSeam);
    decision.executionOverride = {
      contractVersion: "railyard/ce-execution-override/v1",
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

export function allowedInheritedAdapterTransition(previousAdapterId, nextAdapterId, carrierId, dispatchKind) {
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

export function inheritedRouteIssue(request, state, decision, catalog) {
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

export function resolveInternal(request, { catalog = null, state = createEmptyState(), now = Date.now(), trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers } = {}) {
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
