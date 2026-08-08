/** Optional observational learning: outcomes, aggregates, and hints. */

import {
  clone,
  formatMeterAmount,
  normalizedWorkClassShape,
  nowIso,
  opaqueId,
  ownEntries,
  parseMeterAmount,
  stableDigest,
  validId,
} from "./bounds.mjs";
import {
  budgetRules,
  scopeFor,
} from "./budget.mjs";
import {
  CARRIER_DESCRIPTORS,
  LEARNING_SAMPLE_FLOOR,
  MAX_AGGREGATES,
  MAX_LEARNING_SAMPLE_INFLUENCE,
  MAX_OUTCOMES,
} from "./registries.mjs";

export function learningBaseBucket({ role, risk, contextClass, workShape }) {
  return stableDigest({
    role,
    risk: risk || "unknown",
    contextClass: contextClass || "unknown",
    workShape: normalizedWorkClassShape(workShape),
  });
}

export function learningRouteEffectBucket(baseBucket, selected) {
  return stableDigest({
    baseBucket,
    resolvedModel: selected.model || "unknown",
    carrierId: selected.carrierId,
    carrierVersion: selected.carrierVersion || CARRIER_DESCRIPTORS[selected.carrierId]?.version || "unknown",
    effort: selected.effort,
    billingSurface: selected.executionSurface || "unknown",
  });
}

export function boundedInfluence(value) {
  return Math.max(-MAX_LEARNING_SAMPLE_INFLUENCE, Math.min(MAX_LEARNING_SAMPLE_INFLUENCE, value));
}

export function addLearningMeters(target, source) {
  for (const [meter, amount] of ownEntries(source || {})) {
    const parsed = parseMeterAmount(meter, amount);
    if (!parsed.ok) continue;
    const current = parseMeterAmount(meter, target[meter] || "0");
    target[meter] = formatMeterAmount(meter, current.units + parsed.units);
  }
}

export function updateLearningAggregate(aggregate, receipt, forecast) {
  aggregate.count += 1;
  aggregate.totalDurationMs += receipt.durationMs || 0;
  aggregate.totalRetries += receipt.retryCount || 0;
  if (receipt.status !== "settled" || receipt.verification === "failed") aggregate.failures += 1;
  if (receipt.verification === "passed") aggregate.verified += 1;
  aggregate.ratingTotal += receipt.rating || 0;
  if (aggregate.usageTotals) addLearningMeters(aggregate.usageTotals, receipt.measuredUsage || {});
  if (aggregate.forecastTotals) addLearningMeters(aggregate.forecastTotals, forecast || {});
}

export function refreshLearningInfluence(aggregate) {
  if (aggregate.count < LEARNING_SAMPLE_FLOOR) return;
  if (aggregate.forecastInfluenceByMeter) {
    for (const meter of Object.keys(aggregate.forecastTotals)) {
      const forecast = parseMeterAmount(meter, aggregate.forecastTotals[meter]);
      const usage = parseMeterAmount(meter, aggregate.usageTotals[meter] || "0");
      if (!forecast.ok || !usage.ok || forecast.units === 0n) continue;
      const basisPoints = Number((usage.units * 10_000n) / forecast.units) / 10_000;
      aggregate.forecastInfluenceByMeter[meter] = boundedInfluence(basisPoints - 1);
    }
  }
  if (Object.hasOwn(aggregate, "tieBreakInfluence")) {
    const ratingDelta = aggregate.ratingTotal === 0 ? 0 : (aggregate.ratingTotal / aggregate.count - 3) / 10;
    const verificationSignal = aggregate.verified / aggregate.count / 10;
    const failurePenalty = aggregate.failures / aggregate.count / 5;
    aggregate.tieBreakInfluence = boundedInfluence(ratingDelta + verificationSignal - failurePenalty);
  }
}

