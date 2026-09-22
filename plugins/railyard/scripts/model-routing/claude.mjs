/**
 * Claude Code 2.1.270 surface snapshot, verified 2026-09-15 against its Agent
 * schema and https://code.claude.com/docs/en/model-config. Alias resolution,
 * organization caps, and the applied effort still require runtime evidence.
 */
import { parseClaudeFamily } from "./bounds.mjs";

export const CLAUDE_AGENT_MODEL_ALIASES = Object.freeze(["sonnet", "opus", "haiku", "fable"]);

const FIVE_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const FOUR_EFFORTS = Object.freeze(["low", "medium", "high", "max"]);
const NO_EFFORTS = Object.freeze([]);
const MODEL_EFFORTS = Object.freeze({
  fable: Object.freeze({ current: FIVE_EFFORTS, "5": FIVE_EFFORTS, "5.1": FIVE_EFFORTS }),
  opus: Object.freeze({ current: FIVE_EFFORTS, "5": FIVE_EFFORTS, "4.8": FIVE_EFFORTS, "4.7": FIVE_EFFORTS, "4.6": FOUR_EFFORTS }),
  sonnet: Object.freeze({ current: FIVE_EFFORTS, "5": FIVE_EFFORTS, "4.6": FOUR_EFFORTS }),
  haiku: Object.freeze({ current: NO_EFFORTS, "4.5": NO_EFFORTS, "4.5.20251001": NO_EFFORTS }),
});

export function validateClaudeModelEffort(model, effort) {
  const parsed = parseClaudeFamily(model);
  const supportedEfforts = parsed && MODEL_EFFORTS[parsed.family]?.[parsed.selector];
  if (supportedEfforts === undefined || supportedEfforts === null) return { ok: false, reason: "claude_model_unverified" };
  if (!supportedEfforts.includes(effort)) return { ok: false, reason: "effort_unsupported", supportedEfforts: [...supportedEfforts] };
  return { ok: true, reason: "supported", model, effort };
}

// CE 3.26.2 code/doc scripts forward the selected effort. POV fixes it to
// high. The older PR seam retains its existing range and callable-attestation
// requirement; it does not inherit capabilities from the code-review script.
export const CLAUDE_REVIEW_SEAM_EFFORTS = Object.freeze({
  "ce-code-review.execution": FIVE_EFFORTS,
  "ce-doc-review.execution": FIVE_EFFORTS,
  "ce-pov.execution": Object.freeze(["high"]),
  "ce-pr-review.execution": Object.freeze(["high", "xhigh", "max"]),
});
