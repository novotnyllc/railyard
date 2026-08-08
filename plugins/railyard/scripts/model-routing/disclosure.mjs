/** R28 route-disclosure assembly. */

import {
  clone,
  isObject,
  ownEntries,
  validMeter,
  validMeterMap,
} from "./bounds.mjs";

export function disclosureFacet(value, provenance = "unknown") {
  return {
    value: value === undefined || value === null ? "unknown" : clone(value),
    provenance,
  };
}

export function notApplicableFacet() {
  return disclosureFacet("not_applicable", "not_applicable");
}

export function meterDisclosure(value, provenance) {
  if (value === undefined || value === null) return disclosureFacet("unknown", "unknown");
  if (value === "not_applicable") return notApplicableFacet();
  return disclosureFacet(value, provenance);
}

export function normalizedChargedMeters(value) {
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
export function r28RouteDisclosure(candidate, request, {
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
  // `requested` is what the caller asked for and `configured` is the catalog's
  // answer.  They are separate facets precisely so a divergence — an effort the
  // caller never named, a provider the request did not allow — is visible; a
  // caller cannot name a model, surface, or endpoint at all, so those read
  // "not_requested" rather than echoing the catalog back as if it were asked.
  const allowedProviders = request?.privacy?.allowedProviders;
  const requestedProvider = Array.isArray(allowedProviders) && allowedProviders.length === 1 ? allowedProviders[0] : null;
  const requested = notApplicable
    ? Object.fromEntries(["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"].map((field) => [field, notApplicableFacet()]))
    : {
      provider: disclosureFacet(requestedProvider || "not_requested", "request"),
      endpointClass: disclosureFacet("not_requested", "request"),
      executionSurface: disclosureFacet("not_requested", "request"),
      billingSurface: disclosureFacet("not_requested", "request"),
      model: disclosureFacet("not_requested", "request"),
      effort: disclosureFacet(request?.effort || "not_requested", "request"),
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
    schema: "railyard/r28-route-disclosure/v1",
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

export function settlementDisclosure(reservation, receipt) {
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