export function boundedLearningAggregate(state, id, factory) {
  if (!state.learningAggregates[id] && Object.keys(state.learningAggregates).length >= MAX_AGGREGATES) {
    const evictable = Object.entries(state.learningAggregates).sort(([, left], [, right]) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")))[0]?.[0];
    if (evictable) delete state.learningAggregates[evictable];
  }
  return state.learningAggregates[id] ||= factory();
}

export function updateLearning(state, reservation, receipt, now, catalog = null) {
  if (catalog?.learning?.enabled === false || state.learningControl.disabled === true || reservation.learningAllowed === false || receipt.status !== "settled" || !receipt.outcomeId || !validId(receipt.outcomeId)) return;
  if (state.learningOutcomes[receipt.outcomeId]) return;
  const outcomes = Object.keys(state.learningOutcomes);
  if (outcomes.length >= MAX_OUTCOMES) {
    outcomes.sort((left, right) => state.learningOutcomes[left].at.localeCompare(state.learningOutcomes[right].at));
    delete state.learningOutcomes[outcomes[0]];
  }
  const role = reservation.decision.role;
  const workShape = normalizedWorkClassShape(reservation.workShape || {});
  const risk = reservation.risk || "unknown";
  const contextClass = reservation.contextClass || "unknown";
  const baseBucket = learningBaseBucket({ role, risk, contextClass, workShape });
  // A no-config default-terminal receipt intentionally records only demand.
  // It no longer fabricates a Luna route effect for a terminal result whose
  // actual selected runtime route was not retained in state.
  const routeLearningEligible = reservation.routeLearningEligible !== false;
  const resolvedModelBucket = routeLearningEligible
    ? stableDigest({ carrierId: reservation.selected.carrierId, model: reservation.selected.model })
    : null;
  const routeEffectBucket = routeLearningEligible
    ? learningRouteEffectBucket(baseBucket, reservation.selected)
    : null;
  const baseId = opaqueId("learning", { kind: "baseDemand", baseBucket });
  const routeId = routeLearningEligible
    ? opaqueId("learning", { kind: "routeEffect", routeEffectBucket })
    : null;
  const outcome = {
    at: nowIso(now),
    role,
    risk,
    contextClass,
    workShape,
    baseBucket,
    result: receipt.status,
    usage: clone(receipt.measuredUsage || {}),
    measuredBilled: receipt.measuredBilled === true,
  };
  if (routeLearningEligible) Object.assign(outcome, {
    routeEffectBucket,
    carrierId: reservation.selected.carrierId,
    carrierVersion: reservation.selected.carrierVersion,
    effort: reservation.selected.effort,
    billingSurface: reservation.selected.executionSurface,
    resolvedModelBucket,
  });
  for (const key of ["durationMs", "retryCount", "verification", "rating"]) if (receipt[key] !== undefined) outcome[key] = receipt[key];
  state.learningOutcomes[receipt.outcomeId] = outcome;
  const base = boundedLearningAggregate(state, baseId, () => ({
    kind: "baseDemand", baseBucket, role, risk, contextClass, workShape,
    count: 0, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 0, ratingTotal: 0,
    usageTotals: {}, forecastTotals: {}, forecastInfluenceByMeter: {}, updatedAt: nowIso(now),
  }));
  const route = routeLearningEligible
    ? boundedLearningAggregate(state, routeId, () => ({
      kind: "routeEffect", baseBucket, routeEffectBucket, role, risk, contextClass, workShape,
      carrierId: reservation.selected.carrierId, carrierVersion: reservation.selected.carrierVersion,
      effort: reservation.selected.effort, billingSurface: reservation.selected.executionSurface,
      resolvedModelBucket, count: 0, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 0,
      ratingTotal: 0, tieBreakInfluence: 0, updatedAt: nowIso(now),
    }))
    : null;
  updateLearningAggregate(base, receipt, reservation.forecast);
  if (route) updateLearningAggregate(route, receipt, reservation.forecast);
  refreshLearningInfluence(base);
  if (route) refreshLearningInfluence(route);
  base.updatedAt = nowIso(now);
  if (route) route.updatedAt = nowIso(now);
}

export function learningHintForCandidate(state, request, candidate) {
  const role = request.role;
  const workShape = normalizedWorkClassShape(request.workShape || {});
  const risk = request.risk || "unknown";
  const contextClass = request.contextClass || "unknown";
  const baseBucket = learningBaseBucket({ role, risk, contextClass, workShape });
  const routeEffectBucket = learningRouteEffectBucket(baseBucket, {
    model: candidate.observedModel === "unknown" ? candidate.model.requestedModel : candidate.observedModel,
    carrierId: candidate.model.carrierId,
    carrierVersion: candidate.carrier.version,
    effort: candidate.effort,
    executionSurface: candidate.provider.executionSurface,
  });
  const baseDemand = Object.values(state.learningAggregates).find((item) => item.kind === "baseDemand" && item.baseBucket === baseBucket && item.count >= LEARNING_SAMPLE_FLOOR) || null;
  const routeEffect = Object.values(state.learningAggregates).find((item) => item.kind === "routeEffect" && item.routeEffectBucket === routeEffectBucket && item.count >= LEARNING_SAMPLE_FLOOR) || null;
  if (!baseDemand && !routeEffect) return null;
  return {
    baseBucket,
    routeEffectBucket,
    sampleFloor: LEARNING_SAMPLE_FLOOR,
    baseDemand: baseDemand ? { sampleCount: baseDemand.count, forecastInfluenceByMeter: clone(baseDemand.forecastInfluenceByMeter) } : "unknown",
    routeEffect: routeEffect ? { sampleCount: routeEffect.count, tieBreakInfluence: routeEffect.tieBreakInfluence } : "unknown",
    provenance: "learned_estimate",
    policyOrdering: "unchanged",
  };
}

export function learnedForecastForCandidate(state, request, candidate, forecast, catalog) {
  const hint = candidate.learning || learningHintForCandidate(state, request, candidate);
  if (!hint || hint.baseDemand === "unknown") return { forecast, learning: hint, adjusted: false };
  const updated = clone(forecast);
  let adjusted = false;
  for (const [meter, original] of ownEntries(forecast)) {
    const influence = hint.baseDemand.forecastInfluenceByMeter?.[meter];
    if (!Number.isFinite(influence)) continue;
    const parsed = parseMeterAmount(meter, original);
    if (!parsed.ok) continue;
    // Keep accounting in integer space.  Converting a meter value through a
    // Number would silently lose precision for a large but valid budget.
    const scale = BigInt(Math.max(0, Math.round((1 + boundedInfluence(influence)) * 1_000_000)));
    let units = (parsed.units * scale + 999_999n) / 1_000_000n;
    const hardMeter = scopeFor(request)?.some((scope) => {
      const rule = budgetRules(catalog, scope.kind)[meter] || {};
      return rule.hardAdmission !== undefined || rule.strict !== undefined;
    });
    // A learned optimistic estimate may not enlarge hard/strict headroom.
    if (hardMeter && units < parsed.units) units = parsed.units;
    const next = formatMeterAmount(meter, units);
    if (next !== original) adjusted = true;
    updated[meter] = next;
  }
  return { forecast: updated, learning: hint, adjusted };
}
