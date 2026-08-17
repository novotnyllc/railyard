/** Candidate enumeration, ordering, attestation, and the no-config default route. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isObject,
  onlyFields,
  ownEntries,
  parseClaudeFamily,
  parseMeterAmount,
  stableDigest,
  validDigest,
  validEffort,
  validId,
  validModel,
} from "./bounds.mjs";
import {
  learningHintForCandidate,
} from "./learning.mjs";
import {
  ADAPTER_DESCRIPTORS,
  CARRIER_DESCRIPTORS,
  CONTRACT_VERSION,
  DEFAULT_RATE_STALE_MS,
  LOCALITY_RANK,
  NEGATIVE_CAPABILITY_STATES,
  POSITIVE_CAPABILITY_STATES,
  RETENTION_RANK,
  RUNTIME_ATTESTOR,
  SHAPE_FIELDS,
  TRANSPORT_ATTESTOR,
} from "./registries.mjs";
import {
  ceSeamAllows,
} from "./state-schema.mjs";
import {
  daybreakAvailable,
} from "./daybreak-availability.mjs";

export function adapterFor(request, carrier) {
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

export function effectiveHostScope(request = {}, fallback) {
  return request.hostScope || request.destinationScope || request.priorRoute?.hostScope || fallback || "local";
}

export function effectiveAccountScope(request = {}, provider = {}, fallback) {
  return request.accountScope || request.priorRoute?.accountScope || fallback || provider?.account || "local";
}

/** The App Server enumerates only this machine's configured Codex account. */
export function daybreakAvailabilityScopeMatches(request = {}, provider = {}) {
  return effectiveHostScope(request) === "local"
    && effectiveAccountScope(request, provider) === provider.account;
}

