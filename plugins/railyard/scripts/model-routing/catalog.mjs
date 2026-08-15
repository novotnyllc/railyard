/** Catalog validation and the invariant work contract / presentation overlays. */

import {
  boundedIssue,
  clone,
  error,
  isKnownCarrier,
  isObject,
  onlyFields,
  ownEntries,
  parseClaudeFamily,
  parseMeterAmount,
  result,
  stableDigest,
  validClaudeFamily,
  validDate,
  validDigest,
  validEffort,
  validId,
  validMeter,
  validModel,
  validOpaque,
  validRole,
  validSourceUrl,
} from "./bounds.mjs";
import {
  CARRIER_DESCRIPTORS,
  CATALOG_SCHEMA_VERSION,
  DEFAULT_POLICY,
  EXECUTION_SURFACES,
  HARNESS_KINDS,
  INVARIANT_WORK_CONTRACT_SCHEMA,
  LOCALITY_RANK,
  PRESENTATION_OVERLAYS,
  RETENTION_RANK,
  SHAPE_FIELDS,
  SHAPE_VALUES,
  SOFT_PRIORITIES,
} from "./registries.mjs";

/**
 * A rate's citation lives under `sourceUrl`, which `validateRate` accepts and a
 * bare `url` is not; no key named `url` is legal anywhere in a catalog.
 */
export function rejectSecretKeys(value) {
  if (Array.isArray(value)) return value.map((item) => rejectSecretKeys(item)).find(Boolean) || null;
  if (!isObject(value)) return null;
  for (const [key, nested] of ownEntries(value)) {
    const lower = key.toLowerCase();
    if (/token|cookie|password|secret|credential|auth[_-]?key|private[_-]?key/.test(lower)) return `forbidden_catalog_key:${key}`;
    if (["command", "commands", "flag", "flags", "executable", "executablepath", "profile", "profilepath", "endpoint", "endpointurl", "prompt", "source", "host", "hostname", "url"].includes(lower)) return `forbidden_catalog_key:${key}`;
    const issue = rejectSecretKeys(nested);
    if (issue) return issue;
  }
  return null;
}

export function validWorkContractInput(value) {
  const fields = new Set(["objectiveDigest", "sourceOfTruthDigest", "scopeDigest", "constraintsDigest", "authorizationDigest", "acceptanceDigest", "stopDigest", "carrierId", "model", "effort", "expectedInvariantDigest"]);
  return isObject(value)
    && onlyFields(value, fields)
    && ["objectiveDigest", "sourceOfTruthDigest", "scopeDigest", "constraintsDigest", "authorizationDigest", "acceptanceDigest", "stopDigest"].every((field) => validDigest(value[field]))
    && isKnownCarrier(value.carrierId)
    && validModel(value.model)
    && validEffort(value.effort)
    && (value.expectedInvariantDigest === undefined || validDigest(value.expectedInvariantDigest));
}

export function presentationOverlayFor({ carrierId, model, effort }) {
  const carrier = CARRIER_DESCRIPTORS[carrierId];
  if (!carrier || !carrier.efforts.includes(effort)) return null;
  let family;
  if (["codex-luna", "codex-sol", "codex-terra-runtime", "codex-daybreak-blue"].includes(carrierId)) {
    if (carrier.requestedModel && model !== carrier.requestedModel) return null;
    family = "gpt_sol";
  } else if (CARRIER_DESCRIPTORS[carrierId]?.modelFamily === "claude") {
    const parsed = parseClaudeFamily(model);
    if (!parsed) return null;
    family = parsed.family;
  } else if (["glm-5-2-scout", "glm-5-2-engineer"].includes(carrierId)) {
    if (model !== "glm-5.2") return null;
    family = "glm";
  } else if (carrierId === "oracle-browser") {
    if (model !== "chatgpt_current_pro") return null;
    family = "oracle";
  } else {
    return null;
  }
  const base = PRESENTATION_OVERLAYS[family];
  return base ? {
    schema: "railyard/presentation-overlay/v1",
    family: base.id,
    format: base.format,
    carrierId,
    carrierVersion: carrier.version,
    model,
    effort,
    instructions: [...base.instructions],
  } : null;
}

/**
 * Build the carrier-neutral contract and one source-owned presentation layer.
 * Every semantic input is a caller-supplied digest; this function neither
 * accepts caller prompt text nor calls a provider. Direct user and repository
 * instructions remain authoritative over the selected presentation overlay.
 */
