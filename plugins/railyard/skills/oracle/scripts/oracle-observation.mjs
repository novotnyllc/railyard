export const BROWSER_MODEL = "gpt-5.6-sol";
export const BROWSER_MODEL_LABEL = "GPT-5.6 Sol";
export const BROWSER_MODEL_STRATEGY = "select";
export const BROWSER_THINKING_TIME = "pro";

function observedModelForLabel(label) {
  if (label === BROWSER_MODEL_LABEL) return BROWSER_MODEL;
  if (/^GPT-5\.5(?:\b|\s)/i.test(label || "")) return "gpt-5.5";
  return "unknown";
}

function hasConfirmedProThinking(output) {
  const lines = String(output).split(/\r?\n/);
  const answer = lines.findIndex((line) => /^Answer:\s*$/.test(line));
  return answer >= 0 && lines.slice(0, answer)
    .filter((line) => /^\[browser\] Thinking time:\s*Pro(?:\s*\([^\r\n)]*\))?\s*$/i.test(line))
    .length === 1;
}

export function evaluateBrowserSession(metadata, output) {
  const config = metadata?.browser?.config;
  const selection = metadata?.browser?.modelSelection;
  const resolvedLabel = typeof selection?.resolvedLabel === "string" ? selection.resolvedLabel : "";
  const observedModel = observedModelForLabel(resolvedLabel);
  if (resolvedLabel && resolvedLabel !== BROWSER_MODEL_LABEL) {
    return { observedModel, reason: "oracle_observed_model_mismatch" };
  }
  const verifiedModel = config?.desiredModel === BROWSER_MODEL_LABEL
    && config?.modelStrategy === BROWSER_MODEL_STRATEGY
    && config?.thinkingTime === BROWSER_THINKING_TIME
    && selection?.requestedModel === BROWSER_MODEL_LABEL
    && selection?.resolvedLabel === BROWSER_MODEL_LABEL
    && selection?.strategy === BROWSER_MODEL_STRATEGY
    && ["already-selected", "switched"].includes(selection?.status)
    && selection?.verified === true
    && selection?.source === "chatgpt-model-picker";
  if (!verifiedModel) return { observedModel, reason: "oracle_observed_model_unavailable" };
  if (!hasConfirmedProThinking(output)) {
    return { observedModel: BROWSER_MODEL, reason: "oracle_observed_pro_effort_unavailable" };
  }
  return { observedModel: BROWSER_MODEL, reason: null };
}