export function capabilityFor(state, { carrierId, carrier, adapterId, provider, policyDigest, request, now, positive = true }) {
  const hostScope = effectiveHostScope(request);
  const accountScope = effectiveAccountScope(request, provider);
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

export function completionStateFor(carrier, capability) {
  if (!carrier.requiresCallableAttestation) return "offline_implementation_ready";
  return capability?.state || "offline_implementation_ready";
}

export function transportDecision(request, adapter, trustedTransportAttestor, provider, capability) {
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
      hostScope: effectiveHostScope(request, capability?.hostScope),
      accountScope: effectiveAccountScope(request, provider, capability?.accountScope),
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

export function modelGeneration(value) {
  const match = typeof value === "string" ? value.match(/(?:^|[^0-9])(\d+(?:\.\d+){0,3})(?:$|[^0-9])/i) : null;
  return match ? match[1].split(".").map(Number) : null;
}

export function minimumGenerationSatisfied(model, observed) {
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

export function shapeMatches(required, actual = {}) {
  for (const [field, allowed] of ownEntries(required || {})) {
    if (!SHAPE_FIELDS.includes(field) || !Array.isArray(allowed) || !allowed.includes(actual[field] || "unknown")) return false;
  }
  return true;
}

export function privacyAllows(provider, model, carrier, request, catalog) {
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

export function providerAvailabilityIssue(provider, request = {}) {
  const availability = provider?.availability;
  if (availability === undefined) return null;
  if (availability.kind !== "codex_config") return "provider_unavailable";
  const hostScope = effectiveHostScope(request);
  if (hostScope !== "local") return null;
  try {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const config = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
    const section = availability.section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^[ \\t]*\\[${section}\\][ \\t]*(?:#.*)?\\r?$`, "m").test(config) ? null : "provider_unavailable";
  } catch {
    return "provider_unavailable";
  }
}

export function effortFor(request, model, carrier) {
  const effort = request.effort || model.effort || model.efforts?.[0] || carrier.efforts[0];
  if (!validEffort(effort) || !carrier.efforts.includes(effort) || (model.efforts && !model.efforts.includes(effort))) return null;
  return effort;
}

export function fallbackSetDigest(model) {
  return stableDigest([model.requestedModel, ...(model.fallbackSet || [])].sort());
}

export function freshRate(candidate, now) {
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

export function claudeIdentitySatisfied(model, observed) {
  const requested = parseClaudeFamily(model.requestedModel);
  const actual = parseClaudeFamily(observed);
  if (!requested || !actual || requested.family !== actual.family) return false;
  if (model.identityMode === "exact_pin") return requested.selector === actual.selector;
  if (model.minimumGeneration && actual.selector === "current") return false;
  return minimumGenerationSatisfied(model, observed);
}

export function configuredCandidates(catalog, request, state, now, policyDigest, { trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers } = {}) {
  const roleRule = catalog.roles[request.role];
  if (!roleRule) return [{ ok: false, reason: "role_unconfigured", alias: null }];
  const runtimeDecisions = new Map();
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
      let runtime = null;
      if (["codex-luna", "codex-terra-runtime"].includes(model.carrierId)) {
        const hostScope = effectiveHostScope(request);
        const accountScope = effectiveAccountScope(request, provider);
        const runtimeKey = `${hostScope}\u0000${accountScope}`;
        if (!runtimeDecisions.has(runtimeKey)) runtimeDecisions.set(runtimeKey, fixedRuntimeDecision(trustedRuntimeAttestor, request, provider));
        runtime = runtimeDecisions.get(runtimeKey);
      }
      if (!carrier) {
        output.push({ ok: false, alias, tierIndex, position, reason: "unsupported_adapter" });
        continue;
      }
      if (typeof trustedRuntimeAttestor === "function" && !runtime && ["codex-luna", "codex-terra-runtime"].includes(model.carrierId)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "invalid_runtime_attestation" });
        continue;
      }
      if (request.harness !== undefined) {
        if (!provider.harness) {
          output.push({ ok: false, alias, tierIndex, position, reason: "harness_unattributed" });
          continue;
        }
        const hasCrossHarnessReason = typeof request.crossHarnessReason === "string"
          && request.crossHarnessReason.trim().length >= 8
          && request.crossHarnessReason.trim().toLowerCase() !== "not_applicable";
        if ((request.role === "implementation.cross-harness" || provider.harness !== request.harness) && !hasCrossHarnessReason) {
          output.push({ ok: false, alias, tierIndex, position, reason: "cross_harness_reason_required" });
          continue;
        }
      } else if (provider.harness !== undefined) {
        output.push({ ok: false, alias, tierIndex, position, reason: "harness_required" });
        continue;
      }
      const availabilityIssue = providerAvailabilityIssue(provider, request);
      if (availabilityIssue) {
        output.push({ ok: false, alias, tierIndex, position, reason: availabilityIssue });
        continue;
      }
      const adapterResult = adapterFor(request, carrier);
      if (!adapterResult.ok) {
        output.push({ ok: false, alias, tierIndex, position, reason: adapterResult.reason });
        continue;
      }
      if ((request.harness === "codex" && provider.harness === "claude" && !["claude-cli-via-task", "claude-cli-via-worker"].includes(adapterResult.adapterId))
        || (request.harness === "claude" && provider.harness === "codex")) {
        output.push({ ok: false, alias, tierIndex, position, reason: "cross_harness_adapter_required" });
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
      if (model.carrierId === "codex-luna" && runtime && ["unavailable", "unselectable"].includes(runtime.lunaAvailability)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "runtime_attestation_required" });
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
      if (model.carrierId === "codex-daybreak-blue" && !daybreakAvailabilityScopeMatches(request, provider)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "daybreak_scope_unavailable" });
        continue;
      }
      if (model.carrierId === "codex-daybreak-blue" && !daybreakAvailable(state.daybreakAvailability, now)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "daybreak_unavailable" });
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
      const claudeIdentity = carrier.modelFamily === "claude" && model.carrierId === "claude-session" && (!observedModel || observedModel === "unknown")
        ? model.requestedModel
        : observedModel;
      if (carrier.modelFamily === "claude" && model.carrierId === "claude-ce-review" && parseClaudeFamily(claudeIdentity)?.family !== undefined && !["fable", "opus"].includes(parseClaudeFamily(claudeIdentity).family)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "ce_model_restricted" });
        continue;
      }
      if (carrier.modelFamily === "claude" && !claudeIdentitySatisfied(model, claudeIdentity)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "claude_identity_mismatch" });
        continue;
      }
      if (carrier.runtimeVerifiedOnly) {
        const terra = runtime?.terra;
        const runtimeVerified = runtime
          && ["unavailable", "unselectable"].includes(runtime.lunaAvailability)
          && terra?.verified === true
          && terra.model === model.requestedModel
          && terra.effort === effort
          && (!capability?.observedModel || capability.observedModel === "unknown" || capability.observedModel === terra.model);
        if (!capability || !runtimeVerified) {
          output.push({ ok: false, alias, tierIndex, position, reason: "runtime_attestation_required" });
          continue;
        }
      }
      if (carrier.modelFamily !== "claude" && !minimumGenerationSatisfied(model, observedModel || model.requestedModel)) {
        output.push({ ok: false, alias, tierIndex, position, reason: "minimum_generation_unmet" });
        continue;
      }
      const transport = transportDecision(request, adapterResult.adapter, trustedTransportAttestor, provider, capability);
      if (!transport.ok) {
        output.push({ ok: false, alias, tierIndex, position, reason: transport.reason });
        continue;
      }
      const implementationRole = request.role === "implementation" || request.role?.startsWith("implementation.");
      const substitute = implementationRole
        && model.carrierId === "codex-terra-runtime"
        && runtime
        && ["unavailable", "unselectable"].includes(runtime.lunaAvailability)
        ? "implementation_model_substitute"
        : null;
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
        runtime,
        substitute,
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