export function buildInvariantWorkContract(input) {
  if (!validWorkContractInput(input)) return error("invalid_work_contract");
  const invariant = {
    schema: INVARIANT_WORK_CONTRACT_SCHEMA,
    objectiveDigest: input.objectiveDigest,
    sourceOfTruthDigest: input.sourceOfTruthDigest,
    scopeDigest: input.scopeDigest,
    constraintsDigest: input.constraintsDigest,
    authorizationDigest: input.authorizationDigest,
    acceptanceDigest: input.acceptanceDigest,
    stopDigest: input.stopDigest,
  };
  const invariantDigest = stableDigest(invariant);
  if (input.expectedInvariantDigest !== undefined && input.expectedInvariantDigest !== invariantDigest) return error("invariant_contract_mutation");
  const presentation = presentationOverlayFor(input);
  if (!presentation) return error("presentation_overlay_mismatch");
  return result(true, "work_contract_built", {
    contract: {
      invariant,
      invariantDigest,
      presentation,
      presentationDigest: stableDigest(presentation),
    },
  });
}

export function validateRate(rate) {
  const fields = new Set(["meter", "amount", "asOf", "sourceUrl", "checkedAt", "effectiveAt", "promotionExpiresAt", "staleAfterSeconds", "carrierId", "carrierVersion", "effort", "billingSurface", "resolvedModelDigest"]);
  if (!onlyFields(rate, fields) || !validMeter(rate.meter) || !parseMeterAmount(rate.meter, rate.amount).ok) return "invalid_rate";
  if (!validDate(rate.asOf) || !validSourceUrl(rate.sourceUrl) || !validDate(rate.checkedAt) || !validDate(rate.effectiveAt)) return "invalid_rate";
  if (rate.promotionExpiresAt !== undefined && !validDate(rate.promotionExpiresAt)) return "invalid_rate";
  if (rate.staleAfterSeconds !== undefined && (!Number.isInteger(rate.staleAfterSeconds) || rate.staleAfterSeconds < 1 || rate.staleAfterSeconds > 31_536_000)) return "invalid_rate";
  if (!isKnownCarrier(rate.carrierId) || !validId(rate.carrierVersion) || !validEffort(rate.effort) || !EXECUTION_SURFACES.has(rate.billingSurface) || !validDigest(rate.resolvedModelDigest)) return "invalid_rate";
  return null;
}

export function validatePrivacy(privacy, providers) {
  if (!onlyFields(privacy, new Set(["egress", "allowedProviders", "locality", "retention"]))) return false;
  if (privacy.egress !== undefined && typeof privacy.egress !== "boolean") return false;
  if (privacy.locality !== undefined && !Object.hasOwn(LOCALITY_RANK, privacy.locality)) return false;
  if (privacy.retention !== undefined && !Object.hasOwn(RETENTION_RANK, privacy.retention)) return false;
  return privacy.allowedProviders === undefined || (Array.isArray(privacy.allowedProviders) && privacy.allowedProviders.every((provider) => validId(provider) && Object.hasOwn(providers, provider)));
}

export function validateBudgetRules(budgets) {
  if (!onlyFields(budgets, new Set(["task", "run", "project"]))) return false;
  for (const [scope, meterRules] of ownEntries(budgets)) {
    if (!["task", "run", "project"].includes(scope) || !isObject(meterRules)) return false;
    for (const [meter, limits] of ownEntries(meterRules)) {
      if (!validMeter(meter) || !onlyFields(limits, new Set(["soft", "hardAdmission", "strict"]))) return false;
      for (const amount of Object.values(limits)) if (!parseMeterAmount(meter, amount).ok) return false;
    }
  }
  return true;
}

export function validSoftPriorities(value) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((item) => SOFT_PRIORITIES.has(item));
}

export function validateDiscovery(discovery) {
  if (!onlyFields(discovery, new Set(["positiveTtlSeconds", "negativeTtlSeconds", "negativeTtls", "retryAfterMaxSeconds", "manualRefresh"]))) return false;
  for (const [key, value] of ownEntries(discovery)) {
    if (key === "manualRefresh") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (key === "negativeTtls") {
      if (!isObject(value) || !onlyFields(value, new Set(["transientSeconds", "authSeconds", "missingBinarySeconds", "unsupportedSeconds"]))) return false;
      if (Object.values(value).some((seconds) => !Number.isInteger(seconds) || seconds < 1 || seconds > 86_400)) return false;
      continue;
    }
    if (!Number.isInteger(value) || value < 1 || value > 86_400) return false;
  }
  return true;
}

