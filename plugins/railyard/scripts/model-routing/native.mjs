/**
 * Verified agents.spawn_agent override surface, 2026-09-14. This is an
 * adapter snapshot, not a provider catalog or proof of a dispatched model.
 * A model appearing in models_cache.json or a proxy catalog does not extend
 * this list. Re-check the exposed tool contract before updating it.
 */
export const NATIVE_MODEL_EFFORTS = Object.freeze({
  "gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-daybreak-blue-latest": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-terra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-5.6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "combo/grok-unified-4.6": Object.freeze(["low", "medium", "high", "xhigh"]),
});

export function validateNativeModelEffort(model, effort) {
  if (typeof model !== "string" || !Object.hasOwn(NATIVE_MODEL_EFFORTS, model)) {
    return { ok: false, reason: "native_model_unsupported" };
  }
  if (!NATIVE_MODEL_EFFORTS[model].includes(effort)) {
    return { ok: false, reason: "effort_unsupported", supportedEfforts: [...NATIVE_MODEL_EFFORTS[model]] };
  }
  return { ok: true, reason: "supported", model, effort };
}