export function candidateSort(left, right) {
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

export function fixedRuntimeDecision(trustedRuntimeAttestor, request = {}, provider = {}) {
  const hostScope = effectiveHostScope(request);
  const accountScope = effectiveAccountScope(request, provider);
  // Luna's default identity is a fixed router-owned runtime fact.  The caller
  // cannot supply a runtime object; Terra is accepted only from the separate
  // fixed host-attestor path below.
  if (typeof trustedRuntimeAttestor !== "function") return {
    lunaAvailability: "available",
    hostScope,
    accountScope,
    provenance: "fixed_runtime_attestor",
    attestorId: RUNTIME_ATTESTOR,
    attestationDigest: stableDigest({ runtime: "codex", hostScope, accountScope, lunaAvailability: "available", model: CARRIER_DESCRIPTORS["codex-luna"].requestedModel }),
  };
  let attestation;
  try { attestation = trustedRuntimeAttestor(Object.freeze({ contractVersion: CONTRACT_VERSION, runtime: "codex", hostScope, accountScope })); }
  catch { return null; }
  if (!isObject(attestation) || !onlyFields(attestation, new Set(["attestorId", "attestationDigest", "lunaAvailability", "terra", "hostScope", "accountScope"])) || attestation.attestorId !== RUNTIME_ATTESTOR || !validDigest(attestation.attestationDigest) || attestation.hostScope !== hostScope || attestation.accountScope !== accountScope || !["available", "unavailable", "unselectable"].includes(attestation.lunaAvailability)) return null;
  // Terra ships the same effort range as Sol and Luna (low..ultra).  Pinning
  // this to "max" rejected every legitimate attestation at any other effort,
  // so a Terra route could only ever be admitted at max - which is not how the
  // carrier is declared.  Gate on the carrier's own effort list instead.
  if (attestation.terra !== undefined && (!onlyFields(attestation.terra, new Set(["verified", "model", "effort"])) || attestation.terra.verified !== true || !validModel(attestation.terra.model) || !CARRIER_DESCRIPTORS["codex-terra-runtime"].efforts.includes(attestation.terra.effort))) return null;
  return { ...attestation, provenance: "measured_fact" };
}

export function defaultRoute(request, { trustedRuntimeAttestor, trustedTransportAttestor } = {}) {
  const implementation = request.role === "implementation" || request.role?.startsWith("implementation.");
  const complex = request.risk === "high" || request.risk === "critical" || request.complex === true;
  let carrierId = implementation ? "codex-luna" : "codex-sol";
  let effort = implementation ? "max" : complex ? "max" : "high";
  let substitute = null;
  const runtime = fixedRuntimeDecision(trustedRuntimeAttestor, request, { account: "codex-sub" });
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
  const provider = { executionSurface: "codex", carrierId, account: "codex-sub" };
  const transport = transportDecision(request, adapterResult.adapter, trustedTransportAttestor, provider);
  if (!transport.ok) return { ok: false, reason: transport.reason };
  const model = carrierId === "codex-terra-runtime" ? runtime.terra.model : carrier.requestedModel;
  return {
    ok: true,
    alias: carrierId,
    model: { carrierId, requestedModel: model, relativeCostIndex: undefined },
    provider,
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
