// Oracle 0.20.3 browser controls, not native Codex/API model or effort IDs.
export const BROWSER_MODEL = "gpt-6-pro";
export const BROWSER_MODEL_LABEL = "Latest";
export const BROWSER_MODEL_STRATEGY = "select";
export const BROWSER_THINKING_TIME = "pro";
const MODEL_LABELS = new Set([BROWSER_MODEL_LABEL, "最新", "최신"]);
const VERIFIED_STATUSES = new Set(["already-selected", "switched"]);
const PRO_LABEL = /^(?:6\s*)?Pro$/i;

function observedModelForLabel(label) {
  if (MODEL_LABELS.has(label)) return BROWSER_MODEL;
  if (label === "GPT-5.6 Sol") return "gpt-5.6-sol";
  if (/^GPT-5\.5(?:\b|\s)/i.test(label || "")) return "gpt-5.5";
  return "unknown";
}

function hasConfirmedProThinking(output) {
  const lines = String(output).split(/\r?\n/);
  const answer = lines.findIndex((line) => /^Answer:\s*$/.test(line));
  if (answer < 0) return false;
  const records = lines.slice(0, answer)
    .filter((line) => /^\[browser\] Thinking time:/i.test(line));
  return records.length === 1
    && /^\[browser\] Thinking time:\s*(?:6\s*)?Pro(?:\s*\([^\r\n)]*\))?\s*$/i.test(records[0]);
}

function hasConfirmedThinkingMetadata(selection) {
  // Oracle persists this at normal completion, but not on every detach or
  // reattach path. Missing metadata uses the same session's control log below;
  // contradictory metadata must never be rescued by a log line.
  if (selection === undefined) return true;
  return selection?.requestedLevel === BROWSER_THINKING_TIME
    && VERIFIED_STATUSES.has(selection?.status)
    && selection?.verified === true
    && selection?.strictFailClosed === true
    && selection?.source === "chatgpt-thinking-picker"
    && typeof selection?.resolvedLabel === "string"
    && PRO_LABEL.test(selection.resolvedLabel.trim());
}

export function evaluateBrowserSession(metadata, output) {
  const config = metadata?.browser?.config;
  const selection = metadata?.browser?.modelSelection;
  const resolvedLabel = typeof selection?.resolvedLabel === "string" ? selection.resolvedLabel : "";
  const observedModel = observedModelForLabel(resolvedLabel);
  if (resolvedLabel && !MODEL_LABELS.has(resolvedLabel)) {
    return { observedModel, reason: "oracle_observed_model_mismatch" };
  }
  const verifiedModel = config?.desiredModel === BROWSER_MODEL_LABEL
    && config?.modelStrategy === BROWSER_MODEL_STRATEGY
    && config?.thinkingTime === BROWSER_THINKING_TIME
    && selection?.requestedModel === BROWSER_MODEL_LABEL
    && MODEL_LABELS.has(selection?.resolvedLabel)
    && selection?.strategy === BROWSER_MODEL_STRATEGY
    && VERIFIED_STATUSES.has(selection?.status)
    && selection?.verified === true
    && selection?.source === "chatgpt-model-picker";
  if (!verifiedModel) return { observedModel, reason: "oracle_observed_model_unavailable" };
  if (!hasConfirmedThinkingMetadata(metadata?.browser?.thinkingSelection) || !hasConfirmedProThinking(output)) {
    return { observedModel: BROWSER_MODEL, reason: "oracle_observed_pro_effort_unavailable" };
  }
  return { observedModel: BROWSER_MODEL, reason: null };
}