export function validateCatalog(catalog) {
  if (catalog === null || catalog === undefined) return result(true, "config_default", { policy: clone(DEFAULT_POLICY) });
  const bounded = boundedIssue(catalog);
  if (bounded) return error(bounded, { source: "config" });
  if (!isObject(catalog) || catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) return error("unsupported_catalog_schema", { migration: "Use schemaVersion 1 or remove the catalog for built-in defaults." });
  const forbidden = rejectSecretKeys(catalog);
  if (forbidden) return error("unsafe_catalog", { detail: forbidden });
  if (!onlyFields(catalog, new Set(["schemaVersion", "providers", "models", "roles", "privacy", "budgets", "discovery", "learning"]))) return error("unknown_catalog_field");
  for (const field of ["providers", "models", "roles"]) if (!isObject(catalog[field])) return error("invalid_catalog", { field });

  for (const [alias, provider] of ownEntries(catalog.providers)) {
    if (!validId(alias) || !onlyFields(provider, new Set(["carrierId", "executionSurface", "account", "locality", "retention", "capabilities", "harness", "availability"])) || !validId(provider.carrierId) || !EXECUTION_SURFACES.has(provider.executionSurface) || !validOpaque(provider.account)) return error("invalid_provider", { alias });
    if (provider.harness !== undefined && !HARNESS_KINDS.has(provider.harness)) return error("invalid_provider", { alias });
    if (provider.availability !== undefined && (!isObject(provider.availability) || !onlyFields(provider.availability, new Set(["kind", "section"])) || provider.availability.kind !== "codex_config" || typeof provider.availability.section !== "string" || !/^model_providers\.[a-z0-9_-]+$/.test(provider.availability.section))) return error("invalid_provider", { alias });
    if (provider.locality !== undefined && !Object.hasOwn(LOCALITY_RANK, provider.locality)) return error("invalid_provider", { alias });
    if (provider.retention !== undefined && !Object.hasOwn(RETENTION_RANK, provider.retention)) return error("invalid_provider", { alias });
    if (provider.capabilities !== undefined && (!Array.isArray(provider.capabilities) || provider.capabilities.some((item) => !validId(item)))) return error("invalid_provider", { alias });
  }
  for (const [alias, model] of ownEntries(catalog.models)) {
    const fields = new Set(["provider", "carrierId", "requestedModel", "identityMode", "minimumGeneration", "effort", "efforts", "roles", "relativeCostIndex", "workShape", "rates", "latency", "quality", "reliability", "contextWindow", "requiredCapabilities", "billingSurface", "fallbackSet"]);
    if (!validId(alias) || !onlyFields(model, fields) || !validId(model.provider) || !Object.hasOwn(catalog.providers, model.provider) || !validId(model.carrierId) || !validModel(model.requestedModel)) return error("invalid_model", { alias });
    if (model.identityMode !== undefined && !["provider_latest_family", "exact_pin"].includes(model.identityMode)) return error("invalid_model", { alias });
    if (model.minimumGeneration !== undefined && !/^\d+(?:\.\d+){0,3}$/.test(model.minimumGeneration)) return error("invalid_model", { alias });
    if (model.effort !== undefined && !validEffort(model.effort)) return error("invalid_model", { alias });
    if (model.efforts !== undefined && (!Array.isArray(model.efforts) || model.efforts.length === 0 || model.efforts.some((effort) => !validEffort(effort)))) return error("invalid_model", { alias });
    if (model.relativeCostIndex !== undefined && (!Number.isInteger(model.relativeCostIndex) || model.relativeCostIndex < 1 || model.relativeCostIndex > 1_000_000)) return error("invalid_model", { alias });
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow < 1 || model.contextWindow > 10_000_000)) return error("invalid_model", { alias });
    if (model.requiredCapabilities !== undefined && (!Array.isArray(model.requiredCapabilities) || model.requiredCapabilities.some((item) => !validId(item)))) return error("invalid_model", { alias });
    if (model.billingSurface !== undefined && !EXECUTION_SURFACES.has(model.billingSurface)) return error("invalid_model", { alias });
    if (model.fallbackSet !== undefined && (!Array.isArray(model.fallbackSet) || model.fallbackSet.some((item) => !validId(item) || !Object.hasOwn(catalog.models, item)))) return error("invalid_model", { alias });
    if (model.roles !== undefined && (!Array.isArray(model.roles) || model.roles.some((role) => !validRole(role)))) return error("invalid_model", { alias });
    if (model.workShape !== undefined && (!onlyFields(model.workShape, new Set(SHAPE_FIELDS)) || Object.values(model.workShape).some((allowed) => !Array.isArray(allowed) || allowed.length === 0 || allowed.some((value) => !SHAPE_VALUES.has(value))))) return error("invalid_model", { alias });
    if (model.rates !== undefined && (!Array.isArray(model.rates) || model.rates.some(validateRate))) return error("invalid_model", { alias });
    for (const field of ["latency", "quality", "reliability"]) if (model[field] !== undefined && (!Number.isFinite(model[field]) || model[field] < 0)) return error("invalid_model", { alias });
    const carrier = CARRIER_DESCRIPTORS[model.carrierId];
    if (catalog.providers[model.provider].carrierId !== model.carrierId) return error("provider_carrier_mismatch", { alias });
    if (carrier?.requestedModel && carrier.requestedModel !== model.requestedModel) return error("fixed_carrier_mismatch", { alias });
    if (carrier?.modelFamily === "claude" && !validClaudeFamily(model.requestedModel)) return error("invalid_claude_family", { alias });
    if (model.rates !== undefined && model.rates.some((rate) => rate.carrierId !== model.carrierId || rate.carrierVersion !== carrier?.version || !carrier?.efforts.includes(rate.effort) || (model.efforts !== undefined && !model.efforts.includes(rate.effort)) || (model.effort !== undefined && rate.effort !== model.effort) || (model.billingSurface !== undefined && rate.billingSurface !== model.billingSurface) || (model.billingSurface === undefined && rate.billingSurface !== catalog.providers[model.provider].executionSurface) || (model.identityMode !== "provider_latest_family" && rate.resolvedModelDigest !== stableDigest(model.requestedModel)))) return error("rate_binding_mismatch", { alias });
  }
  // One local App Server exposes one authenticated Codex account. Keeping one
  // Daybreak provider per state document makes its two-field cache unambiguous.
  const daybreakProviders = new Set(Object.values(catalog.models)
    .filter((model) => model.carrierId === "codex-daybreak-blue")
    .map((model) => model.provider));
  if (daybreakProviders.size > 1) return error("daybreak_provider_ambiguous");
  for (const [role, rule] of ownEntries(catalog.roles)) {
    if (!validRole(role) || !onlyFields(rule, new Set(["tiers"])) || !Array.isArray(rule.tiers) || rule.tiers.length === 0) return error("invalid_role", { role });
    for (const [tierIndex, tier] of rule.tiers.entries()) {
      const aliases = Array.isArray(tier) ? tier : tier?.models;
      if (isObject(tier) && !onlyFields(tier, new Set(["models", "softPriorities"]))) return error("invalid_role", { role });
      if (!Array.isArray(aliases) || aliases.length === 0 || aliases.some((alias) => !validId(alias) || !Object.hasOwn(catalog.models, alias))) return error("invalid_role", { role });
      if (isObject(tier) && tier.softPriorities !== undefined && (!validSoftPriorities(tier.softPriorities) || tierIndex !== 0)) return error("invalid_role", { role });
    }
  }
  if (catalog.privacy !== undefined && !validatePrivacy(catalog.privacy, catalog.providers)) return error("invalid_privacy");
  if (catalog.budgets !== undefined && !validateBudgetRules(catalog.budgets)) return error("invalid_budgets");
  if (catalog.discovery !== undefined && !validateDiscovery(catalog.discovery)) return error("invalid_discovery");
  if (catalog.learning !== undefined && (!onlyFields(catalog.learning, new Set(["enabled"])) || typeof catalog.learning.enabled !== "boolean")) return error("invalid_learning");
  return result(true, "catalog_valid", { policy: { source: "config", digest: stableDigest(catalog), provenance: "user_configuration" } });
}
