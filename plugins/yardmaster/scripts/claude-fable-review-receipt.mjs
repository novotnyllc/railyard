#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const SUPPORTED_VERSIONS = new Set(["2.1.220"]);
const REQUIRED_MODEL = "claude-fable-5";
const ALLOWED_AUXILIARY_MODELS = new Set(["claude-haiku-4-5-20251001"]);
const isFable = (model) => model === REQUIRED_MODEL;
const isAllowedAuxiliary = (model) => ALLOWED_AUXILIARY_MODELS.has(model);

let exitStatus;
let path;
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i] === "--exit-status") exitStatus = Number(process.argv[++i]);
  else if (!path) path = process.argv[i];
  else throw new Error(`unexpected argument: ${process.argv[i]}`);
}

if (!Number.isInteger(exitStatus)) {
  console.error("usage: claude-fable-review-receipt.mjs --exit-status <integer> [stream.jsonl]");
  process.exit(2);
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
  let sawFable = false;
  let reason;
  let observedModel;
  let observedProvider;
  let providerModel;
  for (const [model, usage] of Object.entries(modelUsage)) {
    if (isFable(model)) sawFable = true;
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
    sawFable,
    ...(reason ? { reason } : {}),
    ...(observedModel ? { observed_model: observedModel } : {}),
    ...(observedProvider !== undefined ? { observed_provider: observedProvider, provider_model: providerModel } : {}),
  };
}

function receiptEvidence(usageEvidence) {
  const { reason, sawFable, ...details } = usageEvidence ?? {};
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
    if (!SUPPORTED_VERSIONS.has(event.claude_code_version)) {
      return finish(false, "unsupported_claude_version");
    } else if (!isFable(event.model)) {
      return finish(false, "init_model_mismatch", { observed_model: event.model ?? null });
    }
    state = "active";
    return;
  }

  if (event.type === "assistant") {
    if (state !== "active") return finish(false, "invalid_event_order");
    assistantEvents += 1;
    const model = event.message?.model;
    if (!isFable(model)) {
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
    const { reason, sawFable, ...details } = usageEvidence;
    return finish(false, reason, details);
  }
  if (!usageEvidence.sawFable) return finish(false, "missing_fable_usage");

  finish(true, "validated", { exit_status: exitStatus });
});

input.on("error", () => finish(false, "stream_read_error"));
lines.on("error", () => finish(false, "stream_read_error"));
