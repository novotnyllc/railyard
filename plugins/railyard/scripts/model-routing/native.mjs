/**
 * Verified Codex adapter override surfaces. A model appearing in a cache or
 * provider catalog does not extend either surface. The native subagent tool
 * and the Codex task tools expose different model selectors, so keeping their
 * rosters separate prevents a task-only selector from slipping into spawn.
 */
export const NATIVE_SUBAGENT_MODEL_EFFORTS = Object.freeze({
  "gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-daybreak-blue-latest": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
});

export const CODEX_TASK_MODEL_EFFORTS = Object.freeze({
  "gpt-6-astra": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-6-sol": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
  "gpt-6-luna": Object.freeze(["low", "medium", "high", "xhigh", "max"]),
  "gpt-daybreak-blue-latest": Object.freeze(["low", "medium", "high", "xhigh", "max", "ultra"]),
});

export function validateNativeModelEffort(model, effort) {
  if (typeof model !== "string" || !Object.hasOwn(NATIVE_SUBAGENT_MODEL_EFFORTS, model)) {
    return { ok: false, reason: "native_model_unsupported" };
  }
  if (!NATIVE_SUBAGENT_MODEL_EFFORTS[model].includes(effort)) {
    return { ok: false, reason: "effort_unsupported", supportedEfforts: [...NATIVE_SUBAGENT_MODEL_EFFORTS[model]] };
  }
  return { ok: true, reason: "supported", model, effort };
}

export function validateCodexTaskModelEffort(model, effort) {
  if (typeof model !== "string" || !Object.hasOwn(CODEX_TASK_MODEL_EFFORTS, model)) {
    return { ok: false, reason: "task_model_unsupported" };
  }
  if (!CODEX_TASK_MODEL_EFFORTS[model].includes(effort)) {
    return { ok: false, reason: "effort_unsupported", supportedEfforts: [...CODEX_TASK_MODEL_EFFORTS[model]] };
  }
  return { ok: true, reason: "supported", model, effort };
}
