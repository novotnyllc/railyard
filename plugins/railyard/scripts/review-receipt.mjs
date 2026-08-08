#!/usr/bin/env node

// Attests a Claude-family review: the private `claude -p --output-format
// stream-json` JSONL stream plus the process exit status. The expected review
// model is supplied by the caller (`--expect-model`) and is whatever
// railyard:model-routing selected — Fable, Opus, or a later Claude review
// model. Nothing here is model-specific.
//
// This parser only understands Claude Code's stream format. Other review
// carriers carry their own native evidence and must NOT be piped through it:
// Codex-native review models (Sol today, successors later) validate through
// Codex's own task/thread metadata, and Oracle/ChatGPT Pro review validates
// through the oracle route's receipts. Equivalents exist per carrier; none is
// privileged.

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT_MIN_CLI_VERSION = "2.1.220";
// Claude Code uses Haiku for internal summarization/title generation, so it is
// allowed by default alongside a Claude-family expectation. Any explicit
// --allow-aux replaces this default.
const DEFAULT_CLAUDE_AUX = "claude-haiku-4-5-20251001";

let exitStatus;
let expectModel;
let minCliVersion = DEFAULT_MIN_CLI_VERSION;
let path;
const allowAux = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--exit-status") exitStatus = Number(process.argv[++i]);
  else if (arg === "--expect-model") expectModel = process.argv[++i];
  else if (arg === "--allow-aux") allowAux.push(process.argv[++i]);
  else if (arg === "--min-cli-version") minCliVersion = process.argv[++i];
  else if (!path) path = arg;
  else throw new Error(`unexpected argument: ${arg}`);
}

if (!Number.isInteger(exitStatus) || !expectModel) {
  console.error(
    "usage: review-receipt.mjs --exit-status <integer> --expect-model <model-id>" +
      " [--allow-aux <model-id>]... [--min-cli-version <semver>] [stream.jsonl]",
  );
  process.exit(2);
}

const auxiliaryModels = new Set(
  allowAux.length ? allowAux : expectModel.startsWith("claude-") ? [DEFAULT_CLAUDE_AUX] : [],
);
const isExpected = (model) => model === expectModel;
const isAllowedAuxiliary = (model) => auxiliaryModels.has(model);

// Numeric dotted compare, zero-padded to equal length; a version that is not
// all-numeric (prereleases, build metadata, undefined) fails closed.
function atLeastMinVersion(version) {
  const parts = String(version ?? "").split(".");
  const floor = minCliVersion.split(".");
  if ([...parts, ...floor].some((part) => !/^\d+$/.test(part))) return false;
  for (let i = 0; i < Math.max(parts.length, floor.length); i += 1) {
    const observed = Number(parts[i] ?? 0);
    const required = Number(floor[i] ?? 0);
    if (observed !== required) return observed > required;
  }
  return true;
}

const input = path ? createReadStream(path, "utf8") : process.stdin;
const lines = createInterface({ input, crlfDelay: Infinity });
let init;
let result;
let assistantEvents = 0;
let finished = false;
let state = "await_init";

function finish(ok, reason, details = {}) {
  if (finished) return;
  finished = true;
  const receipt = {
    ok,
    reason,
    expected_model: expectModel,
    model: init?.model ?? null,
    claude_code_version: init?.claude_code_version ?? null,
    session_id: init?.session_id ?? null,
    assistant_events: assistantEvents,
    ...details,
  };
  process.stdout.write(`${JSON.stringify(receipt)}\n`, () => process.exit(ok ? 0 : 1));
  lines.close();
}

function inspectModelUsage(modelUsage) {
  let sawExpected = false;
  let reason;
  let observedModel;
  let observedProvider;
  let providerModel;
  for (const [model, usage] of Object.entries(modelUsage)) {
    if (isExpected(model)) sawExpected = true;
    else if (!isAllowedAuxiliary(model) && !reason) {
      reason = "model_usage_mismatch";
      observedModel = model;
    }
    if (usage?.provider !== "firstParty" && observedProvider === undefined) {
      reason ??= "provider_mismatch";
      providerModel = model;
      observedProvider = usage?.provider ?? null;
    }
  }
  return {
    sawExpected,
    ...(reason ? { reason } : {}),
    ...(observedModel ? { observed_model: observedModel } : {}),
    ...(observedProvider !== undefined ? { observed_provider: observedProvider, provider_model: providerModel } : {}),
  };
}

function receiptEvidence(usageEvidence) {
  const { reason, sawExpected, ...details } = usageEvidence ?? {};
  return { ...(reason ? { evidence_reason: reason } : {}), ...details };
}

lines.on("line", (line) => {
  if (finished || !line.trim()) return;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    finish(false, "malformed_jsonl");
    return;
  }

  if (event.type === "system" && event.subtype === "model_refusal_fallback") {
    finish(false, "model_refusal_fallback", {
      original_model: event.original_model ?? null,
      fallback_model: event.fallback_model ?? null,
      trigger: event.trigger ?? null,
      api_refusal_category: event.api_refusal_category ?? null,
    });
    return;
  }

  if (event.type === "system" && event.subtype === "init") {
    if (state !== "await_init") return finish(false, "invalid_event_order");
    init = event;
    if (!atLeastMinVersion(event.claude_code_version)) {
      return finish(false, "unsupported_claude_version", { min_claude_code_version: minCliVersion });
    } else if (!isExpected(event.model)) {
      return finish(false, "init_model_mismatch", { observed_model: event.model ?? null });
    }
    state = "active";
    return;
  }

  if (event.type === "assistant") {
    if (state !== "active") return finish(false, "invalid_event_order");
    assistantEvents += 1;
    const model = event.message?.model;
    // Auxiliary models (Haiku et al.) are admitted in inspectModelUsage —
    // they surface as assistant events too, which is the whole point of the
    // allowance. Only an unlisted model is a mismatch.
    if (!isExpected(model) && !isAllowedAuxiliary(model)) {
      finish(false, "assistant_model_mismatch", { observed_model: model ?? null });
    }
    return;
  }

  if (event.type === "result") {
    if (state !== "active") return finish(false, "invalid_event_order");
    result = event;
    state = "done";
  }
});

lines.on("close", () => {
  if (finished) return;
  const usageEvidence = result?.modelUsage && typeof result.modelUsage === "object"
    ? inspectModelUsage(result.modelUsage)
    : null;
  if (exitStatus !== 0) {
    return finish(false, "process_exit_nonzero", {
      exit_status: exitStatus,
      result_is_error: result?.is_error ?? null,
      ...receiptEvidence(usageEvidence),
    });
  }
  if (!init) return finish(false, "missing_init");
  if (!result) return finish(false, "missing_terminal_result");
  if (result.is_error !== false) return finish(false, "result_error", receiptEvidence(usageEvidence));
  if (assistantEvents === 0) return finish(false, "missing_assistant_event", receiptEvidence(usageEvidence));

  const modelUsage = result.modelUsage;
  if (!modelUsage || typeof modelUsage !== "object") return finish(false, "missing_model_usage");
  if (usageEvidence.reason) {
    const { reason, sawExpected, ...details } = usageEvidence;
    return finish(false, reason, details);
  }
  if (!usageEvidence.sawExpected) return finish(false, "missing_expected_usage");

  finish(true, "validated", { exit_status: exitStatus });
});

input.on("error", () => finish(false, "stream_read_error"));
lines.on("error", () => finish(false, "stream_read_error"));
