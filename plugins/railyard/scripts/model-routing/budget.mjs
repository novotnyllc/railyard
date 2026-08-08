/** Meter forecasting, scope accounting, and budget admission. */

import {
  formatMeterAmount,
  isObject,
  nowIso,
  ownEntries,
  parseMeterAmount,
  scopeAccountingId,
  validScope,
  validScopes,
} from "./bounds.mjs";

export function normalizeForecast(forecast = {}) {
  if (!isObject(forecast)) return { ok: false, reason: "invalid_forecast" };
  const normalized = {};
  for (const [meter, amount] of ownEntries(forecast)) {
    const parsed = parseMeterAmount(meter, amount);
    if (!parsed.ok) return { ok: false, reason: "invalid_forecast" };
    normalized[meter] = amount;
  }
  return { ok: true, value: normalized };
}

export function budgetRules(catalog, scopeKind) {
  return catalog?.budgets?.[scopeKind] || {};
}

export function spentFor(state, scope, meter) {
  const amount = state.spendAggregates?.[scopeAccountingId(scope)]?.[meter]?.hardAccounted || "0";
  return parseMeterAmount(meter, amount).units;
}

export function reservedFor(state, scope, meter) {
  let total = 0n;
  for (const reservation of Object.values(state.reservations || {})) {
    if (!(reservation.scopes || [reservation.scope]).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id) || ["settled", "no_start"].includes(reservation.phase)) continue;
    const lease = reservation.leaseId ? state.leases?.[reservation.leaseId] : null;
    if (lease && (lease.allocatorScopes || []).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id)) continue;
    const value = reservation.forecast?.[meter];
    if (value !== undefined) total += parseMeterAmount(meter, value).units;
  }
  return total;
}

export function leasedFor(state, scope, meter) {
  let total = 0n;
  for (const lease of Object.values(state.leases || {})) {
    if (!(lease.allocatorScopes || []).some((candidate) => candidate.kind === scope.kind && candidate.id === scope.id)) continue;
    const remaining = lease.remainingCeiling?.[meter];
    if (lease.released !== true && remaining !== undefined) total += parseMeterAmount(meter, remaining).units;
    for (const allocation of Object.values(lease.allocations || {})) {
      const amount = allocation.forecast?.[meter];
      if (amount !== undefined) total += parseMeterAmount(meter, amount).units;
    }
  }
  return total;
}

/**
 * `strict` is reserved, not live: no carrier declares `enforcedMeters`, because
 * none of them can actually attest per-meter enforcement. Every strict meter
 * therefore refuses with `strict_limit_unenforceable`, which is the correct
 * fail-closed answer — a strict limit nobody enforces must not admit work.
 * Wire `enforcedMeters` onto a carrier only when it can genuinely attest.
 */
export function carrierEnforces(candidate, meter) {
  return Array.isArray(candidate.carrier.enforcedMeters) && candidate.carrier.enforcedMeters.includes(meter);
}

export function budgetAdmission(catalog, state, scope, forecast, candidate) {
  const rules = budgetRules(catalog, scope.kind);
  const warnings = [];
  for (const [meter, rule] of ownEntries(rules)) {
    if ((rule.hardAdmission !== undefined || rule.strict !== undefined) && !Object.hasOwn(forecast, meter)) return { ok: false, reason: "forecast_required", meter };
  }
  for (const [meter, raw] of ownEntries(forecast)) {
    const amount = parseMeterAmount(meter, raw).units;
    const rule = rules[meter] || {};
    for (const [key, reason] of [["hardAdmission", "hard_budget_exceeded"], ["strict", "strict_budget_exceeded"]]) {
      if (rule[key] === undefined) continue;
      const limit = parseMeterAmount(meter, rule[key]);
      if (!limit.ok) return { ok: false, reason: "invalid_budget_limit" };
      if (key === "strict" && !carrierEnforces(candidate, meter)) return { ok: false, reason: "strict_limit_unenforceable", meter };
      if (spentFor(state, scope, meter) + reservedFor(state, scope, meter) + leasedFor(state, scope, meter) + amount > limit.units) return { ok: false, reason, meter };
    }
    if (rule.soft !== undefined) {
      const limit = parseMeterAmount(meter, rule.soft);
      if (!limit.ok) return { ok: false, reason: "invalid_budget_limit" };
      if (spentFor(state, scope, meter) + reservedFor(state, scope, meter) + leasedFor(state, scope, meter) + amount > limit.units) warnings.push({ meter, reason: "soft_budget_exceeded" });
    }
  }
  return { ok: true, warnings };
}

export function budgetAdmissionAll(catalog, state, scopes, forecast, candidate) {
  const warnings = [];
  for (const scope of scopes) {
    if (state.budgetEpochs[scopeAccountingId(scope)]?.frozen) return { ok: false, reason: "budget_scope_frozen", scope };
    const admitted = budgetAdmission(catalog, state, scope, forecast, candidate);
    if (!admitted.ok) return { ...admitted, scope };
    warnings.push(...admitted.warnings.map((warning) => ({ ...warning, scope: scope.kind, scopeId: scope.id })));
  }
  return { ok: true, warnings };
}

export function scopeFor(request) {
  if (request.scopes !== undefined) {
    const scopes = ownEntries(request.scopes).map(([kind, id]) => ({ kind, id }));
    return validScopes(scopes) ? scopes : null;
  }
  if (request.scope !== undefined) return validScope(request.scope) ? [request.scope] : null;
  return null;
}

export function normalUsage(raw = {}) {
  const normalized = normalizeForecast(raw);
  return normalized.ok ? normalized : { ok: false, reason: "invalid_measured_usage" };
}

export function addSpent(state, scope, meter, amount, provenance, now) {
  const scopeId = scopeAccountingId(scope);
  const current = spentFor(state, scope, meter);
  state.spendAggregates[scopeId] ||= {};
  state.spendAggregates[scopeId][meter] = {
    hardAccounted: formatMeterAmount(meter, current + amount),
    provenance,
    at: nowIso(now),
  };
}
