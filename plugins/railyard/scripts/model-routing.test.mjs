import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADAPTER_DESCRIPTORS,
  buildInvariantWorkContract,
  CARRIER_DESCRIPTORS,
  CE_SEAMS,
  CONTRACT_VERSION,
  createEmptyState,
  DAYBREAK_MODEL,
  DAYBREAK_AVAILABILITY_TTL_MS,
  handleRequest,
  MAX_APP_SERVER_RESPONSE_BYTES,
  measureFastPath,
  loadStateForCli,
  migrateState,
  pathSafetyIssue,
  probeCodexDaybreak,
  probeDaybreakAvailability,
  resolvePaths,
  runCli,
  runCliAsync,
  scopeAccountingId,
  stableDigest,
  providerAvailabilityIssue,
  parseClaudeFamily,
  NATIVE_SUBAGENT_MODEL_EFFORTS,
  validateNativeModelEffort,
  validateCodexTaskModelEffort,
  validateCatalog,
  validateState,
} from "./model-routing.mjs";
import { claudeIdentitySatisfied, fallbackSetDigest } from "./model-routing/select.mjs";
import { CLAUDE_AGENT_MODEL_ALIASES, validateClaudeModelEffort } from "./model-routing/claude.mjs";
import { validBinding, validSelected } from "./model-routing/state-schema.mjs";
import { build as buildOracle, dispatch as dispatchOracle, oracleSessionSlug } from "../skills/oracle/scripts/oracle-route.mjs";

const NOW = Date.parse("2026-08-04T12:00:00.000Z");
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const IMPORTER_ID = "railyard-adapter-receipt-importer-v1";

function request(command, fields = {}) {
  const value = {
    contractVersion: CONTRACT_VERSION,
    command,
    callerKind: "deliver",
    role: "implementation",
    adapterId: "native-subagent-create",
    dispatchKind: "subagent_create",
    workShape: {
      ambiguity: "low",
      novelty: "low",
      repetition: "high",
      decomposability: "high",
      unitVolume: "high",
      semanticRisk: "low",
      verificationStrength: "high",
    },
    objectiveDigest: DIGEST_A,
    instructionDigest: DIGEST_B,
    ...fields,
  };
  for (const [key, nested] of Object.entries(value)) if (nested === undefined) delete value[key];
  return value;
}

function fakeAppServer(onRequest) {
  const child = new EventEmitter();
  child.killed = false;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0);
    return true;
  };
  const requests = [];
  let buffer = "";
  child.stdin.on("data", (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      requests.push(message);
      onRequest(message, child, requests);
    }
  });
  return { child, requests };
}

function rate({ model = "gpt-6-astra", carrierId = "codex-astra", effort = "max", billingSurface = "codex", amount = "0.10" } = {}) {
  return {
    meter: "marginalUsd",
    amount,
    asOf: "2026-08-04T00:00:00.000Z",
    sourceUrl: "https://pricing.example.test/model",
    checkedAt: "2026-08-04T00:00:00.000Z",
    effectiveAt: "2026-08-04T00:00:00.000Z",
    carrierId,
    carrierVersion: CARRIER_DESCRIPTORS[carrierId].version,
    effort,
    billingSurface,
    resolvedModelDigest: stableDigest(model),
  };
}

function catalog({ budgets, privacy, discovery, rates = false, learning, extraProviders = {}, extraModels = {}, extraRoles = {} } = {}) {
  const policy = {
    schemaVersion: 1,
    providers: {
      codex: { carrierId: "codex-astra", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default" },
      task_luna: { carrierId: "codex-6-luna", executionSurface: "codex", account: "plan", locality: "same_region", retention: "ephemeral" },
      ...extraProviders,
    },
    models: {
      luna: {
        provider: "codex",
        carrierId: "codex-astra",
        requestedModel: "gpt-6-astra",
        efforts: ["max"],
        roles: ["implementation", "implementation.mechanical"],
        relativeCostIndex: 50,
        ...(rates ? { rates: [rate()] } : {}),
      },
      task_luna: {
        provider: "task_luna",
        carrierId: "codex-6-luna",
        requestedModel: "gpt-6-luna",
        efforts: ["xhigh"],
        roles: ["implementation.mechanical"],
        relativeCostIndex: 1,
        workShape: {
          ambiguity: ["low"], novelty: ["low"], repetition: ["high"], decomposability: ["high"], unitVolume: ["high"], semanticRisk: ["low"], verificationStrength: ["high"],
        },
        ...(rates ? { rates: [rate({ model: "gpt-6-luna", carrierId: "codex-6-luna", effort: "xhigh", billingSurface: "codex", amount: "0.02" })] } : {}),
      },
      ...extraModels,
    },
    roles: {
      implementation: { tiers: [{ models: ["luna"], softPriorities: ["cost"] }] },
      "implementation.mechanical": { tiers: [{ models: ["luna", "task_luna"], softPriorities: ["cost"] }] },
      ...extraRoles,
    },
  };
  if (budgets !== undefined) policy.budgets = budgets;
  if (privacy !== undefined) policy.privacy = privacy;
  if (discovery !== undefined) policy.discovery = discovery;
  if (learning !== undefined) policy.learning = learning;
  return policy;
}

function policyDigest(policy) {
  const validated = validateCatalog(policy);
  assert.equal(validated.ok, true, JSON.stringify(validated));
  return validated.policy.digest;
}

function examplePolicy() {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../references/model-routing.example.json"), "utf8"));
}

// Explicit multi-harness fixture for capability, cost, and privacy regressions.
function configuredPolicy() {
  return {
    "schemaVersion": 1,
    "providers": {
      "claude": {
        "carrierId": "claude-session",
        "executionSurface": "provider_subscription",
        "account": "claude-sub",
        "locality": "external",
        "retention": "provider_default",
        "harness": "claude"
      },
      "codex_luna": {
        "carrierId": "codex-astra",
        "executionSurface": "codex",
        "account": "codex-sub",
        "locality": "external",
        "retention": "provider_default",
        "harness": "codex"
      },
      "codex_sol": {
        "carrierId": "codex-6-sol",
        "executionSurface": "codex",
        "account": "codex-sub",
        "locality": "external",
        "retention": "provider_default",
        "harness": "codex"
      },
      "codex_daybreak_blue": {
        "carrierId": "codex-daybreak-blue",
        "executionSurface": "codex",
        "account": "codex-sub",
        "locality": "external",
        "retention": "provider_default",
        "harness": "codex"
      },
      "zai": {
        "carrierId": "codex-6-luna",
        "executionSurface": "codex",
        "account": "zai-credits",
        "locality": "same_region",
        "retention": "ephemeral",
        "harness": "codex"
      }
    },
    "models": {
      "fable": {
        "provider": "claude",
        "carrierId": "claude-session",
        "requestedModel": "fable",
        "effort": "high",
      "efforts": ["high", "max"],
        "roles": ["implementation.hard"],
        "relativeCostIndex": 100
      },
      "sonnet": {
        "provider": "claude",
        "carrierId": "claude-session",
        "requestedModel": "sonnet",
        "efforts": ["medium"],
        "roles": ["implementation.medium", "implementation.long-running"],
        "relativeCostIndex": 30
      },
      "haiku": {
        "provider": "claude",
        "carrierId": "claude-session",
        "requestedModel": "haiku",
        "efforts": ["low"],
        "roles": ["implementation.mechanical"],
        "relativeCostIndex": 10
      },
      "sol": {
        "provider": "codex_sol",
        "carrierId": "codex-6-sol",
        "requestedModel": "gpt-6-sol",
        "effort": "high",
      "efforts": ["high", "max"],
        "roles": ["implementation.hard", "orchestration", "review", "review.code", "review.plan", "review.primary", "review.cross_family", "security.review", "security.threat-model", "security.trust", "security.redaction", "security.signing", "security.attack-shape", "security.audit"],
        "relativeCostIndex": 80
      },
      "sol_max": {
        "provider": "codex_sol",
        "carrierId": "codex-6-sol",
        "requestedModel": "gpt-6-sol",
        "efforts": ["max"],
        "roles": ["implementation.hard"],
        "relativeCostIndex": 80
      },
      "daybreak_blue": {
        "provider": "codex_daybreak_blue",
        "carrierId": "codex-daybreak-blue",
        "requestedModel": "gpt-daybreak-blue-latest",
        "effort": "high",
      "efforts": ["high", "max"],
        "roles": ["security.review", "security.threat-model", "security.trust", "security.redaction", "security.signing", "security.attack-shape", "security.audit"],
        "relativeCostIndex": 80
      },
      "luna": {
        "provider": "codex_luna",
        "carrierId": "codex-astra",
        "requestedModel": "gpt-6-astra",
        "efforts": ["max"],
        "roles": ["implementation", "implementation.medium", "implementation.long-running", "implementation.mechanical", "implementation.cross-harness"],
        "relativeCostIndex": 20
      },
      "task_luna": {
        "provider": "zai",
        "carrierId": "codex-6-luna",
        "requestedModel": "gpt-6-luna",
        "efforts": ["xhigh"],
        "roles": ["implementation.cross-harness"],
        "relativeCostIndex": 1
      }
    },
    "roles": {
      "orchestration": {
        "tiers": [["sol"]]
      },
      "review": {
        "tiers": [["sol"]]
      },
      "review.code": {
        "tiers": [["sol"]]
      },
      "review.plan": {
        "tiers": [["sol"]]
      },
      "review.primary": {
        "tiers": [["sol"]]
      },
      "review.cross_family": {
        "tiers": [["sol"]]
      },
      "security.review": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.threat-model": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.trust": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.redaction": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.signing": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.attack-shape": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "security.audit": {
        "tiers": [["daybreak_blue"], ["sol"]]
      },
      "implementation": {
        "tiers": [["luna"]]
      },
      "implementation.hard": {
        "tiers": [["fable", "sol_max"]]
      },
      "implementation.medium": {
        "tiers": [["sonnet", "luna"]]
      },
      "implementation.long-running": {
        "tiers": [["sonnet", "luna"]]
      },
      "implementation.mechanical": {
        "tiers": [["haiku", "luna"]]
      },
      "implementation.cross-harness": {
        "tiers": [
          {
            "models": ["luna", "task_luna"],
            "softPriorities": ["cost"]
          }
        ]
      }
    },
    "budgets": {
      "task": {
        "claude_subscription": {"soft": "100"},
        "codex_subscription": {"soft": "100"},
        "zai_credits": {"soft": "100"}
      },
      "run": {
        "claude_subscription": {"soft": "1000"},
        "codex_subscription": {"soft": "1000"},
        "zai_credits": {"soft": "1000"}
      },
      "project": {
        "claude_subscription": {"soft": "10000"},
        "codex_subscription": {"soft": "10000"},
        "zai_credits": {"soft": "10000"}
      }
    },
    "learning": {
      "enabled": true
    }
  };
}

function dispatchIdentity(adapterId, { hostScope = "local", accountScope = "local", sessionId = "session-one" } = {}) {
  const adapter = ADAPTER_DESCRIPTORS[adapterId];
  return {
    hostScope,
    accountScope,
    dispatchKind: adapter.dispatchKinds[0],
    sessionId,
    toolId: adapter.receiptProducer,
    toolVersion: adapter.version,
  };
}

function capabilityFacts(record, details) {
  return {
    carrierId: record.carrierId,
    carrierVersion: record.carrierVersion,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    hostScope: record.hostScope,
    accountScope: record.accountScope,
    policyDigest: record.policyDigest,
    observedModel: details.observedModel,
    authState: details.authState,
    capabilities: [...details.capabilities].sort(),
    fallbackSetDigest: details.fallbackSetDigest,
    expiresAt: details.expiresAt,
  };
}

function refreshAttestor({ observedModel, capabilities = [], authState = "authenticated", fallbackSetDigest, expiresAt = "2026-08-04T12:30:00.000Z" } = {}) {
  return (record) => {
    const details = { observedModel, capabilities, authState, fallbackSetDigest, expiresAt };
    const facts = capabilityFacts(record, details);
    const result = {
      attestorId: "railyard-host-attestor-v1",
      attestationDigest: DIGEST_A,
      attestedAt: "2026-08-04T12:00:00.000Z",
      expiresAt,
      observedModel,
      authState,
      capabilities,
      attestedFactsDigest: stableDigest(facts),
    };
    if (fallbackSetDigest !== undefined) result.fallbackSetDigest = fallbackSetDigest;
    return result;
  };
}

function attestedCapability(policy, { carrierId = "codex-6-luna", adapterId = "codex-task-create", hostScope = "local", accountScope = "plan", observedModel = "gpt-6-luna", capabilities = [], fallbackSetDigest } = {}) {
  const state = createEmptyState();
  const record = {
    carrierId,
    carrierVersion: CARRIER_DESCRIPTORS[carrierId].version,
    adapterId,
    adapterVersion: ADAPTER_DESCRIPTORS[adapterId].version,
    hostScope,
    accountScope,
    policyDigest: policyDigest(policy),
    state: "host_capability_attested",
    observedModel,
    resolvedModelDigest: stableDigest(observedModel),
    capabilities,
    authState: "authenticated",
    expiresAt: "2026-08-05T12:00:00.000Z",
    attestedAt: "2026-08-04T11:00:00.000Z",
    attestorId: "railyard-host-attestor-v1",
    attestationDigest: DIGEST_A,
  };
  if (fallbackSetDigest !== undefined) record.fallbackSetDigest = fallbackSetDigest;
  record.attestedFactsDigest = stableDigest(capabilityFacts(record, record));
  state.capabilities.capability_one = record;
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  return state;
}

function admit(policy, state, fields = {}) {
  const handled = handleRequest(request("admit", {
    requestId: "admit-one",
    frozenInputDigest: DIGEST_A,
    forecast: { marginalUsd: "1" },
    scopes: { task: "task-one", run: "run-one", project: "project-one" },
    ...fields,
  }), { catalog: policy, state, now: NOW });
  assert.equal(handled.response.ok, true, JSON.stringify(handled.response));
  return handled.response;
}

function trustedReceiptImporter(receipt, now = NOW) {
  return ({ expected }) => {
    const { importedAt: _importedAt, ...binding } = expected;
    return {
      importerId: IMPORTER_ID,
      importerVersion: "v1",
      attestationDigest: stableDigest({ importerId: IMPORTER_ID, importerVersion: "v1", expected: binding, receipt }),
      attestedAt: new Date(now).toISOString(),
      receipt,
    };
  };
}

function trustedTaskAuthorityAttestor(now = NOW) {
  return ({ authority }) => {
    const controller = { threadId: "controller-one", permissionProfile: "disabled", originator: "user" };
    const facts = { ...authority, controller };
    return {
      attestorId: "railyard-task-authority-attestor-v1",
      attestationDigest: stableDigest({ facts, source: "fixed-test-user-turn-attestor" }),
      attestedAt: new Date(now).toISOString(),
      authorityFactsDigest: stableDigest(facts),
      controller,
    };
  };
}

function mintAuthority(policy, state, authority) {
  const minted = handleRequest(request("mint-task-authority", { authority }), {
    catalog: policy,
    state,
    now: NOW,
    trustedTaskAuthorityAttestor: trustedTaskAuthorityAttestor(),
  });
  assert.equal(minted.response.ok, true, JSON.stringify(minted.response));
  return minted.response.authority;
}

function baseReceipt(reservation, identity, fields = {}) {
  return {
    receiptId: "receipt-one",
    producer: identity.toolId,
    adapterVersion: identity.toolVersion,
    claimId: reservation.claimId,
    frozenInputDigest: reservation.frozenInputDigest,
    status: "settled",
    hostScope: identity.hostScope,
    accountScope: identity.accountScope,
    dispatchKind: identity.dispatchKind,
    sessionId: identity.sessionId,
    toolId: identity.toolId,
    toolVersion: identity.toolVersion,
    measuredUsage: { marginalUsd: "1" },
    measuredBilled: true,
    ...fields,
  };
}

function claim(policy, state, admission, { identity = dispatchIdentity(admission.reservation.binding.adapterId), fields = {} } = {}) {
  const handled = handleRequest(request("claim-dispatch", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: admission.reservation.frozenInputDigest,
    dispatchIdentity: identity,
    ...fields,
  }), { catalog: policy, state, now: NOW });
  assert.equal(handled.response.ok, true, JSON.stringify(handled.response));
  return { response: handled.response, identity };
}

const ROUTER_CLI = fileURLToPath(new URL("./model-routing.mjs", import.meta.url));

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function isolatedCliEnvironment(home) {
  const env = { ...process.env, HOME: home };
  delete env.XDG_CONFIG_HOME;
  delete env.XDG_STATE_HOME;
  delete env.LOCALAPPDATA;
  delete env.CODEX_THREAD_ID;
  delete env.CODEX_PERMISSION_PROFILE;
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  return env;
}

function publicCli(input, home, envOverrides = {}) {
  const child = spawnSync(process.execPath, [ROUTER_CLI], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...isolatedCliEnvironment(home), ...envOverrides },
  });
  assert.equal(child.signal, null, child.stderr);
  assert.notEqual(child.stdout.trim(), "", child.stderr);
  return JSON.parse(child.stdout.trim());
}

function oraclePolicy() {
  return catalog({
    discovery: { positiveTtlSeconds: 300, negativeTtls: { transientSeconds: 60, authSeconds: 120, missingBinarySeconds: 600, unsupportedSeconds: 3600 }, retryAfterMaxSeconds: 180, manualRefresh: true },
    extraProviders: {
      oracle: { carrierId: "oracle-browser", executionSurface: "chatgpt_standard", account: "standard", locality: "external", retention: "provider_default" },
    },
    extraModels: {
      oracle: { provider: "oracle", carrierId: "oracle-browser", requestedModel: "chatgpt_current_pro", efforts: ["high"], roles: ["review.deep"] },
    },
    extraRoles: { "review.deep": { tiers: [["oracle"]] } },
  });
}

function r52Readiness() {
  return {
    schema: "railyard/r52-readiness/v1",
    hostReadiness: { state: "ready", evidenceDigest: "1".repeat(64) },
    taskReadiness: { state: "ready", evidenceDigest: "2".repeat(64) },
    transportReadiness: { state: "ready", evidenceDigest: "3".repeat(64) },
    executionHost: { identityDigest: "4".repeat(64), platform: "darwin" },
    targetPlatform: { identityDigest: "5".repeat(64), platform: "linux" },
  };
}

test("native model capabilities distinguish exposed overrides from broader provider catalogs", () => {
  assert.equal(validateNativeModelEffort("gpt-6-astra", "max").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-astra", "ultra").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-sol", "ultra").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-luna", "max").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-luna", "ultra").reason, "effort_unsupported");
  assert.equal(validateNativeModelEffort("gpt-5.6-terra", "ultra").reason, "native_model_unsupported");
  assert.equal(validateNativeModelEffort("gpt-daybreak-blue-latest", "ultra").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-astra", "max").ok, true);
  assert.equal(validateNativeModelEffort("gpt-6-astra", "invalid").reason, "effort_unsupported");
  for (const model of ["gpt-5.6-sol", "gpt-5.6-luna", "combo/grok-unified-4.6", "cursor/composer-2.5", "__proto__", undefined]) {
    assert.equal(validateNativeModelEffort(model, "max").reason, "native_model_unsupported");
  }
  assert.equal(validateNativeModelEffort("gpt-6-astra", undefined).reason, "effort_unsupported");
  assert.throws(() => NATIVE_SUBAGENT_MODEL_EFFORTS["gpt-6-astra"].push("ultra"), TypeError);
});

test("retired models have no carrier, native route, or task route", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.equal(validateNativeModelEffort(model, "medium").reason, "native_model_unsupported");
    assert.equal(validateCodexTaskModelEffort(model, "medium").reason, "task_model_unsupported");
    assert.equal(Object.values(CARRIER_DESCRIPTORS).some((carrier) => carrier.requestedModel === model), false);
    const result = handleRequest(request("resolve", { model, effort: "medium", adapterId: "codex-task-create", dispatchKind: "task_create" }), { now: NOW });
    assert.equal(result.response.reason, "task_model_unsupported");
    assert.equal(result.response.decision, undefined);
  }
  assert.equal(Object.keys(CARRIER_DESCRIPTORS).some((id) => id.startsWith("glm") || id.includes("terra")), false);
});

test("ordinary GPT-6 Sol task routes support implementation and investigation CE seams", () => {
  for (const [id, skill, role] of [
    ["ce-work.execution", "ce-work", "implementation"],
    ["ce-debug.execution", "ce-debug", "investigation"],
  ]) {
    const seam = CE_SEAMS[id];
    const result = handleRequest(request("resolve", {
      role, callerKind: "compound-engineering", adapterId: "codex-task-create", dispatchKind: "task_create",
      ceSeam: { id, skill, artifact: { schema: seam.artifactSchema, digest: DIGEST_A } },
    }), { now: NOW });
    assert.equal(result.response.reason, "resolved", JSON.stringify(result.response));
    assert.equal(result.response.decision.selected.model, "gpt-6-sol");
  }
});

test("Claude selectors preserve release pins and compare hyphenated generations numerically", () => {
  for (const model of ["fable", "fable-current", "fable[1m]"]) {
    assert.deepEqual(parseClaudeFamily(model), { family: "fable", selector: "current" });
  }
  for (const model of ["claude-fable-5-1", "claude-fable-5-1[1m]", "fable:5.1", "fable-5.1"]) {
    assert.deepEqual(parseClaudeFamily(model), { family: "fable", selector: "5.1" });
  }
  assert.deepEqual(parseClaudeFamily("claude-sonnet-4-5-20250929"), { family: "sonnet", selector: "4.5.20250929" });
  for (const malformed of ["claude-fable-5--1", "claude-fable-5-1-extra", "claude-fable-5-1[2m]", "fable-5.1-2", "__proto__"]) {
    assert.equal(parseClaudeFamily(malformed), null);
  }
  const current = { requestedModel: "fable", minimumGeneration: "5.1" };
  assert.equal(claudeIdentitySatisfied(current, "claude-fable-5-1"), true);
  assert.equal(claudeIdentitySatisfied(current, "claude-fable-5-10"), true);
  assert.equal(claudeIdentitySatisfied(current, "claude-fable-5"), false);
  assert.equal(claudeIdentitySatisfied(current, "fable[1m]"), false);
  const snapshot = { requestedModel: "claude-sonnet-4-5-20250929", identityMode: "exact_pin" };
  assert.equal(claudeIdentitySatisfied(snapshot, "claude-sonnet-4-5-20250929"), true);
  assert.equal(claudeIdentitySatisfied(snapshot, "claude-sonnet-4-5-20251001"), false);
});

test("Claude Code effort capabilities are model-specific and do not extend Codex native support", () => {
  assert.deepEqual(CLAUDE_AGENT_MODEL_ALIASES, ["sonnet", "opus", "haiku", "fable"]);
  for (const model of ["fable", "claude-fable-5", "claude-fable-5-1", "claude-fable-5-1[1m]", "claude-opus-5", "claude-sonnet-5"]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) assert.equal(validateClaudeModelEffort(model, effort).ok, true, `${model} ${effort}`);
    assert.equal(validateClaudeModelEffort(model, "ultra").reason, "effort_unsupported");
    assert.equal(validateNativeModelEffort(model, "max").reason, "native_model_unsupported");
  }
  for (const model of ["claude-opus-4-6", "claude-sonnet-4-6"]) {
    assert.equal(validateClaudeModelEffort(model, "max").ok, true);
    assert.equal(validateClaudeModelEffort(model, "xhigh").reason, "effort_unsupported");
  }
  assert.equal(validateClaudeModelEffort("claude-haiku-4-5-20251001", "low").reason, "effort_unsupported");
  assert.equal(validateClaudeModelEffort("provider/custom-model", "high").reason, "claude_model_unverified");
  assert.equal(validateClaudeModelEffort("claude-fable-99", "max").reason, "claude_model_unverified");
});

function claudePolicy(model = "claude-fable-5-1", { carrierId = "claude-ce-review", role = "review.code", ...modelFields } = {}) {
  return {
    schemaVersion: 1,
    providers: { claude: { carrierId, executionSurface: "provider_subscription", account: "claude", harness: "claude" } },
    models: { selected: { provider: "claude", carrierId, requestedModel: model, effort: "high", ...modelFields } },
    roles: { [role]: { tiers: [["selected"]] } },
  };
}

function claudePeerState(policy, observedModel = policy.models.selected.requestedModel) {
  return attestedCapability(policy, {
    carrierId: "claude-ce-review", adapterId: "claude-cli-via-worker", accountScope: "claude", observedModel,
    fallbackSetDigest: fallbackSetDigest(policy.models.selected),
  });
}

test("Fable 5.1 code and doc review routes preserve each deliberate effort and unverified applied effort", () => {
  for (const [id, skill, role, schema] of [
    ["ce-code-review.execution", "ce-code-review", "review.code", "railyard/ce-code-review-findings/v1"],
    ["ce-doc-review.execution", "ce-doc-review", "review.plan", "railyard/ce-doc-review-findings/v1"],
  ]) {
    for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
      const policy = claudePolicy("claude-fable-5-1", { role });
      const state = claudePeerState(policy);
      const fields = {
        role, callerKind: "compound-engineering", harness: "claude", model: "claude-fable-5-1", effort, adapterId: "claude-cli-via-worker",
        ceSeam: { id, skill, artifact: { schema, digest: DIGEST_A } },
      };
      const resolved = handleRequest(request("resolve", fields), { catalog: policy, state, now: NOW }).response;
      assert.equal(resolved.reason, "resolved", JSON.stringify(resolved));
      assert.equal(resolved.decision.selected.model, "claude-fable-5-1");
      assert.equal(resolved.decision.selected.effort, effort);
      assert.equal(resolved.decision.requestedVsActual.effectiveEffort, "unknown");
      assert.equal(resolved.decision.binding.controls.claudeBinding, "ce-slot");
      assert.equal(resolved.decision.fallback, undefined);
      const admission = admit(policy, state, fields);
      assert.equal(admission.reservation.selected.model, "claude-fable-5-1");
      assert.equal(admission.reservation.selected.effort, effort);
    }
  }
});

test("Fable release pins and minimum generations refuse mismatched observations without admission or fallback", () => {
  for (const [model, modelFields, observed, explicitModel, ok] of [
    ["claude-fable-5-1", {}, "claude-fable-5", false, false],
    ["claude-fable-5-1", { identityMode: "exact_pin" }, "fable", true, false],
    ["fable", { identityMode: "provider_latest_family", minimumGeneration: "5.1" }, "claude-fable-5", false, false],
    ["fable", { identityMode: "provider_latest_family", minimumGeneration: "5.1" }, "claude-fable-5-1", false, true],
    ["claude-fable-5-1", { identityMode: "provider_latest_family" }, "claude-fable-5", true, false],
  ]) {
    const policy = claudePolicy(model, modelFields);
    const state = claudePeerState(policy, observed);
    const before = structuredClone(state);
    const fields = {
      role: "review.code", callerKind: "compound-engineering", harness: "claude", effort: "max", ...(explicitModel ? { model } : {}),
      adapterId: "claude-cli-via-worker", ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
    };
    const resolved = handleRequest(request("resolve", fields), { catalog: policy, state, now: NOW }).response;
    assert.equal(resolved.ok, ok, JSON.stringify(resolved));
    if (ok) {
      assert.equal(resolved.decision.selected.model, observed);
      continue;
    }
    assert.deepEqual(resolved.rejectedAlternatives, [{ modelAlias: "selected", reason: "claude_identity_mismatch" }]);
    const refused = handleRequest(request("admit", { ...fields, requestId: "mismatched-fable", frozenInputDigest: DIGEST_A, scopes: { task: "claude-task" } }), { catalog: policy, state, now: NOW });
    assert.equal(refused.response.reason, "no_eligible_route");
    assert.equal(refused.changed, false);
    assert.deepEqual(state, before);
  }
});

test("native Claude Agent routes retain aliases and refuse unmappable full IDs and context suffixes", () => {
  for (const model of ["fable", "claude-fable-5-1", "fable[1m]"]) {
    const policy = claudePolicy(model, { carrierId: "claude-session", role: "implementation.hard" });
    const fields = { role: "implementation.hard", harness: "claude", model, effort: "max", adapterId: "claude-session-create" };
    const state = createEmptyState();
    const resolved = handleRequest(request("resolve", fields), { catalog: policy, state, now: NOW }).response;
    if (model === "fable") {
      assert.equal(resolved.reason, "resolved", JSON.stringify(resolved));
      assert.equal(resolved.decision.selected.model, "fable");
      assert.equal(resolved.decision.requestedVsActual.effectiveEffort, "unknown");
    } else if (model === "fable[1m]") {
      assert.equal(resolved.reason, "invalid_model");
    } else {
      assert.equal(resolved.reason, "no_eligible_route", JSON.stringify(resolved));
      assert.deepEqual(resolved.rejectedAlternatives, [{ modelAlias: "selected", reason: "claude_agent_model_unsupported" }]);
    }
    assert.equal(handleRequest(request("resolve", { model, effort: "max" }), { now: NOW }).response.reason, model === "fable[1m]" ? "invalid_model" : "task_model_unsupported");
  }
});

test("native Claude Agent decisions keep a callable alias after attesting the resolved Fable release", () => {
  const policy = claudePolicy("fable", { carrierId: "claude-session", role: "implementation.hard" });
  const state = attestedCapability(policy, {
    carrierId: "claude-session", adapterId: "claude-session-create", accountScope: "claude", observedModel: "claude-fable-5-1",
  });
  const fields = { role: "implementation.hard", harness: "claude", model: "fable", effort: "max", adapterId: "claude-session-create" };
  const resolved = handleRequest(request("resolve", fields), { catalog: policy, state, now: NOW }).response;
  assert.equal(resolved.reason, "resolved", JSON.stringify(resolved));
  const decision = resolved.decision;
  const agentModel = decision.selected.model;
  assert.equal(agentModel, "fable");
  assert.equal(CLAUDE_AGENT_MODEL_ALIASES.includes(agentModel), true);
  assert.equal(decision.selected.effort, "max");
  assert.equal(decision.selected.observedModel, "claude-fable-5-1");
  assert.equal(decision.requestedVsActual.observedModel, "claude-fable-5-1");
  assert.equal(decision.requestedVsActual.effectiveEffort, "unknown");
  assert.deepEqual(decision.disclosure.observed.model, { value: "claude-fable-5-1", provenance: "capability_attestation" });
  const admission = admit(policy, state, fields);
  assert.equal(admission.reservation.selected.model, "fable");
  assert.equal(admission.reservation.selected.observedModel, "claude-fable-5-1");
  assert.equal(validateState(state).ok, true);

  // Records made before the dispatch-alias correction remain readable with
  // their original selected identity and unchanged adapter control binding.
  const historical = structuredClone(state);
  const stored = historical.reservations[admission.reservation.reservationId];
  stored.selected.model = "claude-fable-5-1";
  stored.decision.selected.model = "claude-fable-5-1";
  assert.deepEqual(stored.binding, admission.reservation.binding);
  assert.equal(validateState(historical).ok, true);
  assert.equal(handleRequest(request("status"), { catalog: policy, state: historical, now: NOW }).response.ok, true);
});

test("Claude review efforts cannot exceed the observed model or fixed CE seam controls", () => {
  for (const [model, observed, effort, seam, reason] of [
    ["claude-opus-4-6", "claude-opus-4-6", "xhigh", "code", "effort_unsupported"],
    ["opus", "claude-opus-4-6", "xhigh", "code", "effort_unsupported"],
    ["claude-fable-5-1", "claude-fable-5-1", "max", "pov", "ce_effort_unsupported"],
  ]) {
    const role = seam === "pov" ? "review.cross_family" : "review.code";
    const policy = claudePolicy(model, { role });
    const state = claudePeerState(policy, observed);
    const ceSeam = seam === "pov"
      ? { id: "ce-pov.execution", skill: "ce-pov", artifact: { schema: "railyard/ce-pov-review/v1", digest: DIGEST_A } }
      : { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } };
    const resolved = handleRequest(request("resolve", { role, callerKind: "compound-engineering", harness: "claude", effort, adapterId: "claude-cli-via-worker", ceSeam }), { catalog: policy, state, now: NOW }).response;
    assert.equal(resolved.reason, "no_eligible_route", JSON.stringify(resolved));
    assert.deepEqual(resolved.rejectedAlternatives, [{ modelAlias: "selected", reason }]);
  }
});

test("Claude CE review routes reject unverified configured and observed model-effort pairs", () => {
  const configuredUnknown = claudePolicy("claude-fable-99", { identityMode: "provider_latest_family" });
  const configuredUnknownResponse = handleRequest(request("resolve", {
    role: "review.code", callerKind: "compound-engineering", harness: "claude", effort: "max", adapterId: "claude-cli-via-worker",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { catalog: configuredUnknown, state: claudePeerState(configuredUnknown), now: NOW }).response;
  assert.equal(configuredUnknownResponse.reason, "no_eligible_route", JSON.stringify(configuredUnknownResponse));
  assert.deepEqual(configuredUnknownResponse.rejectedAlternatives, [{ modelAlias: "selected", reason: "claude_model_unverified" }]);

  const observedUnknown = claudePolicy("fable", { identityMode: "provider_latest_family" });
  const observedUnknownResponse = handleRequest(request("resolve", {
    role: "review.code", callerKind: "compound-engineering", harness: "claude", effort: "max", adapterId: "claude-cli-via-worker",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { catalog: observedUnknown, state: claudePeerState(observedUnknown, "claude-fable-99"), now: NOW }).response;
  assert.equal(observedUnknownResponse.reason, "no_eligible_route", JSON.stringify(observedUnknownResponse));
  assert.deepEqual(observedUnknownResponse.rejectedAlternatives, [{ modelAlias: "selected", reason: "claude_model_unverified" }]);
});

test("default allocation preserves requested pairs across native spawn and task creation", () => {
  for (const [model, effort] of [["gpt-6-astra", "low"], ["gpt-6-astra", "medium"], ["gpt-6-astra", "high"]]) {
    const resolved = handleRequest(request("resolve", { model, effort }), { now: NOW });
    assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
    assert.equal(resolved.response.decision.selected.model, model);
    assert.equal(resolved.response.decision.selected.effort, effort);
    assert.deepEqual(resolved.response.decision.disclosure.requested.model, { value: model, provenance: "request" });
    assert.equal(resolved.response.decision.fallback, undefined);
    assert.equal(resolved.response.decision.requestedVsActual.observedModel, "unknown");
  }
  const effortOnly = handleRequest(request("resolve", { effort: "medium" }), { now: NOW });
  assert.equal(effortOnly.response.reason, "resolved");
  assert.equal(effortOnly.response.decision.selected.model, "gpt-6-sol");
  assert.equal(effortOnly.response.decision.selected.effort, "medium");
  for (const [model, effort] of [["gpt-6-sol", "high"], ["gpt-6-luna", "medium"]]) {
    const resolved = handleRequest(request("resolve", { model, effort, adapterId: "codex-task-create", dispatchKind: "task_create" }), { now: NOW });
    assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
    assert.equal(resolved.response.decision.selected.model, model);
    assert.equal(resolved.response.decision.selected.effort, effort);
  }
  const nativeSol = handleRequest(request("resolve", { model: "gpt-6-sol", effort: "high" }), { now: NOW }).response;
  assert.equal(nativeSol.reason, "resolved");
  assert.equal(nativeSol.decision.binding.adapterId, "native-subagent-create");
  for (const [model, effort] of [["gpt-6-astra", "none"]]) {
    const rejected = handleRequest(request("resolve", { model, effort }), { now: NOW });
    assert.equal(rejected.response.reason, "invalid_effort");
    assert.equal(rejected.response.decision, undefined);
  }
  assert.equal(handleRequest(request("resolve", { model: "gpt-6-sol", effort: "max" }), { now: NOW }).response.reason, "resolved");
  assert.equal(handleRequest(request("resolve", { model: "gpt-6-astra" }), { now: NOW }).response.reason, "effort_required");
  assert.equal(handleRequest(request("resolve", { explicitModelRequirement: true }), { now: NOW }).response.reason, "explicit_model_required");
});

test("the example defaults task work to GPT-6 Sol and bounded work to Luna without invented cost ranking", () => {
  const policy = examplePolicy();
  assert.equal(validateCatalog(policy).ok, true);
  assert.equal(Object.hasOwn(policy, "budgets"), false);
  for (const model of Object.values(policy.models)) assert.equal(Object.hasOwn(model, "relativeCostIndex"), false);
  for (const [role, model] of [["implementation", "gpt-6-sol"], ["implementation.hard", "gpt-6-sol"], ["implementation.bounded_fix", "gpt-6-luna"], ["orchestration", "gpt-6-sol"], ["review.primary", "gpt-6-sol"]]) {
    const resolved = handleRequest(request("resolve", { role, harness: "codex", adapterId: "codex-task-create", dispatchKind: "task_create" }), { catalog: policy, now: NOW });
    assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
    assert.equal(resolved.response.decision.selected.model, model);
    assert.equal(resolved.response.decision.selected.effort, "medium");
  }
  const override = handleRequest(request("resolve", { role: "review.primary", harness: "codex", model: "gpt-6-luna", effort: "medium", adapterId: "codex-task-create", dispatchKind: "task_create" }), { catalog: policy, now: NOW });
  assert.equal(override.response.reason, "resolved", JSON.stringify(override.response));
  assert.equal(override.response.decision.selected.model, "gpt-6-luna");
  assert.equal(override.response.decision.selected.effort, "medium");
  const unsupported = handleRequest(request("resolve", { harness: "codex", model: "gpt-6-luna", effort: "ultra", adapterId: "codex-task-create", dispatchKind: "task_create" }), { catalog: policy, now: NOW });
  assert.equal(unsupported.response.reason, "no_eligible_route");
  assert.equal(unsupported.response.rejectedAlternatives[0].reason, "effort_unsupported");
  const invalid = examplePolicy();
  invalid.models.luna.efforts.push("ultra");
  assert.equal(validateCatalog(invalid).reason, "effort_unsupported");
});

test("supported effort enumeration cannot silently choose an operating point", () => {
  const policy = examplePolicy();
  policy.roles.implementation = { tiers: [["astra"]] };
  delete policy.models.astra.effort;
  const missing = handleRequest(request("resolve", { harness: "codex" }), { catalog: policy, now: NOW });
  assert.equal(missing.response.reason, "no_eligible_route");
  assert.equal(missing.response.rejectedAlternatives[0].reason, "effort_selection_required");
  assert.equal(missing.response.decision, undefined);
  const explicit = handleRequest(request("resolve", { harness: "codex", effort: "max" }), { catalog: policy, now: NOW });
  assert.equal(explicit.response.decision.selected.effort, "max");
  policy.models.astra.effort = "high";
  const configured = handleRequest(request("resolve", { harness: "codex" }), { catalog: policy, now: NOW });
  assert.equal(configured.response.decision.selected.effort, "high");
  delete policy.models.astra.effort;
  policy.models.astra.efforts = ["medium"];
  const sole = handleRequest(request("resolve", { harness: "codex" }), { catalog: policy, now: NOW });
  assert.equal(sole.response.decision.selected.effort, "medium");
});

test("contradictory observed native identity cannot replace the requested model or create an unsupported pair", () => {
  const policy = examplePolicy();
  const state = attestedCapability(policy, { carrierId: "codex-astra", adapterId: "native-subagent-create", accountScope: "codex-account", observedModel: "gpt-daybreak-blue-latest" });
  assert.equal(validateState(state).ok, true);
  const resolved = handleRequest(request("resolve", { harness: "codex", model: "gpt-6-astra", effort: "ultra" }), { catalog: policy, state, now: NOW });
  assert.equal(resolved.response.reason, "no_eligible_route");
  assert.equal(resolved.response.rejectedAlternatives[0].reason, "observed_model_mismatch");
  assert.equal(resolved.response.decision, undefined);
});

test("an explicitly configured fallback is disclosed and cannot replace an explicit model request", () => {
  const policy = examplePolicy();
  policy.roles["security.review"] = { tiers: [["daybreak_blue"], ["astra"]] };
  const fields = { role: "security.review", harness: "codex", effort: "max" };
  const fallback = handleRequest(request("resolve", fields), { catalog: policy, now: NOW });
  assert.equal(fallback.response.reason, "resolved", JSON.stringify(fallback.response));
  assert.equal(fallback.response.decision.selected.model, "gpt-6-astra");
  assert.equal(fallback.response.decision.fallback.reason, "configured_model_substitute");
  assert.equal(fallback.response.decision.rejectedAlternatives[0].reason, "daybreak_unavailable");
  const explicit = handleRequest(request("resolve", { ...fields, model: "gpt-daybreak-blue-latest" }), { catalog: policy, now: NOW });
  assert.equal(explicit.response.reason, "no_eligible_route");
  assert.equal(explicit.response.decision, undefined);
  assert.equal(explicit.response.rejectedAlternatives[0].reason, "daybreak_unavailable");
  policy.roles["security.review"] = { tiers: [["daybreak_blue", "astra"]] };
  const sameTier = handleRequest(request("resolve", fields), { catalog: policy, now: NOW });
  assert.equal(sameTier.response.decision.fallback.reason, "configured_model_substitute");

  const state = createEmptyState();
  const admission = admit(policy, state, { ...fields, scopes: { task: "fallback-task" }, forecast: {} });
  assert.equal(admission.decision.fallback.reason, "configured_model_substitute");
  assert.equal(admission.decision.rejectedAlternatives[0].reason, "daybreak_unavailable");
  const identity = dispatchIdentity("native-subagent-create", { accountScope: admission.reservation.binding.accountScope, sessionId: "fallback-session" });
  const claimed = claim(policy, state, admission, { identity });
  const priorRoute = {
    reservationId: admission.reservation.reservationId,
    claimId: claimed.response.claimId,
    carrierId: admission.reservation.selected.carrierId,
    model: admission.reservation.selected.model,
    effort: admission.reservation.selected.effort,
    adapterId: admission.reservation.binding.adapterId,
    adapterVersion: admission.reservation.binding.adapterVersion,
    policyDigest: admission.reservation.policyDigest,
    hostScope: identity.hostScope,
    accountScope: identity.accountScope,
    sessionId: identity.sessionId,
    toolId: identity.toolId,
    toolVersion: identity.toolVersion,
    workClassDigest: admission.reservation.workClassDigest,
  };
  const continuation = {
    ...fields,
    adapterId: "native-subagent-message", dispatchKind: "subagent_message",
    priorRoute, priorWorkClassDigest: admission.reservation.workClassDigest,
    dispatchIdentity: { ...identity, dispatchKind: "subagent_message" },
  };
  const neutral = handleRequest(request("resolve", { ...continuation, budgetEffect: "none", actionId: "fallback-status" }), { catalog: policy, state, now: NOW });
  assert.equal(neutral.response.reason, "resolved", JSON.stringify(neutral.response));
  assert.equal(neutral.response.decision.actionReceipt.fallbackReason, "configured_model_substitute");
  const topup = handleRequest(request("admit", {
    ...continuation, budgetEffect: "adjust_active", requestId: "fallback-topup", activeReservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A, forecast: {}, scopes: { task: "fallback-task" },
  }), { catalog: policy, state, now: NOW });
  assert.equal(topup.response.reason, "active_budget_adjusted", JSON.stringify(topup.response));
  assert.equal(topup.response.actionReceipt.fallbackReason, "configured_model_substitute");
});

test("omitted native adapter fields select and admit a subagent without configuration", () => {
  // Construct the public request directly: the shared factory supplies the
  // very adapter and dispatch fields whose omission this regression covers.
  const fields = { contractVersion: CONTRACT_VERSION, role: "implementation", model: "gpt-6-astra", effort: "max" };
  const state = createEmptyState();
  const resolved = handleRequest({ ...fields, command: "resolve" }, { state, now: NOW });
  assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
  assert.equal(resolved.response.decision.binding.adapterId, "native-subagent-create");
  assert.equal(resolved.response.decision.binding.dispatchKind, "subagent_create");
  assert.equal(resolved.response.decision.binding.contextFork, "none");
  assert.deepEqual(resolved.response.decision.binding.controls, { model: "model", effort: "reasoning_effort" });
  const admitted = handleRequest({ ...fields, command: "admit", requestId: "default-native" }, { state, now: NOW });
  assert.equal(admitted.response.reason, "default_route_no_state", JSON.stringify(admitted.response));
  assert.equal(admitted.response.decision.binding.adapterId, "native-subagent-create");
  assert.equal(admitted.response.claimRequired, false);
  assert.equal(admitted.changed, false);

  const visible = { ...fields, adapterId: "codex-task-create", dispatchKind: "task_create" };
  const explicit = handleRequest({ ...visible, command: "resolve" }, { state, now: NOW });
  assert.equal(explicit.response.decision.binding.adapterId, "codex-task-create");
  const blocked = handleRequest({ ...visible, command: "admit", requestId: "explicit-visible" }, { state, now: NOW });
  assert.equal(blocked.response.reason, "visible_task_authority_required");
});

test("omitted native adapter fields select and admit a subagent for supported configured Codex carriers", () => {
  const cases = [
    ["codex-astra", "gpt-6-astra", "implementation", "max"],
    ["codex-6-sol", "gpt-6-sol", "implementation", "max"],
    ["codex-6-luna", "gpt-6-luna", "implementation.mechanical", "low"],
    ["codex-daybreak-blue", "gpt-daybreak-blue-latest", "implementation", "max"],
  ];
  for (const [carrierId, model, role, effort] of cases) {
    const policy = {
      schemaVersion: 1,
      providers: { codex: { carrierId, executionSurface: "codex", account: "local" } },
      models: { selected: { provider: "codex", carrierId, requestedModel: model, effort } },
      roles: { [role]: { tiers: [["selected"]] } },
    };
    const state = createEmptyState();
    if (carrierId === "codex-daybreak-blue") {
      state.daybreakAvailability = { available: true, checkedAt: new Date(NOW).toISOString() };
      state.daybreakCatalogDigest = policyDigest(policy);
    }
    const context = { catalog: policy, state, now: NOW };
    const fields = { contractVersion: CONTRACT_VERSION, role, model, effort };
    const resolved = handleRequest({ ...fields, command: "resolve" }, context);
    assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
    assert.equal(resolved.response.decision.selected.carrierId, carrierId);
    assert.equal(resolved.response.decision.binding.adapterId, "native-subagent-create", carrierId);
    assert.equal(resolved.response.decision.binding.dispatchKind, "subagent_create", carrierId);
    const admitted = handleRequest({
      ...fields, command: "admit", requestId: "configured-native", frozenInputDigest: DIGEST_A, scopes: { task: "native-task" }, forecast: {},
    }, context);
    assert.equal(admitted.response.reason, "admitted", JSON.stringify(admitted.response));
    assert.equal(admitted.response.reservation.binding.adapterId, "native-subagent-create", carrierId);
    assert.equal(admitted.response.reservation.binding.dispatchKind, "subagent_create", carrierId);
    if (carrierId === "codex-astra") {
      const visible = { ...fields, adapterId: "codex-task-create", dispatchKind: "task_create" };
      assert.equal(handleRequest({ ...visible, command: "resolve" }, context).response.decision.binding.adapterId, "codex-task-create");
      const blocked = handleRequest({
        ...visible, command: "admit", requestId: "configured-visible", frozenInputDigest: DIGEST_A, scopes: { task: "visible-task" }, forecast: {},
      }, context);
      assert.equal(blocked.response.reason, "visible_task_authority_required");
    }
  }
});

test("configured native creation refuses unsupported effort pairs before admission", () => {
  for (const [carrierId, model, role, effort, reason] of [
    ["codex-6-luna", "gpt-6-luna", "implementation.mechanical", "ultra", "effort_unsupported"],
  ]) {
    const policy = {
      schemaVersion: 1,
      providers: { codex: { carrierId, executionSurface: "codex", account: "local" } },
      models: { selected: { provider: "codex", carrierId, requestedModel: model, effort: "low" } },
      roles: { [role]: { tiers: [["selected"]] } },
    };
    const state = createEmptyState();
    const before = structuredClone(state);
    const context = { catalog: policy, state, now: NOW };
    const fields = { contractVersion: CONTRACT_VERSION, role, model, effort };
    for (const adapter of [{ adapterId: "native-subagent-create", dispatchKind: "subagent_create" }]) {
      for (const command of ["resolve", "admit"]) {
        const refused = handleRequest({
          ...fields, ...adapter, command, requestId: "unsupported-native", frozenInputDigest: DIGEST_A, scopes: { task: "native-task" }, forecast: {},
        }, context);
        assert.equal(refused.response.reason, "no_eligible_route", JSON.stringify(refused.response));
        assert.deepEqual(refused.response.rejectedAlternatives, [{ modelAlias: "selected", reason }]);
        assert.equal(refused.changed, false);
        assert.deepEqual(state, before);
      }
    }
  }
});

test("the built-in route supports explicit native allocation and task messages fail closed without a resolver-owned prior route", () => {
  const state = createEmptyState();
  const resolved = handleRequest(request("resolve", { model: "gpt-6-astra", effort: "medium" }), { state, now: NOW });
  assert.equal(resolved.response.ok, true);
  assert.equal(resolved.response.decision.selected.model, "gpt-6-astra");
  assert.equal(resolved.response.decision.selected.effort, "medium");
  assert.equal(resolved.response.decision.fallback, undefined);
  assert.equal(resolved.response.decision.binding.contextFork, "none");
  assert.equal(resolved.changed, false);

  const neutral = handleRequest(request("resolve", {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-one",
  }), { state, now: NOW });
  assert.equal(neutral.response.reason, "prior_route_unknown");

  const adjustment = handleRequest(request("admit", {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "adjust_active", requestId: "message-two", actionId: "message-two",
  }), { state, now: NOW });
  assert.equal(adjustment.response.reason, "prior_route_unknown");
  const visibleCreate = handleRequest(request("admit", {
    adapterId: "codex-task-create", dispatchKind: "task_create", requestId: "visible-default", actionId: undefined,
  }), { state, now: NOW });
  assert.equal(visibleCreate.response.reason, "visible_task_authority_required");
  assert.equal(handleRequest(request("resolve", { runtime: { lunaAvailability: "unavailable" } }), { state, now: NOW }).response.reason, "invalid_runtime");
  assert.equal(handleRequest(request("resolve", { transport: { compatibility: "native_compatible" } }), { state, now: NOW }).response.reason, "invalid_transport");
  const defaultTerminal = handleRequest(request("reconcile", {
    receipt: { kind: "default_terminal", policyDigest: resolved.response.decision.policy.digest, outcomeId: "default-review-outcome", role: "review.deep" },
  }), { state, now: NOW });
  assert.equal(defaultTerminal.response.reason, "default_terminal_reconciled");
  const outcome = state.learningOutcomes["default-review-outcome"];
  assert.equal(outcome.role, "review.deep");
  assert.equal(Object.hasOwn(outcome, "routeEffectBucket"), false);
  assert.equal(Object.values(state.learningAggregates).filter((entry) => entry.kind === "routeEffect").length, 0);
  assert.equal(validateState(state).ok, true);
});

test("no-config task and native spawn defaults use GPT-6 Sol or Luna", () => {
  const task = (fields) => handleRequest(request("resolve", {
    adapterId: "codex-task-create", dispatchKind: "task_create", harness: "codex", ...fields,
  }), { now: NOW }).response;
  const ordinary = task({ role: "implementation" });
  assert.equal(ordinary.reason, "resolved", JSON.stringify(ordinary));
  assert.equal(ordinary.decision.selected.model, "gpt-6-sol");
  assert.equal(ordinary.decision.selected.effort, "medium");
  assert.equal(ordinary.decision.fallback, undefined);

  const hard = task({ role: "implementation.hard" });
  assert.equal(hard.reason, "resolved", JSON.stringify(hard));
  assert.equal(hard.decision.selected.model, "gpt-6-sol");
  assert.equal(hard.decision.selected.effort, "high");

  const highRisk = task({ role: "review", risk: "high" });
  assert.equal(highRisk.reason, "resolved", JSON.stringify(highRisk));
  assert.equal(highRisk.decision.selected.model, "gpt-6-sol");
  assert.equal(highRisk.decision.selected.effort, "high");

  const mechanicalTask = task({ role: "implementation.mechanical" });
  assert.equal(mechanicalTask.reason, "resolved", JSON.stringify(mechanicalTask));
  assert.equal(mechanicalTask.decision.selected.model, "gpt-6-luna");
  assert.equal(mechanicalTask.decision.selected.effort, "low");

  const mechanicalSpawn = handleRequest(request("resolve", { role: "implementation.mechanical" }), { now: NOW }).response;
  assert.equal(mechanicalSpawn.reason, "resolved");
  assert.equal(mechanicalSpawn.decision.selected.model, "gpt-6-luna");
  assert.equal(mechanicalSpawn.decision.selected.effort, "low");
  assert.equal(mechanicalSpawn.decision.binding.adapterId, "native-subagent-create");
});

test("no-config Claude native requests report the harness boundary before Codex model defaults", () => {
  for (const adapterId of ["native-subagent-create", undefined]) {
    for (const harness of ["claude", "codex", undefined]) {
      const resolved = handleRequest(request("resolve", { adapterId, harness }), { now: NOW }).response;
      assert.equal(resolved.reason, harness === "claude" ? "cross_harness_adapter_required" : "resolved", `${adapterId}/${harness}`);
      if (harness === "claude") assert.equal(resolved.decision, undefined);
      else assert.equal(resolved.decision.binding.adapterId, "native-subagent-create");
    }
  }
});

test("high-risk mechanical and bounded task defaults escalate to Sol high", () => {
  for (const role of ["implementation.mechanical", "implementation.bounded_fix"]) {
    for (const risk of ["high", "critical"]) {
      for (const repetition of ["low", "high"]) {
        const resolved = handleRequest(request("resolve", {
          adapterId: "codex-task-create", dispatchKind: "task_create", harness: "codex", role, risk,
          workShape: { ...request("resolve").workShape, repetition },
        }), { now: NOW }).response;
        assert.equal(resolved.reason, "resolved", JSON.stringify(resolved));
        assert.equal(resolved.decision.selected.model, "gpt-6-sol", `${role}/${risk}/${repetition}`);
        assert.equal(resolved.decision.selected.effort, "high", `${role}/${risk}/${repetition}`);
      }
    }
  }
});

test("an omitted adapter honors an explicit native subagent dispatch kind", () => {
  const resolved = handleRequest(request("resolve", {
    adapterId: undefined,
    dispatchKind: "subagent_create",
    role: "implementation",
  }), { now: NOW }).response;
  assert.equal(resolved.reason, "resolved");
  assert.equal(resolved.decision.binding.adapterId, "native-subagent-create");

  const explicitTaskAdapter = handleRequest(request("resolve", {
    adapterId: "codex-task-create",
    dispatchKind: "subagent_create",
    role: "implementation",
  }), { now: NOW }).response;
  assert.equal(explicitTaskAdapter.reason, "adapter_dispatch_mismatch");
});

test("the configured catalog selects Fable for hard Claude work and records an explicit Luna handoff reason", () => {
  const policy = configuredPolicy();
  assert.equal(validateCatalog(policy).ok, true);
  const state = createEmptyState();
  const fable = handleRequest(request("resolve", {
    role: "implementation.hard",
    harness: "claude",
    adapterId: "claude-session-create",
    dispatchKind: "subagent_create",
  }), { catalog: policy, state, now: NOW });
  assert.equal(fable.response.reason, "resolved", JSON.stringify(fable.response));
  assert.equal(fable.response.decision.selected.modelAlias, "fable");
  assert.equal(fable.response.decision.selected.model, "fable");
  assert.equal(fable.response.decision.binding.harness, "claude");
  assert.deepEqual(fable.response.decision.binding.controls, { model: "model", effort: "banner-only" });

  const longRunning = handleRequest(request("resolve", {
    role: "implementation.long-running",
    harness: "claude",
    adapterId: "claude-session-create",
    dispatchKind: "subagent_create",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(longRunning.response.reason, "resolved", JSON.stringify(longRunning.response));
  assert.equal(longRunning.response.decision.selected.modelAlias, "sonnet");

  for (const role of ["implementation.medium", "implementation.long-running"]) {
    const codex = handleRequest(request("resolve", {
      role,
      harness: "codex",
    }), { catalog: policy, state: createEmptyState(), now: NOW });
    assert.equal(codex.response.reason, "resolved", JSON.stringify(codex.response));
    assert.equal(codex.response.decision.selected.modelAlias, "luna");
  }

  const withoutReason = handleRequest(request("resolve", {
    role: "implementation",
    harness: "claude",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(withoutReason.response.reason, "no_eligible_route");
  assert.equal(withoutReason.response.rejectedAlternatives[0].reason, "cross_harness_reason_required");

  const withoutHarness = handleRequest(request("resolve", {
    role: "implementation.hard",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(withoutHarness.response.reason, "no_eligible_route");
  assert.equal(withoutHarness.response.rejectedAlternatives[0].reason, "harness_required");

  const sentinelReason = handleRequest(request("resolve", {
    role: "implementation",
    harness: "codex",
    crossHarnessReason: "not_applicable",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(sentinelReason.response.reason, "invalid_cross_harness_reason");

  const crossHarnessReason = "Use Codex subscription headroom for this bounded implementation.";
  const luna = handleRequest(request("resolve", {
    role: "implementation",
    harness: "claude",
    crossHarnessReason,
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(luna.response.reason, "no_eligible_route", JSON.stringify(luna.response));
  assert.equal(luna.response.rejectedAlternatives.find((item) => item.modelAlias === "luna")?.reason, "cross_harness_adapter_required");

  const unsupportedClaudeHandoff = handleRequest(request("resolve", {
    role: "implementation.hard",
    harness: "codex",
    crossHarnessReason,
    adapterId: "claude-session-create",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(unsupportedClaudeHandoff.response.reason, "no_eligible_route", JSON.stringify(unsupportedClaudeHandoff.response));
  assert.equal(unsupportedClaudeHandoff.response.rejectedAlternatives.find((item) => item.modelAlias === "fable")?.reason, "cross_harness_adapter_required");

  const crossHarnessWithoutReason = handleRequest(request("resolve", {
    role: "implementation.cross-harness",
    harness: "codex",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(crossHarnessWithoutReason.response.reason, "no_eligible_route", JSON.stringify(crossHarnessWithoutReason.response));
  assert.equal(crossHarnessWithoutReason.response.rejectedAlternatives.length > 0, true);
  assert.equal(crossHarnessWithoutReason.response.rejectedAlternatives.every((item) => item.reason === "cross_harness_reason_required"), true);

  const review = handleRequest(request("resolve", { role: "review.code", harness: "codex", adapterId: "codex-task-create", dispatchKind: "task_create" }), {
    catalog: policy,
    state: createEmptyState(),
    now: NOW,
  });
  assert.equal(review.response.reason, "resolved", JSON.stringify(review.response));
  assert.equal(review.response.decision.selected.modelAlias, "sol");
  assert.equal(review.response.decision.selected.effort, "high");
  assert.equal(validBinding(review.response.decision.binding), true);
  const crossFamily = handleRequest(request("resolve", { role: "review.cross_family", harness: "codex", adapterId: "codex-task-create", dispatchKind: "task_create" }), {
    catalog: policy,
    state: createEmptyState(),
    now: NOW,
  });
  assert.equal(crossFamily.response.reason, "resolved", JSON.stringify(crossFamily.response));
  assert.equal(crossFamily.response.decision.selected.modelAlias, "sol");
  const missingHarness = { ...review.response.decision.binding };
  delete missingHarness.harness;
  assert.equal(validBinding(missingHarness), false);
  const missingReason = { ...review.response.decision.binding };
  delete missingReason.crossHarnessReason;
  assert.equal(validBinding(missingReason), false);
});

test("security resolves cache Daybreak availability once per TTL and otherwise retain the standard fallback", async () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-daybreak-cli-")));
  try {
    fs.chmodSync(home, 0o700);
    const configDirectory = path.join(home, ".config", "railyard");
    const stateDirectory = path.join(home, ".local", "state", "railyard");
    privateDirectory(configDirectory);
    privateDirectory(path.join(home, ".local"));
    privateDirectory(path.join(home, ".local", "state"));
    privateDirectory(stateDirectory);
    const configPath = path.join(configDirectory, "model-routing.json");
    const statePath = path.join(stateDirectory, "model-routing-state.json");
    fs.writeFileSync(configPath, JSON.stringify(configuredPolicy()));
    fs.chmodSync(configPath, 0o600);
    const v4 = createEmptyState();
    v4.stateSchemaVersion = 4;
    fs.writeFileSync(statePath, JSON.stringify(v4));
    fs.chmodSync(statePath, 0o600);

    const options = {
      cwd: process.cwd(),
      env: isolatedCliEnvironment(home),
      home,
      now: NOW,
    };
    const securityRequest = request("resolve", { role: "security.review", harness: "codex", adapterId: "codex-task-create", dispatchKind: "task_create" });
    let probeCalls = 0;
    const available = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(available.reason, "resolved", JSON.stringify(available));
    assert.equal(available.decision.selected.model, "gpt-daybreak-blue-latest");
    assert.equal(probeCalls, 1);
    const cached = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(cached.stateSchemaVersion, 5);
    assert.deepEqual(cached.daybreakAvailability, { available: true, checkedAt: new Date(NOW).toISOString() });
    assert.equal(cached.daybreakCatalogDigest, policyDigest(configuredPolicy()));

    const fresh = await runCliAsync(securityRequest, {
      ...options,
      now: NOW + 1,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: false };
      },
    });
    assert.equal(fresh.decision.selected.model, "gpt-daybreak-blue-latest");
    assert.equal(probeCalls, 1);

    const freshLock = `${statePath}.lock`;
    fs.writeFileSync(freshLock, JSON.stringify({ owner: "fresh-cache", pid: process.pid }) + "\n", { mode: 0o600 });
    const unlockedFresh = await runCliAsync(securityRequest, {
      ...options,
      now: NOW + 2,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: false };
      },
    });
    assert.equal(unlockedFresh.decision.selected.model, "gpt-daybreak-blue-latest");
    assert.equal(probeCalls, 1);
    fs.unlinkSync(freshLock);

    const legacyCache = { ...cached };
    delete legacyCache.daybreakCatalogDigest;
    fs.writeFileSync(statePath, JSON.stringify(legacyCache));
    fs.chmodSync(statePath, 0o600);
    const recachedLegacy = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(recachedLegacy.decision.selected.model, "gpt-daybreak-blue-latest");
    assert.equal(probeCalls, 2);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).daybreakCatalogDigest, policyDigest(configuredPolicy()));

    const remoteScope = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "codex",
      adapterId: "codex-task-create",
      dispatchKind: "task_create",
      hostScope: "remote-runner",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(remoteScope.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 2);

    const differentAccount = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "codex",
      adapterId: "codex-task-create",
      dispatchKind: "task_create",
      accountScope: "different-account",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(differentAccount.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 2);

    const changedCatalog = configuredPolicy();
    changedCatalog.providers.codex_daybreak_blue.account = "codex-sub-b";
    const stateMtime = fs.statSync(statePath).mtime;
    fs.writeFileSync(configPath, JSON.stringify(changedCatalog));
    fs.chmodSync(configPath, 0o600);
    const preservedMtime = new Date(stateMtime.getTime() - 1_000);
    fs.utimesSync(configPath, preservedMtime, preservedMtime);
    assert.ok(fs.statSync(configPath).mtimeMs <= fs.statSync(statePath).mtimeMs);
    const accountChanged = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(accountChanged.decision.selected.model, "gpt-daybreak-blue-latest");
    assert.equal(probeCalls, 3);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).daybreakCatalogDigest, policyDigest(changedCatalog));

    const staleForIneligible = JSON.parse(fs.readFileSync(statePath, "utf8"));
    staleForIneligible.daybreakAvailability.checkedAt = new Date(NOW - DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(staleForIneligible));
    fs.chmodSync(statePath, 0o600);
    const wrongHarness = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "claude",
      crossHarnessReason: "review must remain in Claude",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(wrongHarness.reason, "no_eligible_route", JSON.stringify(wrongHarness));
    const privateRoute = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "codex",
      privacy: { locality: "local_only" },
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(privateRoute.reason, "no_eligible_route", JSON.stringify(privateRoute));
    assert.equal(probeCalls, 3);

    cached.daybreakAvailability.checkedAt = new Date(NOW + DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(cached));
    fs.chmodSync(statePath, 0o600);
    const future = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: false };
      },
    });
    assert.equal(future.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 4);

    cached.daybreakAvailability.checkedAt = new Date(NOW - DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(cached));
    fs.chmodSync(statePath, 0o600);
    const unavailable = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: false };
      },
    });
    assert.equal(unavailable.reason, "resolved", JSON.stringify(unavailable));
    assert.equal(unavailable.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 5);

    const staleLockedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    staleLockedState.daybreakAvailability.checkedAt = new Date(NOW - DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(staleLockedState));
    fs.chmodSync(statePath, 0o600);
    const staleLock = `${statePath}.lock`;
    fs.writeFileSync(staleLock, JSON.stringify({ owner: "stale-cache", pid: process.pid }) + "\n", { mode: 0o600 });
    const locked = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(locked.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 5);
    fs.unlinkSync(staleLock);

    const stale = JSON.parse(fs.readFileSync(statePath, "utf8"));
    stale.daybreakAvailability.checkedAt = new Date(NOW - DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(stale));
    fs.chmodSync(statePath, 0o600);
    const unknown = await runCliAsync(securityRequest, {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        throw new Error("fake_probe_failure");
      },
    });
    assert.equal(unknown.reason, "resolved", JSON.stringify(unknown));
    assert.equal(unknown.decision.selected.model, "gpt-6-sol");
    assert.equal(probeCalls, 6);
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).daybreakAvailability.available, null);

    const failedWriteState = JSON.parse(fs.readFileSync(statePath, "utf8"));
    failedWriteState.daybreakAvailability.checkedAt = new Date(NOW - DAYBREAK_AVAILABILITY_TTL_MS).toISOString();
    fs.writeFileSync(statePath, JSON.stringify(failedWriteState));
    fs.chmodSync(statePath, 0o600);
    try {
      const writeFailure = await runCliAsync(securityRequest, {
        ...options,
        daybreakProbe: async () => {
          probeCalls += 1;
          fs.chmodSync(stateDirectory, 0o500);
          return { available: true };
        },
      });
      assert.equal(writeFailure.decision.selected.model, "gpt-6-sol");
      assert.equal(probeCalls, 7);
    } finally {
      fs.chmodSync(stateDirectory, 0o700);
      try { fs.unlinkSync(`${statePath}.lock`); } catch { /* no-op */ }
    }

    const nonSecurity = await runCliAsync(request("resolve", {
      role: "implementation.hard",
      harness: "codex",
      adapterId: "codex-task-create",
      dispatchKind: "task_create",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(nonSecurity.decision.selected.modelAlias, "sol_max");
    assert.equal(probeCalls, 7);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("Daybreak availability state migrates v4 and validates its exact cache record", () => {
  const v4 = createEmptyState();
  v4.stateSchemaVersion = 4;
  assert.equal(validateState(v4).reason, "unsupported_state_schema");
  const migrated = migrateState(v4);
  assert.equal(migrated.stateSchemaVersion, 5);
  assert.equal(validateState(migrated).ok, true);
  for (const availability of [true, false, null]) {
    const state = structuredClone(migrated);
    state.daybreakAvailability = { available: availability, checkedAt: new Date(NOW).toISOString() };
    state.daybreakCatalogDigest = DIGEST_A;
    assert.equal(validateState(state).ok, true);
  }
  for (const invalid of [
    { available: true },
    { available: "true", checkedAt: new Date(NOW).toISOString() },
    { available: true, checkedAt: "not-a-date" },
    { available: true, checkedAt: new Date(NOW).toISOString(), extra: true },
  ]) {
    const state = structuredClone(migrated);
    state.daybreakAvailability = invalid;
    state.daybreakCatalogDigest = DIGEST_A;
    assert.equal(validateState(state).field, "daybreakAvailability");
  }
  const missingCatalogDigest = structuredClone(migrated);
  missingCatalogDigest.daybreakAvailability = { available: true, checkedAt: new Date(NOW).toISOString() };
  assert.equal(validateState(missingCatalogDigest).field, "daybreakCatalogDigest");
  const invalidCatalogDigest = structuredClone(migrated);
  invalidCatalogDigest.daybreakAvailability = { available: true, checkedAt: new Date(NOW).toISOString() };
  invalidCatalogDigest.daybreakCatalogDigest = "not-a-digest";
  assert.equal(validateState(invalidCatalogDigest).field, "daybreakCatalogDigest");
  const orphanCatalogDigest = structuredClone(migrated);
  orphanCatalogDigest.daybreakCatalogDigest = DIGEST_A;
  assert.equal(validateState(orphanCatalogDigest).field, "daybreakCatalogDigest");
});

test("a catalog has one Daybreak provider for its local state cache", () => {
  const policy = configuredPolicy();
  policy.providers.codex_daybreak_blue_b = {
    ...policy.providers.codex_daybreak_blue,
    account: "codex-sub-b",
  };
  policy.models.daybreak_blue_b = {
    ...policy.models.daybreak_blue,
    provider: "codex_daybreak_blue_b",
  };
  assert.equal(validateCatalog(policy).reason, "daybreak_provider_ambiguous");
});

test("a catalog cannot bind Daybreak to another execution surface", () => {
  const policy = configuredPolicy();
  policy.providers.codex_daybreak_blue.executionSurface = "provider_subscription";
  const validation = validateCatalog(policy);
  assert.equal(validation.reason, "fixed_carrier_mismatch");
  assert.equal(validation.alias, "daybreak_blue");
});

test("the fake App Server buffers split and coalesced JSON-RPC requests in order", () => {
  const observed = [];
  const server = fakeAppServer((message) => observed.push(message.id));
  const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const modelList = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "model/list", params: { includeHidden: false } });
  server.child.stdin.write(initialize.slice(0, 12));
  server.child.stdin.write(`${initialize.slice(12)}\n${modelList}\n`);
  assert.deepEqual(observed, [1, 2]);
  assert.deepEqual(server.requests.map((message) => message.id), [1, 2]);
});

test("the Daybreak App Server probe force-kills a TERM-ignoring process before settling", async () => {
  const server = fakeAppServer(() => {});
  const signals = [];
  server.child.kill = (signal) => {
    signals.push(signal);
    server.child.killed = true;
    if (signal === "SIGKILL") server.child.emit("exit", 137);
    return true;
  };
  await assert.rejects(
    probeCodexDaybreak({ spawnProcess: () => server.child, timeoutMs: 1, terminationGraceMs: 1 }),
    /app_server_timeout/,
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(server.child.stdin.destroyed, true);
  assert.equal(server.child.stdout.destroyed, true);
});

test("the Daybreak App Server probe accepts only a visible exact selector and degrades failures", async () => {
  const paged = fakeAppServer((message, child) => {
    if (message.id === 1) child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })}\n`);
    if (message.id === 2) child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { data: [{ id: DAYBREAK_MODEL, hidden: true }], nextCursor: "page-two" } })}\n`);
    if (message.id === 3) child.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, result: { data: [{ model: DAYBREAK_MODEL, hidden: false }] } })}\n`);
  });
  assert.equal(await probeCodexDaybreak({ spawnProcess: () => paged.child }), true);
  assert.deepEqual(paged.requests.map((message) => [message.id, message.method, message.params.cursor]), [
    [1, "initialize", undefined],
    [2, "model/list", undefined],
    [3, "model/list", "page-two"],
  ]);

  const hidden = fakeAppServer((message, child) => {
    if (message.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    if (message.id === 2) child.stdout.write(`${JSON.stringify({ id: 2, result: { data: [{ id: DAYBREAK_MODEL, hidden: true }] } })}\n`);
  });
  assert.equal(await probeCodexDaybreak({ spawnProcess: () => hidden.child }), false);

  const large = fakeAppServer((message, child) => {
    if (message.id === 1) child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
    if (message.id === 2) {
      const response = `${JSON.stringify({ id: 2, result: { data: Array.from({ length: 200_000 }, () => ({})) } })}\n`;
      assert.ok(Buffer.byteLength(response) < MAX_APP_SERVER_RESPONSE_BYTES);
      child.stdout.write(response);
    }
  });
  assert.equal(await probeCodexDaybreak({ spawnProcess: () => large.child }), false);

  const unknownFrom = async (onRequest, timeoutMs = 25) => {
    const server = fakeAppServer(onRequest);
    return probeDaybreakAvailability({ probe: () => probeCodexDaybreak({ spawnProcess: () => server.child, timeoutMs }) });
  };
  assert.deepEqual(await unknownFrom((message, child) => {
    if (message.id === 1) child.stdout.write("null\n");
  }), { available: null });
  assert.deepEqual(await unknownFrom((message, child) => {
    if (message.id === 1) child.stdout.write(`${JSON.stringify({ id: 1 })}\n`);
  }), { available: null });
  assert.deepEqual(await unknownFrom((message, child) => {
    if (message.id === 1) child.stdout.emit("error", new Error("fake_read_failure"));
  }), { available: null });
  assert.deepEqual(await unknownFrom((message, child) => {
    if (message.id === 1) child.stdin.emit("error", new Error("fake_write_failure"));
  }), { available: null });
  assert.deepEqual(await unknownFrom((message, child) => {
    if (message.id === 1) child.stdout.write("x".repeat(MAX_APP_SERVER_RESPONSE_BYTES + 1));
  }), { available: null });
  assert.deepEqual(await unknownFrom(() => {}, 1), { available: null });
});

test("an explicit catalog role exclusion is enforced without inventing a model capability limit", () => {
  const policy = configuredPolicy();
  policy.roles.orchestration = { tiers: [["luna", "sol"]] };
  const resolved = handleRequest(request("resolve", {
    role: "orchestration",
    harness: "codex",
    adapterId: "codex-task-create",
    dispatchKind: "task_create",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
  assert.equal(resolved.response.decision.selected.modelAlias, "sol");
  assert.equal(resolved.response.decision.rejectedAlternatives[0].modelAlias, "luna");
  assert.equal(resolved.response.decision.rejectedAlternatives[0].reason, "role_ineligible");
});



test("the configured catalog gives hard Codex implementation the max-effort Sol route", () => {
  const policy = configuredPolicy();
  const hardCodex = handleRequest(request("resolve", {
    role: "implementation.hard",
    harness: "codex",
    adapterId: "codex-task-create",
    dispatchKind: "task_create",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(hardCodex.response.reason, "resolved", JSON.stringify(hardCodex.response));
  assert.equal(hardCodex.response.decision.selected.modelAlias, "sol_max");
  assert.equal(hardCodex.response.decision.selected.effort, "max");
});

test("attested Claude review routes do not treat unknown model identity as verified", () => {
  const policy = catalog({
    extraProviders: {
      claude: { carrierId: "claude-ce-review", executionSurface: "provider_subscription", account: "claude", locality: "external", retention: "provider_default", harness: "claude" },
    },
    extraModels: {
      opus: { provider: "claude", carrierId: "claude-ce-review", requestedModel: "opus-current", efforts: ["high"], roles: ["review.code"] },
    },
    extraRoles: { "review.code": { tiers: [["opus"]] } },
  });
  const state = attestedCapability(policy, {
    carrierId: "claude-ce-review",
    adapterId: "claude-cli-via-task",
    accountScope: "claude",
    observedModel: "unknown",
  });
  const resolved = handleRequest(request("resolve", {
    callerKind: "compound-engineering",
    role: "review.code",
    harness: "claude",
    adapterId: "claude-cli-via-task",
    dispatchKind: "task_create",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { catalog: policy, state, now: NOW });
  assert.equal(resolved.response.reason, "no_eligible_route");
  assert.equal(resolved.response.rejectedAlternatives[0].reason, "claude_identity_mismatch");
});

test("CE review routes remain restricted to Fable and Opus", () => {
  const policy = catalog({
    extraProviders: {
      claude: { carrierId: "claude-ce-review", executionSurface: "provider_subscription", account: "claude", locality: "external", retention: "provider_default", harness: "claude" },
    },
    extraModels: {
      "sonnet-review": { provider: "claude", carrierId: "claude-ce-review", requestedModel: "sonnet", efforts: ["high"], roles: ["review.code"] },
    },
    extraRoles: { "review.code": { tiers: [["sonnet-review"]] } },
  });
  const state = attestedCapability(policy, {
    carrierId: "claude-ce-review",
    adapterId: "claude-cli-via-task",
    accountScope: "claude",
    observedModel: "sonnet",
  });
  const resolved = handleRequest(request("resolve", {
    callerKind: "compound-engineering",
    role: "review.code",
    harness: "claude",
    adapterId: "claude-cli-via-task",
    dispatchKind: "task_create",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { catalog: policy, state, now: NOW });
  assert.equal(resolved.response.reason, "no_eligible_route");
  assert.equal(resolved.response.rejectedAlternatives[0].reason, "ce_model_restricted");
});

test("catalogs, privacy, and closed CE seams cannot widen routing authority", () => {
  const unsafe = catalog();
  unsafe.models.task_luna.profile = "caller-controlled";
  assert.equal(validateCatalog(unsafe).reason, "unsafe_catalog");

  const privatePolicy = catalog({ privacy: { locality: "local_only", retention: "none" } });
  assert.equal(handleRequest(request("resolve", { privacy: { locality: "external", retention: "provider_default" } }), { catalog: privatePolicy, now: NOW }).response.reason, "no_eligible_route");

  const plan = handleRequest(request("resolve", {
    model: "gpt-6-astra", effort: "medium", callerKind: "compound-engineering",
    ceSeam: { id: "ce-plan.execution", skill: "ce-plan", artifact: { schema: "railyard/ce-plan-execution-input/v1", digest: DIGEST_A } },
  }), { now: NOW });
  assert.equal(plan.response.ok, true, JSON.stringify(plan.response));
  assert.equal(plan.response.decision.executionOverride.seam.id, "ce-plan.execution");

  const incompatible = handleRequest(request("resolve", {
    model: "gpt-6-astra", effort: "medium", callerKind: "compound-engineering",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { now: NOW });
  assert.equal(incompatible.response.reason, "ce_seam_binding_mismatch");
});

test("capability attestation binds evidence facts and configured TTLs", () => {
  const policy = catalog({ discovery: { positiveTtlSeconds: 3600, negativeTtlSeconds: 90, manualRefresh: true } });
  const state = createEmptyState();
  const refresh = request("refresh", {
    capability: { carrierId: "codex-6-luna", adapterId: "codex-task-create", hostScope: "local", accountScope: "plan", state: "host_capability_attested" },
  });
  assert.equal(handleRequest(refresh, { catalog: policy, state, now: NOW }).response.reason, "trusted_attestor_unavailable");
  const refreshed = handleRequest(refresh, { catalog: policy, state, now: NOW, trustedCapabilityAttestor: refreshAttestor({ observedModel: "gpt-6-luna" }) });
  assert.equal(refreshed.response.reason, "capability_refreshed");
  const evidence = Object.values(state.capabilities)[0];
  assert.equal(evidence.resolvedModelDigest, stableDigest("gpt-6-luna"));
  assert.equal(evidence.expiresAt, "2026-08-04T12:30:00.000Z");

  const tooLong = handleRequest(refresh, { catalog: policy, state: createEmptyState(), now: NOW, trustedCapabilityAttestor: refreshAttestor({ observedModel: "gpt-6-luna", expiresAt: "2026-08-05T12:00:00.000Z" }) });
  assert.equal(tooLong.response.reason, "invalid_trusted_attestation");
});

test("negative capability caches use reason classes, capped Retry-After, and policy-bound unsupported invalidation", () => {
  const policy = oraclePolicy();
  const state = createEmptyState();
  const fixtures = [
    ["transient", "transient_failure", 9_999, 180],
    ["auth", "auth_context_unavailable", undefined, 120],
    ["binary", "oracle_not_installed", undefined, 600],
    ["unsupported", "unsupported_adapter", 9_999, 3600],
  ];
  for (const [suffix, negativeReason, retryAfterSeconds, expectedSeconds] of fixtures) {
    const refreshed = handleRequest(request("refresh", {
      capability: {
        carrierId: "oracle-browser",
        adapterId: "oracle-browser",
        hostScope: `cache-${suffix}`,
        accountScope: "standard",
        state: "unavailable",
        negativeReason,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      },
    }), { catalog: policy, state, now: NOW });
    assert.equal(refreshed.response.reason, "capability_refreshed", JSON.stringify(refreshed.response));
    const evidence = Object.values(state.capabilities).find((item) => item.hostScope === `cache-${suffix}`);
    assert.equal(evidence.negativeClass, suffix === "binary" ? "missing_binary" : suffix);
    assert.equal(evidence.notBefore, new Date(NOW + expectedSeconds * 1000).toISOString());
    if (retryAfterSeconds !== undefined) assert.equal(evidence.retryAfterSeconds, 180);
    if (suffix === "unsupported") assert.equal(evidence.invalidation, "policy_or_adapter_digest");
  }
  const blocked = handleRequest(request("resolve", {
    role: "review.deep", adapterId: "oracle-browser", dispatchKind: "subagent_create", hostScope: "cache-unsupported", accountScope: "standard",
  }), { catalog: policy, state, now: NOW + 2 * 24 * 60 * 60 * 1000 });
  assert.equal(blocked.response.reason, "no_eligible_route");
  assert.equal(blocked.response.rejectedAlternatives[0].reason, "unsupported_adapter");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("rates bind the resolved model, carrier, effort, and billing surface", () => {
  const invalid = catalog({ rates: true });
  delete invalid.models.task_luna.rates[0].resolvedModelDigest;
  assert.equal(validateCatalog(invalid).reason, "invalid_model");

  const policy = catalog({ rates: true });
  const resolved = handleRequest(request("resolve", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
  }), { catalog: policy, state: attestedCapability(policy), now: NOW });
  assert.equal(resolved.response.decision.selected.modelAlias, "task_luna");

  policy.models.task_luna.rates[0].resolvedModelDigest = DIGEST_B;
  assert.equal(validateCatalog(policy).reason, "rate_binding_mismatch");
});

test("learning separates route-independent demand from route effects, gates samples, and never relaxes hard admission", () => {
  const policy = catalog();
  const state = createEmptyState();
  for (let index = 0; index < 5; index += 1) {
    const admission = admit(policy, state, {
      requestId: `learning-${index}`,
      scopes: { task: `learning-task-${index}` },
      risk: "high",
      contextClass: "fixture",
    });
    const claimed = claim(policy, state, admission, { identity: dispatchIdentity("native-subagent-create", { sessionId: `learning-session-${index}` }) });
    const receipt = baseReceipt(claimed.response.reservation, claimed.identity, {
      receiptId: `learning-receipt-${index}`,
      outcomeId: `learning-outcome-${index}`,
      measuredUsage: { marginalUsd: "2" },
      verification: "passed",
      rating: 5,
    });
    const settled = handleRequest(request("reconcile", {
      reservationId: admission.reservation.reservationId,
      frozenInputDigest: DIGEST_A,
      receipt,
    }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
    assert.ok(["reconciled", "ceiling_breached"].includes(settled.response.reason), JSON.stringify(settled.response));
  }
  const base = Object.values(state.learningAggregates).find((entry) => entry.kind === "baseDemand");
  const route = Object.values(state.learningAggregates).find((entry) => entry.kind === "routeEffect");
  assert.equal(base.role, "implementation");
  assert.equal(base.risk, "high");
  assert.equal(base.contextClass, "fixture");
  assert.equal(base.count, 5);
  assert.equal(base.forecastInfluenceByMeter.marginalUsd, 0.2);
  assert.equal(route.carrierId, "codex-astra");
  assert.equal(route.carrierVersion, CARRIER_DESCRIPTORS["codex-astra"].version);
  assert.equal(route.billingSurface, "codex");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));

  const learnedPolicy = catalog({ budgets: { task: { marginalUsd: { soft: "10" } } } });
  learnedPolicy.roles["implementation.mechanical"] = { tiers: [{ models: ["luna", "task_luna"], softPriorities: ["learnedEstimate"] }] };
  const selectionState = attestedCapability(learnedPolicy);
  const shape = request("resolve").workShape;
  const baseBucket = stableDigest({ role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape });
  const task_lunaRouteBucket = stableDigest({
    baseBucket,
    resolvedModel: "gpt-6-luna",
    carrierId: "codex-6-luna",
    carrierVersion: CARRIER_DESCRIPTORS["codex-6-luna"].version,
    effort: "xhigh",
    billingSurface: "codex",
  });
  selectionState.learningAggregates.learning_base_fixture = {
    kind: "baseDemand", baseBucket, role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape,
    count: 5, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 5, ratingTotal: 25,
    usageTotals: { marginalUsd: "6" }, forecastTotals: { marginalUsd: "5" }, forecastInfluenceByMeter: { marginalUsd: 0.2 }, updatedAt: "2026-08-04T12:00:00.000Z",
  };
  selectionState.learningAggregates.learning_task_luna_fixture = {
    kind: "routeEffect", baseBucket, routeEffectBucket: task_lunaRouteBucket, role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape,
    carrierId: "codex-6-luna", carrierVersion: CARRIER_DESCRIPTORS["codex-6-luna"].version, effort: "xhigh", billingSurface: "codex", resolvedModelBucket: stableDigest({ carrierId: "codex-6-luna", model: "gpt-6-luna" }),
    count: 5, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 5, ratingTotal: 25, tieBreakInfluence: 0.2, updatedAt: "2026-08-04T12:00:00.000Z",
  };
  assert.equal(validateState(selectionState).ok, true, JSON.stringify(validateState(selectionState)));
  const task_lunaAuthority = {
    authorityId: "learning-task_luna-authority", objectiveEpoch: "learning-epoch", objectiveDigest: DIGEST_A, senderOwner: "learning-owner", accountScope: "plan", carrierId: "codex-6-luna", adapterId: "codex-task-create", policyDigest: policyDigest(learnedPolicy),
    destinationScope: "local", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "learning-turn", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_A,
  };
  mintAuthority(learnedPolicy, selectionState, task_lunaAuthority);
  const learned = handleRequest(request("admit", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
    requestId: "learned-selection", frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "learned-task" },
    taskAuthorityId: task_lunaAuthority.authorityId, objectiveEpoch: task_lunaAuthority.objectiveEpoch, objectiveDigest: task_lunaAuthority.objectiveDigest, instructionDigest: task_lunaAuthority.explicitUserInstructionDigest, senderOwner: task_lunaAuthority.senderOwner, destinationScope: "local", destinationClass: "visible_task", currentTurn: task_lunaAuthority.currentTurn,
  }), { catalog: learnedPolicy, state: selectionState, now: NOW });
  assert.equal(learned.response.ok, true, JSON.stringify(learned.response));
  assert.equal(learned.response.decision.selected.modelAlias, "task_luna");
  assert.equal(learned.response.reservation.forecast.marginalUsd, "1.2");
  assert.equal(learned.response.decision.learning.policyOrdering, "unchanged");

  const explicitPolicy = catalog({ budgets: { task: { marginalUsd: { soft: "10" } } } });
  explicitPolicy.roles["implementation.mechanical"] = { tiers: [["luna", "task_luna"]] };
  const explicitState = attestedCapability(explicitPolicy);
  explicitState.learningAggregates = JSON.parse(JSON.stringify(selectionState.learningAggregates));
  const explicit = handleRequest(request("resolve", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
  }), { catalog: explicitPolicy, state: explicitState, now: NOW });
  assert.equal(explicit.response.decision.selected.modelAlias, "luna");

  const hardPolicy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "2" } } } });
  hardPolicy.roles["implementation.mechanical"] = { tiers: [{ models: ["luna", "task_luna"], softPriorities: ["learnedEstimate"] }] };
  const hardState = attestedCapability(hardPolicy);
  hardState.learningAggregates = JSON.parse(JSON.stringify(selectionState.learningAggregates));
  hardState.learningAggregates.learning_base_fixture.forecastInfluenceByMeter.marginalUsd = -0.2;
  const hardAuthority = { ...task_lunaAuthority, authorityId: "hard-task_luna-authority", policyDigest: policyDigest(hardPolicy), explicitUserInstructionDigest: DIGEST_B };
  mintAuthority(hardPolicy, hardState, hardAuthority);
  const hard = handleRequest(request("admit", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
    requestId: "hard-learning", frozenInputDigest: DIGEST_B, forecast: { marginalUsd: "1" }, scopes: { task: "hard-learning-task" },
    taskAuthorityId: hardAuthority.authorityId, objectiveEpoch: hardAuthority.objectiveEpoch, objectiveDigest: hardAuthority.objectiveDigest, instructionDigest: hardAuthority.explicitUserInstructionDigest, senderOwner: hardAuthority.senderOwner, destinationScope: "local", destinationClass: "visible_task", currentTurn: hardAuthority.currentTurn,
  }), { catalog: hardPolicy, state: hardState, now: NOW });
  assert.equal(hard.response.ok, true, JSON.stringify(hard.response));
  assert.equal(hard.response.reservation.forecast.marginalUsd, "1");
});

test("scoped accounting keeps task/run/project namespaces disjoint and freezes the correct scopes", () => {
  const policy = catalog({ budgets: {
    task: { marginalUsd: { hardAdmission: "1" } },
    run: { marginalUsd: { hardAdmission: "1" } },
    project: { marginalUsd: { hardAdmission: "1" } },
  } });
  const state = createEmptyState();
  const first = admit(policy, state, { scopes: { task: "shared" } });
  const second = admit(policy, state, { requestId: "admit-two", frozenInputDigest: DIGEST_B, scopes: { run: "shared" } });
  const firstClaim = claim(policy, state, first, { identity: dispatchIdentity("native-subagent-create", { sessionId: "session-a" }) });
  const secondClaim = claim(policy, state, second, { identity: dispatchIdentity("native-subagent-create", { sessionId: "session-b" }) });
  for (const [admission, claimed, receiptId, digest] of [[first, firstClaim, "receipt-a", DIGEST_A], [second, secondClaim, "receipt-b", DIGEST_B]]) {
    const receipt = baseReceipt(claimed.response.reservation, claimed.identity, { receiptId, frozenInputDigest: digest, measuredUsage: { marginalUsd: "1.1" } });
    const reconciled = handleRequest(request("reconcile", { reservationId: admission.reservation.reservationId, frozenInputDigest: digest, receipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
    assert.equal(reconciled.response.reason, "ceiling_breached");
  }
  assert.equal(Object.keys(state.spendAggregates).length, 2);
  assert.equal(Object.keys(state.budgetEpochs).length, 2);
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("a caller-authored receipt cannot settle a claim; an in-process importer binds its exact identity", () => {
  const policy = catalog();
  const state = createEmptyState();
  const admission = admit(policy, state, { scopes: { task: "receipt-task" } });
  const claimed = claim(policy, state, admission);
  const receipt = baseReceipt(claimed.response.reservation, claimed.identity);
  const blocked = handleRequest(request("reconcile", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt }), { catalog: policy, state, now: NOW });
  assert.equal(blocked.response.reason, "trusted_receipt_importer_unavailable");
  const accepted = handleRequest(request("reconcile", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(accepted.response.reason, "reconciled");
  assert.equal(handleRequest(request("reconcile", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: { ...receipt, sessionId: "other-session" } }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter({ ...receipt, sessionId: "other-session" }) }).response.reason, "receipt_dispatch_identity_mismatch");
});

test("R28 decision, fallback, and settlement disclosures use explicit provenance without task content", () => {
  const policy = catalog();
  const state = createEmptyState();
  const admission = admit(policy, state, { scopes: { task: "r28-task" } });
  const claimed = claim(policy, state, admission);
  const receipt = baseReceipt(claimed.response.reservation, claimed.identity, { receiptId: "r28-receipt", outcomeId: "r28-outcome" });
  const settled = handleRequest(request("reconcile", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    receipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(settled.response.ok, true, JSON.stringify(settled.response));
  const disclosure = settled.response.disclosure;
  for (const section of ["requested", "configured", "observed"]) {
    for (const field of ["provider", "endpointClass", "executionSurface", "billingSurface", "model", "effort"]) {
      assert.ok(Object.hasOwn(disclosure[section], field));
      assert.ok(Object.hasOwn(disclosure[section][field], "value"));
      assert.ok(Object.hasOwn(disclosure[section][field], "provenance"));
    }
  }
  assert.equal(disclosure.route, "settlement");
  assert.equal(disclosure.meters.forecast.provenance, "request");
  assert.equal(disclosure.meters.reservation.provenance, "reservation");
  assert.equal(disclosure.meters.actual.provenance, "adapter_receipt");
  assert.equal(disclosure.meters.charged.value, "not_applicable");
  assert.equal(disclosure.escalation.state.value, "not_requested");
  assert.ok(!JSON.stringify(disclosure).includes("task content"));

  const replay = handleRequest(request("reconcile", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    receipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(replay.response.reason, "reconciliation_replayed");
  assert.deepEqual(replay.response.disclosure, disclosure);
});

test("visible task authority is checked before admission and is bound to destination, turn, and maximum use", () => {
  const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "2" } } } });
  const state = createEmptyState();
  const authority = {
    authorityId: "authority-one", objectiveEpoch: "epoch-one", objectiveDigest: DIGEST_A, senderOwner: "owner-one", accountScope: "local", carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
    destinationScope: "host-one", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "turn-one", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_B,
  };
  const rawAuthority = handleRequest(request("admit", {
    adapterId: "codex-task-create", dispatchKind: "task_create", requestId: "raw-authority", frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "visible-scope" },
    authority, objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-one", destinationClass: "visible_task", currentTurn: "turn-one",
  }), { catalog: policy, state, now: NOW });
  assert.equal(rawAuthority.response.reason, "raw_task_authority_forbidden");
  const absentAuthority = handleRequest(request("admit", {
    adapterId: "codex-task-create", dispatchKind: "task_create", requestId: "absent-authority", frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "visible-scope" },
    objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-one", destinationClass: "visible_task", currentTurn: "turn-one",
  }), { catalog: policy, state, now: NOW });
  assert.equal(absentAuthority.response.reason, "visible_task_authority_required");
  mintAuthority(policy, state, authority);
  const admission = admit(policy, state, {
    adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "visible-scope" }, taskAuthorityId: authority.authorityId,
    objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-one", destinationClass: "visible_task", currentTurn: "turn-one",
  });
  const identity = dispatchIdentity("codex-task-create", { hostScope: "host-one", sessionId: "task-session" });
  const wrongAuthority = handleRequest(request("claim-dispatch", {
    reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, dispatchIdentity: identity, taskAuthorityId: "other-authority",
  }), { catalog: policy, state, now: NOW });
  assert.equal(wrongAuthority.response.reason, "visible_task_authority_required");
  assert.equal(state.taskAuthority[authority.authorityId].usedTaskCount, 0);
  const claimed = claim(policy, state, admission, { identity, fields: { taskAuthorityId: authority.authorityId } });
  assert.equal(claimed.response.reason, "dispatch_claimed");
  assert.equal(state.taskAuthority[authority.authorityId].usedTaskCount, 1);
  assert.ok(state.taskAuthority[authority.authorityId].consumedAt);
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("visible bridge acknowledgement and activation bind the exact fixed task identity", () => {
  const policy = catalog();
  const state = createEmptyState();
  const transportAttestor = () => ({
    attestorId: "railyard-transport-attestor-v1",
    attestationDigest: DIGEST_A,
    compatibility: "bridge_required",
    bridgeAvailable: true,
  });
  const authority = {
    authorityId: "bridge-authority-one", objectiveEpoch: "bridge-epoch", objectiveDigest: DIGEST_A, senderOwner: "bridge-owner", accountScope: "local", carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
    destinationScope: "bridge-host", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "bridge-turn", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_A,
  };
  mintAuthority(policy, state, authority);
  const bootstrap = handleRequest(request("admit", {
    adapterId: "codex-task-create", dispatchKind: "task_create", requestId: "bridge-bootstrap", frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "bridge-bootstrap-task" },
    taskAuthorityId: authority.authorityId, objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: authority.destinationScope, destinationClass: authority.destinationClass, currentTurn: authority.currentTurn,
    hostScope: "bridge-host", accountScope: "local",
  }), { catalog: policy, state, now: NOW, trustedTransportAttestor: transportAttestor });
  assert.equal(bootstrap.response.reason, "admitted", JSON.stringify(bootstrap.response));
  assert.equal(bootstrap.response.decision.binding.bridgePhase, "bootstrap");
  const identity = dispatchIdentity("codex-task-create", { hostScope: "bridge-host", sessionId: "bridge-session" });
  const bootstrapClaim = handleRequest(request("claim-dispatch", {
    reservationId: bootstrap.response.reservation.reservationId, frozenInputDigest: DIGEST_A, dispatchIdentity: identity, taskAuthorityId: authority.authorityId,
  }), { catalog: policy, state, now: NOW });
  assert.equal(bootstrapClaim.response.reason, "dispatch_claimed");
  const bridgeReceipt = baseReceipt(bootstrapClaim.response.reservation, identity, {
    receiptId: "bridge-ack", status: "bridge_acknowledged", measuredUsage: {}, identityVerified: true, acknowledgementVerified: true,
  });
  const acknowledged = handleRequest(request("reconcile", {
    reservationId: bootstrap.response.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: bridgeReceipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(bridgeReceipt) });
  assert.equal(acknowledged.response.reason, "reconciled");

  const activationAuthority = { ...authority, authorityId: "bridge-authority-two", explicitUserInstructionDigest: DIGEST_B };
  mintAuthority(policy, state, activationAuthority);
  const activation = handleRequest(request("admit", {
    adapterId: "codex-task-create", dispatchKind: "task_create", requestId: "bridge-activation", frozenInputDigest: DIGEST_B, forecast: { marginalUsd: "1" }, scopes: { task: "bridge-activation-task" },
    bridgeLifecycleId: bootstrapClaim.response.reservation.bridgeLifecycleId,
    taskAuthorityId: activationAuthority.authorityId, objectiveEpoch: activationAuthority.objectiveEpoch, objectiveDigest: activationAuthority.objectiveDigest, instructionDigest: activationAuthority.explicitUserInstructionDigest, senderOwner: activationAuthority.senderOwner, destinationScope: activationAuthority.destinationScope, destinationClass: activationAuthority.destinationClass, currentTurn: activationAuthority.currentTurn,
    hostScope: "bridge-host", accountScope: "local",
  }), { catalog: policy, state, now: NOW, trustedTransportAttestor: transportAttestor });
  assert.equal(activation.response.reason, "admitted", JSON.stringify(activation.response));
  assert.equal(activation.response.decision.binding.bridgePhase, "activation");
  const wrong = handleRequest(request("claim-dispatch", {
    reservationId: activation.response.reservation.reservationId, frozenInputDigest: DIGEST_B,
    dispatchIdentity: dispatchIdentity("codex-task-create", { hostScope: "bridge-host", sessionId: "other-bridge-session" }), taskAuthorityId: activationAuthority.authorityId,
  }), { catalog: policy, state, now: NOW });
  assert.equal(wrong.response.reason, "bridge_dispatch_identity_mismatch");
  const activated = handleRequest(request("claim-dispatch", {
    reservationId: activation.response.reservation.reservationId, frozenInputDigest: DIGEST_B, dispatchIdentity: identity, taskAuthorityId: activationAuthority.authorityId,
  }), { catalog: policy, state, now: NOW });
  assert.equal(activated.response.reason, "dispatch_claimed");
});

test("allocator leases reserve project headroom, cap slots, and release unused capacity without erasing active evidence", () => {
  const policy = catalog({ budgets: { project: { marginalUsd: { hardAdmission: "3" } } } });
  const state = createEmptyState();
  const admission = admit(policy, state, { hostScope: "child-one", accountScope: "local", scopes: { task: "child-task" } });
  const lease = {
    leaseId: "lease-one", issuerScope: "allocator-one", allocatorScopes: { project: "project-one" }, destinationScope: "child-one", destinationAccountScope: "local", epochId: "epoch-one", expiresAt: "2026-08-05T12:00:00.000Z",
    carrierId: "codex-astra", adapterId: "native-subagent-create", ceiling: { marginalUsd: "2" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
  };
  assert.equal(handleRequest(request("issue-lease", { lease }), { catalog: policy, state, now: NOW }).response.reason, "lease_issued");
  assert.equal(handleRequest(request("issue-lease", { lease: { ...lease, leaseId: "lease-two", ceiling: { marginalUsd: "2" } } }), { catalog: policy, state, now: NOW }).response.reason, "hard_budget_exceeded");
  assert.equal(handleRequest(request("accept-lease", { hostScope: "child-one", accountScope: "local", lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW }).response.reason, "lease_accepted");
  const identity = dispatchIdentity("native-subagent-create", { hostScope: "child-one", sessionId: "child-session" });
  assert.equal(handleRequest(request("claim-slot", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, hostScope: "wrong-host", accountScope: "local", dispatchIdentity: { ...identity, hostScope: "wrong-host" }, lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW }).response.reason, "lease_unavailable");
  assert.equal(handleRequest(request("claim-slot", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, hostScope: "child-one", accountScope: "wrong-account", dispatchIdentity: { ...identity, accountScope: "wrong-account" }, lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW }).response.reason, "lease_unavailable");
  const slotted = handleRequest(request("claim-slot", { reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, hostScope: "child-one", accountScope: "local", dispatchIdentity: identity, lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW });
  assert.equal(slotted.response.reason, "delegated_slot_claimed");
  assert.equal(state.leases["lease-one"].slotsClaimed, 1);
  assert.equal(handleRequest(request("release-lease", { hostScope: "child-one", accountScope: "local", lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW }).response.reason, "lease_released");
  policy.providers.codex.locality = "same_region";
  const replayInput = request("claim-slot", {
    reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A,
    hostScope: "child-one", accountScope: "local", dispatchIdentity: identity,
    lease: { leaseId: "lease-one", destinationScope: "child-one", destinationAccountScope: "local" },
  });
  const beforeReplay = structuredClone(state);
  const replay = handleRequest(replayInput, { catalog: policy, state, now: NOW });
  assert.equal(replay.response.reason, "delegated_slot_replayed", JSON.stringify(replay.response));
  assert.equal(replay.changed, false);
  assert.deepEqual(state, beforeReplay, "replaying a released lease cannot consume another slot");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("terminal receipts cannot reopen settled work, and an epoch cannot seal across active lease work", () => {
  const policy = catalog({ budgets: { project: { marginalUsd: { hardAdmission: "8" } } } });
  const state = createEmptyState();
  const first = admit(policy, state, { requestId: "epoch-first", hostScope: "epoch-child", accountScope: "local", scopes: { task: "epoch-first-task" } });
  const second = admit(policy, state, { requestId: "epoch-second", frozenInputDigest: DIGEST_B, hostScope: "epoch-child", accountScope: "local", scopes: { task: "epoch-second-task" } });
  const lease = {
    leaseId: "epoch-lease", issuerScope: "epoch-allocator", allocatorScopes: { project: "epoch-project" }, destinationScope: "epoch-child", destinationAccountScope: "local", epochId: "epoch-one", expiresAt: "2026-08-05T12:00:00.000Z",
    carrierId: "codex-astra", adapterId: "native-subagent-create", ceiling: { marginalUsd: "4" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
  };
  assert.equal(handleRequest(request("issue-lease", { lease }), { catalog: policy, state, now: NOW }).response.reason, "lease_issued");
  assert.equal(handleRequest(request("accept-lease", { hostScope: "epoch-child", accountScope: "local", lease: { leaseId: lease.leaseId, destinationScope: "epoch-child", destinationAccountScope: "local" } }), { catalog: policy, state, now: NOW }).response.reason, "lease_accepted");
  const firstIdentity = dispatchIdentity("native-subagent-create", { hostScope: "epoch-child", sessionId: "epoch-session-one" });
  const claimed = handleRequest(request("claim-slot", {
    reservationId: first.reservation.reservationId, frozenInputDigest: DIGEST_A, hostScope: "epoch-child", dispatchIdentity: firstIdentity,
    accountScope: "local", lease: { leaseId: lease.leaseId, destinationScope: "epoch-child", destinationAccountScope: "local" },
  }), { catalog: policy, state, now: NOW });
  assert.equal(claimed.response.reason, "delegated_slot_claimed");
  assert.equal(handleRequest(request("seal-epoch", { epochId: "epoch-one" }), { catalog: policy, state, now: NOW }).response.reason, "epoch_active_allocations");

  const settledReceipt = baseReceipt(claimed.response.reservation, firstIdentity, { receiptId: "epoch-settled", outcomeId: "epoch-outcome" });
  const settled = handleRequest(request("reconcile", {
    reservationId: first.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: settledReceipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(settledReceipt) });
  assert.equal(settled.response.reason, "reconciled");
  const terminalNoStart = baseReceipt(claimed.response.reservation, firstIdentity, { receiptId: "epoch-no-start", status: "no_start", measuredUsage: {} });
  const rejectedTerminal = handleRequest(request("reconcile", {
    reservationId: first.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: terminalNoStart,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(terminalNoStart) });
  assert.equal(rejectedTerminal.response.reason, "invalid_receipt_transition");

  assert.equal(handleRequest(request("seal-epoch", { epochId: "epoch-one" }), { catalog: policy, state, now: NOW }).response.reason, "epoch_sealed");
  assert.equal(handleRequest(request("seal-epoch", { epochId: "epoch-one" }), { catalog: policy, state, now: NOW }).response.reason, "epoch_already_sealed");
  const secondIdentity = dispatchIdentity("native-subagent-create", { hostScope: "epoch-child", sessionId: "epoch-session-two" });
  const postSeal = handleRequest(request("claim-slot", {
    reservationId: second.reservation.reservationId, frozenInputDigest: DIGEST_B, hostScope: "epoch-child", dispatchIdentity: secondIdentity,
    accountScope: "local", lease: { leaseId: lease.leaseId, destinationScope: "epoch-child", destinationAccountScope: "local" },
  }), { catalog: policy, state, now: NOW });
  assert.equal(postSeal.response.reason, "lease_unavailable");
  assert.equal(handleRequest(request("issue-lease", { lease: { ...lease, leaseId: "epoch-lease-two" } }), { catalog: policy, state, now: NOW }).response.reason, "budget_epoch_sealed");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("create-to-message routing inherits only the exact model, effort, policy, and approved adapter transition", () => {
  const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "5" } } } });
  const state = createEmptyState();
  const authority = {
    authorityId: "authority-msg", objectiveEpoch: "epoch-msg", objectiveDigest: DIGEST_A, senderOwner: "owner-msg", accountScope: "local", carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
    destinationScope: "host-msg", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "turn-msg", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_B,
  };
  mintAuthority(policy, state, authority);
  const admission = admit(policy, state, { adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "message-task" }, taskAuthorityId: authority.authorityId, objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-msg", destinationClass: "visible_task", currentTurn: "turn-msg" });
  const created = claim(policy, state, admission, { identity: dispatchIdentity("codex-task-create", { hostScope: "host-msg", sessionId: "task-msg" }), fields: { taskAuthorityId: authority.authorityId } });
  const priorRoute = {
    reservationId: admission.reservation.reservationId,
    claimId: created.response.claimId,
    carrierId: "codex-astra",
    model: "gpt-6-astra",
    effort: "max",
    adapterId: "codex-task-create",
    adapterVersion: "v1",
    policyDigest: policyDigest(policy),
    hostScope: "host-msg",
    accountScope: "local",
    sessionId: "task-msg",
    toolId: "codex-task",
    toolVersion: "v1",
    workClassDigest: admission.reservation.workClassDigest,
  };
  const neutral = handleRequest(request("resolve", {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-neutral", priorRoute,
    priorWorkClassDigest: admission.reservation.workClassDigest,
    dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }) },
  }), { catalog: policy, state, now: NOW });
  assert.equal(neutral.response.reason, "resolved");
  const crossedDestination = handleRequest(request("resolve", {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-crossed", priorRoute,
    priorWorkClassDigest: admission.reservation.workClassDigest,
    dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "wrong-session" }) },
  }), { catalog: policy, state, now: NOW });
  assert.equal(crossedDestination.response.reason, "prior_destination_identity_mismatch");
  const adjustment = handleRequest(request("admit", {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "adjust_active", requestId: "message-adjust", activeReservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "message-task" }, priorRoute,
    priorWorkClassDigest: admission.reservation.workClassDigest,
    dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }) },
  }), { catalog: policy, state, now: NOW });
  assert.equal(adjustment.response.reason, "active_budget_adjusted");
});

test("a GPT-6 visible task can change effort through an active task-message adjustment only", () => {
  const policy = catalog({
    budgets: { task: { marginalUsd: { hardAdmission: "5" } } },
    extraProviders: {
      codex_astra: { carrierId: "codex-astra", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default" },
    },
    extraModels: {
      astra: { provider: "codex_astra", carrierId: "codex-astra", requestedModel: "gpt-6-astra", effort: "medium", efforts: ["low", "medium", "high"], roles: ["implementation"], relativeCostIndex: 10 },
    },
    extraRoles: { implementation: { tiers: [{ models: ["astra"], softPriorities: ["cost"] }] } },
  });
  const state = createEmptyState();
  const authority = {
    authorityId: "authority-gpt6-effort", objectiveEpoch: "epoch-gpt6-effort", objectiveDigest: DIGEST_A, senderOwner: "owner-gpt6-effort", accountScope: "local", carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
    destinationScope: "host-gpt6-effort", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "turn-gpt6-effort", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_B,
  };
  mintAuthority(policy, state, authority);
  const admission = admit(policy, state, {
    model: "gpt-6-astra", effort: "low", adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "gpt6-effort-task" }, taskAuthorityId: authority.authorityId,
    objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner,
    destinationScope: "host-gpt6-effort", destinationClass: "visible_task", currentTurn: "turn-gpt6-effort",
  });
  const identity = dispatchIdentity("codex-task-create", { hostScope: "host-gpt6-effort", sessionId: "task-gpt6-effort" });
  const created = claim(policy, state, admission, { identity, fields: { taskAuthorityId: authority.authorityId } });
  const priorRoute = {
    reservationId: admission.reservation.reservationId, claimId: created.response.claimId, carrierId: "codex-astra", model: "gpt-6-astra", effort: "low",
    adapterId: "codex-task-create", adapterVersion: "v1", policyDigest: policyDigest(policy), hostScope: identity.hostScope, accountScope: identity.accountScope,
    sessionId: identity.sessionId, toolId: identity.toolId, toolVersion: identity.toolVersion, workClassDigest: admission.reservation.workClassDigest,
  };
  const baseAdjustment = {
    adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "adjust_active", activeReservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "gpt6-effort-task" }, priorWorkClassDigest: admission.reservation.workClassDigest,
    dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-gpt6-effort", sessionId: "task-gpt6-effort" }) },
  };
  const secondAuthority = {
    ...authority,
    authorityId: "authority-gpt6-effort-second", objectiveEpoch: "epoch-gpt6-effort-second", senderOwner: "owner-gpt6-effort-second",
    destinationScope: "host-gpt6-effort-second", currentTurn: "turn-gpt6-effort-second",
  };
  mintAuthority(policy, state, secondAuthority);
  const secondAdmission = admit(policy, state, {
    requestId: "gpt6-effort-second-task", model: "gpt-6-astra", effort: "low", adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "gpt6-effort-task" }, taskAuthorityId: secondAuthority.authorityId,
    objectiveEpoch: secondAuthority.objectiveEpoch, objectiveDigest: secondAuthority.objectiveDigest, instructionDigest: secondAuthority.explicitUserInstructionDigest, senderOwner: secondAuthority.senderOwner,
    destinationScope: secondAuthority.destinationScope, destinationClass: "visible_task", currentTurn: secondAuthority.currentTurn,
  });
  const secondIdentity = dispatchIdentity("codex-task-create", { hostScope: "host-gpt6-effort-second", sessionId: "task-gpt6-effort-second" });
  claim(policy, state, secondAdmission, { identity: secondIdentity, fields: { taskAuthorityId: secondAuthority.authorityId } });
  const crossReservation = handleRequest(request("admit", {
    ...baseAdjustment, requestId: "gpt6-cross-reservation", actionId: "gpt6-cross-reservation", activeReservationId: secondAdmission.reservation.reservationId,
    model: "gpt-6-astra", effort: "high", priorRoute,
  }), { catalog: policy, state, now: NOW });
  assert.equal(crossReservation.response.reason, "prior_route_binding_mismatch");
  assert.equal(state.reservations[secondAdmission.reservation.reservationId].forecast.marginalUsd, "1");
  const omittedEffort = (route, suffix) => request("admit", {
    ...baseAdjustment, requestId: `gpt6-omitted-effort-${suffix}`, actionId: `gpt6-omitted-effort-${suffix}`, priorRoute: route,
  });
  const beforeOmittedLow = structuredClone(state);
  assert.equal(handleRequest(omittedEffort(priorRoute, "low"), { catalog: policy, state, now: NOW }).response.reason, "prior_route_binding_mismatch");
  assert.deepEqual(state, beforeOmittedLow);
  const raisedInput = request("admit", { ...baseAdjustment, requestId: "gpt6-effort-high", actionId: "gpt6-effort-high", model: "gpt-6-astra", effort: "high", priorRoute });
  const raised = handleRequest(raisedInput, { catalog: policy, state, now: NOW });
  assert.equal(raised.response.reason, "active_budget_adjusted", JSON.stringify(raised.response));
  assert.deepEqual(raised.response.actionReceipt.requested, { model: "gpt-6-astra", effort: "high" });
  assert.deepEqual(raised.response.reservation.binding.controls, { model: "model", effort: "thinking" });
  assert.equal(state.reservations[admission.reservation.reservationId].currentRoute.selected.effort, "high");
  assert.equal(state.reservations[admission.reservation.reservationId].forecast.marginalUsd, "2");
  // A copied prior adjustment must not let the replay fast path charge a
  // different active reservation.
  state.reservations[secondAdmission.reservation.reservationId].adjustments = {
    [raisedInput.requestId]: structuredClone(state.reservations[admission.reservation.reservationId].adjustments[raisedInput.requestId]),
  };
  assert.equal(handleRequest({ ...raisedInput, activeReservationId: secondAdmission.reservation.reservationId }, { catalog: policy, state, now: NOW }).response.reason, "prior_route_binding_mismatch");
  delete state.reservations[secondAdmission.reservation.reservationId].adjustments;

  assert.equal(state.reservations[admission.reservation.reservationId].routeLearningEligible, false);
  assert.equal(state.reservations[admission.reservation.reservationId].selected.effort, "low");
  const secondPriorRoute = { ...priorRoute, effort: "high" };
  const beforeOmittedHigh = structuredClone(state);
  assert.equal(handleRequest(omittedEffort(secondPriorRoute, "high"), { catalog: policy, state, now: NOW }).response.reason, "prior_route_binding_mismatch");
  assert.deepEqual(state, beforeOmittedHigh);
  const loweredInput = request("admit", { ...baseAdjustment, requestId: "gpt6-effort-medium", actionId: "gpt6-effort-medium", model: "gpt-6-astra", effort: "medium", priorRoute: secondPriorRoute });
  const lowered = handleRequest(loweredInput, { catalog: policy, state, now: NOW });
  assert.equal(lowered.response.reason, "active_budget_adjusted", JSON.stringify(lowered.response));
  assert.equal(state.reservations[admission.reservation.reservationId].currentRoute.selected.effort, "medium");
  assert.equal(state.reservations[admission.reservation.reservationId].forecast.marginalUsd, "3");
  assert.equal(handleRequest(loweredInput, { catalog: policy, state, now: NOW }).response.reason, "active_adjustment_replayed");

  for (const phase of ["started", "settled", "no_start", "ambiguous"]) {
    const replayState = structuredClone(state);
    const active = replayState.reservations[admission.reservation.reservationId];
    const receipt = baseReceipt(active, identity, { receiptId: `effort-replay-${phase}`, status: phase, measuredUsage: phase === "settled" ? { marginalUsd: "1" } : {} });
    const reconciled = handleRequest(request("reconcile", {
      reservationId: active.reservationId, frozenInputDigest: active.frozenInputDigest, receipt,
    }), { catalog: policy, state: replayState, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
    assert.equal(reconciled.response.ok, true, JSON.stringify(reconciled.response));
    assert.equal(replayState.reservations[active.reservationId].phase, phase);
    const beforeReplay = structuredClone(replayState);
    const replay = handleRequest(loweredInput, { catalog: policy, state: replayState, now: NOW });
    assert.equal(replay.response.reason, phase === "started" ? "active_adjustment_replayed" : "active_attempt_unknown", phase);
    assert.deepEqual(replayState, beforeReplay);
  }

  const currentPriorRoute = { ...priorRoute, effort: "medium" };
  const modelChange = handleRequest(request("admit", { ...baseAdjustment, requestId: "gpt6-model-change", actionId: "gpt6-model-change", model: "gpt-6-luna", effort: "max", priorRoute: currentPriorRoute }), { catalog: policy, state, now: NOW });
  assert.equal(modelChange.response.reason, "no_eligible_route");
  const subagentFollowup = handleRequest(request("admit", { ...baseAdjustment, requestId: "gpt6-subagent-followup", actionId: "gpt6-subagent-followup", model: "gpt-6-astra", effort: "high", adapterId: "native-subagent-followup", dispatchKind: "subagent_followup", priorRoute: currentPriorRoute }), { catalog: policy, state, now: NOW });
  assert.equal(subagentFollowup.response.reason, "no_eligible_route");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("work-class inheritance is exact and neutral or active adjustments emit idempotent closed receipts", () => {
  const policy = catalog();
  const state = createEmptyState();
  const readiness = r52Readiness();
  const admission = admit(policy, state, { r52: readiness, scopes: { task: "work-class-task", run: "work-class-run", project: "work-class-project" } });
  const identity = dispatchIdentity("native-subagent-create", { sessionId: "work-class-session" });
  const claimed = claim(policy, state, admission, { identity });
  const workClassDigest = admission.reservation.workClassDigest;
  const priorRoute = {
    reservationId: admission.reservation.reservationId,
    claimId: claimed.response.claimId,
    carrierId: admission.reservation.selected.carrierId,
    model: admission.reservation.selected.model,
    effort: admission.reservation.selected.effort,
    adapterId: admission.reservation.binding.adapterId,
    adapterVersion: admission.reservation.binding.adapterVersion,
    policyDigest: admission.reservation.policyDigest,
    hostScope: identity.hostScope,
    accountScope: identity.accountScope,
    sessionId: identity.sessionId,
    toolId: identity.toolId,
    toolVersion: identity.toolVersion,
    workClassDigest,
    r52Digest: admission.reservation.binding.r52.digest,
  };
  const messageIdentity = dispatchIdentity("native-subagent-message", { sessionId: identity.sessionId });
  const neutralInput = request("resolve", {
    adapterId: "native-subagent-message",
    dispatchKind: "subagent_message",
    budgetEffect: "none",
    actionId: "work-class-neutral",
    priorRoute,
    priorWorkClassDigest: workClassDigest,
    dispatchIdentity: messageIdentity,
    r52: readiness,
  });
  const neutral = handleRequest(neutralInput, { catalog: policy, state, now: NOW });
  assert.equal(neutral.response.reason, "resolved", JSON.stringify(neutral.response));
  const neutralReceipt = neutral.response.decision.actionReceipt;
  assert.deepEqual(Object.keys(neutralReceipt).sort(), ["actionDigest", "actionId", "actual", "adapter", "budget", "capability", "fallbackReason", "inheritanceReason", "priorRouteDigest", "priorWorkClassDigest", "r52Digest", "reason", "requested", "schema", "startsWork", "workClassDigest"].sort());
  assert.equal(neutralReceipt.startsWork, false);
  assert.equal(neutralReceipt.inheritanceReason, "intentional_same_class_inheritance");
  assert.equal(neutralReceipt.fallbackReason, "not_applicable");
  assert.equal(neutralReceipt.r52Digest, admission.reservation.binding.r52.digest);
  assert.equal(neutralReceipt.workClassDigest, workClassDigest);
  assert.equal(neutralReceipt.priorWorkClassDigest, workClassDigest);
  assert.equal(neutralReceipt.priorRouteDigest, stableDigest(priorRoute));
  assert.deepEqual(neutralReceipt.adapter, { adapterId: "native-subagent-message", adapterVersion: "v1", dispatchKind: "subagent_message" });
  assert.deepEqual(neutralReceipt.requested, { model: "gpt-6-astra", effort: "max" });
  assert.equal(neutralReceipt.budget, "not_applicable");
  assert.deepEqual(handleRequest(neutralInput, { catalog: policy, state, now: NOW }).response.decision.actionReceipt, neutralReceipt);
  assert.equal(handleRequest({ ...neutralInput, workClassDigest: DIGEST_A }, { catalog: policy, state, now: NOW }).response.reason, "work_class_digest_mismatch");
  assert.equal(handleRequest(request("resolve", {
    adapterId: "native-subagent-message", dispatchKind: "subagent_message", budgetEffect: "none", actionId: "work-class-unknown", priorRoute, dispatchIdentity: messageIdentity, r52: readiness,
  }), { catalog: policy, state, now: NOW }).response.reason, "prior_work_class_unknown");
  assert.equal(handleRequest(request("resolve", {
    adapterId: "native-subagent-message", dispatchKind: "subagent_message", budgetEffect: "none", actionId: "work-class-changed", priorRoute, priorWorkClassDigest: workClassDigest, dispatchIdentity: messageIdentity, r52: readiness,
    workShape: { ...request("resolve").workShape, semanticRisk: "high" },
  }), { catalog: policy, state, now: NOW }).response.reason, "prior_work_class_changed_requires_fresh_route");

  const adjustmentInput = request("admit", {
    adapterId: "native-subagent-message",
    dispatchKind: "subagent_message",
    budgetEffect: "adjust_active",
    requestId: "work-class-adjust",
    actionId: "work-class-adjust-action",
    frozenInputDigest: DIGEST_B,
    activeReservationId: admission.reservation.reservationId,
    scopes: { task: "work-class-task", run: "work-class-run", project: "work-class-project" },
    forecast: { marginalUsd: "1" },
    priorRoute,
    priorWorkClassDigest: workClassDigest,
    dispatchIdentity: messageIdentity,
    r52: readiness,
  });
  const adjusted = handleRequest(adjustmentInput, { catalog: policy, state, now: NOW });
  assert.equal(adjusted.response.reason, "active_budget_adjusted", JSON.stringify(adjusted.response));
  const adjustmentReceipt = adjusted.response.actionReceipt;
  assert.equal(adjustmentReceipt.actionId, "work-class-adjust-action");
  assert.equal(adjustmentReceipt.startsWork, true);
  assert.equal(adjustmentReceipt.inheritanceReason, "intentional_same_class_inheritance");
  assert.equal(adjustmentReceipt.fallbackReason, "not_applicable");
  assert.deepEqual(adjustmentReceipt.budget, { kind: "top_up", forecast: { marginalUsd: "1" }, warningCount: 0 });
  const replayed = handleRequest(adjustmentInput, { catalog: policy, state, now: NOW });
  assert.equal(replayed.response.reason, "active_adjustment_replayed");
  assert.deepEqual(replayed.response.actionReceipt, adjustmentReceipt);
  assert.equal(ADAPTER_DESCRIPTORS["native-subagent-message"].startsWork, "request-classified");
  assert.deepEqual(ADAPTER_DESCRIPTORS["native-subagent-message"].startsWorkByBudgetEffect, { none: false, adjust_active: true });
  for (const field of ["reason", "inheritanceReason", "fallbackReason"]) {
    const tampered = structuredClone(state);
    tampered.reservations[admission.reservation.reservationId].adjustments[adjustmentInput.requestId].actionReceipt[field] = "arbitrary_valid_id";
    assert.equal(validateState(tampered).reason, "invalid_state", field);
  }
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("bounded context forks and R52 readiness use closed content-free wire forms", () => {
  const policy = catalog();
  const readiness = r52Readiness();
  const resolved = handleRequest(request("resolve", { callerKind: "fleet", contextFork: "3", r52: readiness }), { catalog: policy, now: NOW });
  assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
  assert.equal(resolved.response.decision.binding.contextFork, "3");
  assert.equal(resolved.response.decision.binding.r52.schema, readiness.schema);
  assert.equal(resolved.response.decision.binding.r52.executionHost.identityDigest, readiness.executionHost.identityDigest);
  assert.equal(resolved.response.decision.binding.r52.targetPlatform.identityDigest, readiness.targetPlatform.identityDigest);
  assert.equal(resolved.response.decision.binding.r52.digest, stableDigest(readiness));
  assert.equal(handleRequest(request("resolve", { callerKind: "fleet" }), { catalog: policy, now: NOW }).response.reason, "model_routing_capability_unavailable");
  for (const key of ["hostReadiness", "taskReadiness", "transportReadiness"]) {
    const blocked = { ...readiness, [key]: { ...readiness[key], state: "blocked" } };
    const unknown = { ...readiness, [key]: { ...readiness[key], state: "unknown" } };
    assert.equal(handleRequest(request("resolve", { callerKind: "fleet", r52: blocked }), { catalog: policy, now: NOW }).response.reason, "model_routing_capability_unavailable", key);
    assert.equal(handleRequest(request("resolve", { callerKind: "fleet", r52: unknown }), { catalog: policy, now: NOW }).response.reason, "model_routing_capability_unavailable", key);
  }
  for (const contextFork of ["all", "full-history", "0", "1000", "03", "unknown"]) {
    assert.equal(handleRequest(request("resolve", { contextFork }), { catalog: policy, now: NOW }).response.reason, "invalid_context_fork", contextFork);
  }
  assert.equal(handleRequest(request("resolve", { contextFork: "none" }), { catalog: policy, now: NOW }).response.reason, "resolved");
  assert.equal(handleRequest(request("resolve", { adapterId: "codex-task-create", dispatchKind: "task_create", contextFork: "3" }), { catalog: policy, now: NOW }).response.reason, "invalid_context_fork");
  assert.equal(handleRequest(request("resolve", { r52: { ...readiness, command: "ssh host" } }), { catalog: policy, now: NOW }).response.reason, "invalid_r52_readiness");
  assert.equal(handleRequest(request("resolve", { r52: { ...readiness, targetPlatform: { ...readiness.targetPlatform, platform: "freebsd" } } }), { catalog: policy, now: NOW }).response.reason, "invalid_r52_readiness");
});

test("native and Oracle claims cannot cross their admitted host or account identity", () => {
  const nativePolicy = catalog();
  const nativeState = createEmptyState();
  const nativeAdmission = admit(nativePolicy, nativeState, { requestId: "native-scope-admit", hostScope: "native-host", accountScope: "local" });
  const nativeClaim = (hostScope, accountScope) => handleRequest(request("claim-dispatch", {
    reservationId: nativeAdmission.reservation.reservationId,
    frozenInputDigest: nativeAdmission.reservation.frozenInputDigest,
    dispatchIdentity: dispatchIdentity("native-subagent-create", { hostScope, accountScope, sessionId: "native-scope-session" }),
  }), { catalog: nativePolicy, state: nativeState, now: NOW }).response;
  assert.equal(nativeClaim("other-host", "local").reason, "dispatch_identity_mismatch");
  assert.equal(nativeClaim("native-host", "other-account").reason, "dispatch_identity_mismatch");
  assert.equal(nativeClaim("native-host", "local").reason, "dispatch_claimed");

  const reviewPolicy = oraclePolicy();
  const reviewState = attestedCapability(reviewPolicy, {
    carrierId: "oracle-browser",
    adapterId: "oracle-browser",
    accountScope: "standard",
    observedModel: "chatgpt_current_pro",
  });
  const oracleAdmission = admit(reviewPolicy, reviewState, {
    requestId: "oracle-scope-admit",
    role: "review.deep",
    adapterId: "oracle-browser",
    dispatchKind: "subagent_create",
    hostScope: "local",
    accountScope: "standard",
  });
  const oracleClaim = (hostScope, accountScope) => handleRequest(request("claim-dispatch", {
    reservationId: oracleAdmission.reservation.reservationId,
    frozenInputDigest: oracleAdmission.reservation.frozenInputDigest,
    dispatchIdentity: dispatchIdentity("oracle-browser", { hostScope, accountScope, sessionId: "oracle-scope-session" }),
  }), { catalog: reviewPolicy, state: reviewState, now: NOW }).response;
  assert.equal(oracleClaim("other-host", "standard").reason, "dispatch_identity_mismatch");
  assert.equal(oracleClaim("local", "other-account").reason, "dispatch_identity_mismatch");
  assert.equal(oracleClaim("local", "standard").reason, "dispatch_claimed");
});

test("carrier-neutral invariant work contracts keep six closed presentation overlays", () => {
  const invariantInput = {
    objectiveDigest: DIGEST_A,
    sourceOfTruthDigest: DIGEST_B,
    scopeDigest: "c".repeat(64),
    constraintsDigest: "d".repeat(64),
    authorizationDigest: "e".repeat(64),
    acceptanceDigest: "f".repeat(64),
    stopDigest: "1".repeat(64),
  };
  const fixtures = [
    ["gpt_sol", "codex-6-sol", "gpt-6-sol", "high", "lean, explicit, bounded brief"],
    ["opus", "claude-ce-review", "opus-current", "high", "complete task specification"],
    ["fable", "claude-ce-review", "fable-current", "high", "autonomy and pause boundaries"],
    ["sonnet", "claude-session", "sonnet", "medium", "bounded objective, relevant context"],
    ["haiku", "claude-session", "haiku", "low", "exact mechanical change"],
    ["oracle", "oracle-browser", "chatgpt_current_pro", "high", "complete selected file context"],
  ];
  const built = fixtures.map(([family, carrierId, model, effort, expectedInstruction]) => {
    const output = buildInvariantWorkContract({ ...invariantInput, carrierId, model, effort });
    assert.equal(output.reason, "work_contract_built", JSON.stringify(output));
    assert.equal(output.contract.presentation.family, family);
    assert.deepEqual(Object.keys(output.contract.invariant).sort(), ["acceptanceDigest", "authorizationDigest", "constraintsDigest", "objectiveDigest", "schema", "scopeDigest", "sourceOfTruthDigest", "stopDigest"].sort());
    assert.deepEqual(Object.keys(output.contract.presentation).sort(), ["carrierId", "carrierVersion", "effort", "family", "format", "instructions", "model", "schema"].sort());
    assert.equal(output.contract.presentation.instructions.length, 1);
    assert.match(output.contract.presentation.instructions[0], new RegExp(expectedInstruction));
    return output;
  });
  assert.equal(new Set(built.map((item) => item.contract.invariantDigest)).size, 1);
  assert.equal(new Set(built.map((item) => item.contract.presentationDigest)).size, fixtures.length);
  const invariantDigest = built[0].contract.invariantDigest;
  const fable51 = buildInvariantWorkContract({ ...invariantInput, carrierId: "claude-ce-review", model: "claude-fable-5-1", effort: "max", expectedInvariantDigest: invariantDigest });
  assert.equal(fable51.reason, "work_contract_built", JSON.stringify(fable51));
  assert.equal(fable51.contract.presentation.family, "fable");
  assert.equal(fable51.contract.presentation.model, "claude-fable-5-1");
  assert.equal(fable51.contract.invariantDigest, invariantDigest);
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-6-sol", model: "gpt-6-sol", effort: "high", expectedInvariantDigest: invariantDigest }).reason, "work_contract_built");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, objectiveDigest: "2".repeat(64), carrierId: "codex-6-sol", model: "gpt-6-sol", effort: "high", expectedInvariantDigest: invariantDigest }).reason, "invariant_contract_mutation");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-6-sol", model: "unbound-model", effort: "high" }).reason, "presentation_overlay_mismatch");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-6-sol", model: "gpt-6-sol", effort: "high", prompt: "not metadata" }).reason, "invalid_work_contract");
});

test("Oracle v1 records remain readable and accounted but cannot attest or dispatch v2 controls", () => {
  const policy = oraclePolicy();
  policy.budgets = { task: { marginalUsd: { hardAdmission: "1" } } };
  const state = attestedCapability(policy, { carrierId: "oracle-browser", adapterId: "oracle-browser", accountScope: "standard", observedModel: "gpt-6-pro" });
  const admission = admit(policy, state, {
    role: "review.deep", adapterId: "oracle-browser", requestId: "old-oracle",
    scopes: { task: "old-oracle-budget" }, forecast: { marginalUsd: "1" },
  });
  const identity = dispatchIdentity("oracle-browser", { accountScope: "standard" });
  const claimed = claim(policy, state, admission, { identity });

  // Recreate a durable pre-upgrade record without rewriting its identity or
  // releasing its still-outstanding reservation during the source upgrade.
  for (const capability of Object.values(state.capabilities)) {
    capability.carrierVersion = "v1";
    capability.adapterVersion = "v1";
    capability.observedModel = "gpt-6-sol";
    capability.resolvedModelDigest = stableDigest(capability.observedModel);
    capability.attestedFactsDigest = stableDigest(capabilityFacts(capability, capability));
  }
  const stored = state.reservations[admission.reservation.reservationId];
  for (const selected of [stored.selected, stored.decision.selected]) {
    selected.carrierVersion = "v1";
    selected.adapterVersion = "v1";
  }
  stored.binding.adapterVersion = "v1";
  stored.decision.binding.adapterVersion = "v1";
  stored.claimed.toolVersion = "v1";
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  const before = stableDigest(state);
  const status = handleRequest(request("status"), { catalog: policy, state, now: NOW });
  assert.equal(status.response.reason, "status");
  assert.equal(Object.values(status.response.readiness)[0].state, "unknown");
  assert.equal(Object.values(status.response.readiness)[0].reason, "adapter_version_changed");
  const resolved = handleRequest(request("resolve", { role: "review.deep", adapterId: "oracle-browser" }), { catalog: policy, state, now: NOW });
  assert.equal(resolved.response.reason, "transport_unsupported");
  const claimAgain = handleRequest(request("claim-dispatch", {
    reservationId: stored.reservationId, frozenInputDigest: DIGEST_A, dispatchIdentity: { ...identity, toolVersion: "v1" },
  }), { catalog: policy, state, now: NOW });
  assert.equal(claimAgain.response.reason, "claim_replayed", "the original claimed identity is safe to replay without creating a new dispatch");
  const inspected = handleRequest(request("inspect-claim", { claimId: claimed.response.claimId }), { catalog: policy, state, now: NOW });
  assert.equal(inspected.response.reason, "adapter_version_changed");
  const attemptedSettlement = handleRequest(request("reconcile", {
    reservationId: stored.reservationId, frozenInputDigest: DIGEST_A, receipt: {},
  }), { catalog: policy, state, now: NOW });
  assert.equal(attemptedSettlement.response.reason, "trusted_receipt_importer_unavailable");
  const budget = handleRequest(request("admit", {
    requestId: "other-work", scopes: { task: "old-oracle-budget" }, forecast: { marginalUsd: "1" }, frozenInputDigest: DIGEST_A,
  }), { catalog: policy, state, now: NOW });
  assert.equal(budget.response.reason, "hard_budget_exceeded");
  assert.equal(stableDigest(state), before, "failed new dispatches preserve the historical liability");
});

test("Oracle auth failure is negatively cached and lifecycle success creates a required fresh review", () => {
  const policy = catalog({
    discovery: { positiveTtlSeconds: 3600, negativeTtlSeconds: 90, manualRefresh: true },
    extraProviders: {
      oracle: { carrierId: "oracle-browser", executionSurface: "chatgpt_standard", account: "standard", locality: "external", retention: "provider_default" },
      lifecycle: { carrierId: "oracle-homebrew-lifecycle", executionSurface: "local_host", account: "local", locality: "local_only", retention: "none" },
    },
    extraModels: {
      oracle: { provider: "oracle", carrierId: "oracle-browser", requestedModel: "chatgpt_current_pro", efforts: ["high"], roles: ["review.deep"] },
      lifecycle: { provider: "lifecycle", carrierId: "oracle-homebrew-lifecycle", requestedModel: "oracle-homebrew-lifecycle", efforts: ["high"], roles: ["lifecycle.oracle"] },
    },
    extraRoles: { "review.deep": { tiers: [["oracle"]] }, "lifecycle.oracle": { tiers: [["lifecycle"]] } },
  });
  const state = createEmptyState();
  for (const [carrierId, adapterId, accountScope, observedModel] of [["oracle-browser", "oracle-browser", "standard", "chatgpt_current_pro"], ["oracle-homebrew-lifecycle", "oracle-homebrew-lifecycle", "local", "oracle-homebrew-lifecycle"]]) {
    const refreshed = handleRequest(request("refresh", { capability: { carrierId, adapterId, hostScope: "local", accountScope, state: "host_capability_attested" } }), { catalog: policy, state, now: NOW, trustedCapabilityAttestor: refreshAttestor({ observedModel }) });
    assert.equal(refreshed.response.reason, "capability_refreshed", JSON.stringify(refreshed.response));
  }
  const review = admit(policy, state, { role: "review.deep", adapterId: "oracle-browser", dispatchKind: "subagent_create", scopes: { task: "oracle-task" }, forecast: {} });
  const reviewIdentity = dispatchIdentity("oracle-browser", { accountScope: "standard", sessionId: "oracle-session" });
  const reviewClaim = claim(policy, state, review, { identity: reviewIdentity });
  const oracleReceipt = baseReceipt(reviewClaim.response.reservation, reviewIdentity, {
    receiptId: "oracle-receipt", producer: "oracle-browser", measuredUsage: {}, measuredBilled: false,
    requestedModel: "chatgpt_current_pro", adapterModelControl: "gpt-6-sol", documentedProductLabel: "GPT-6 Sol + Pro thinking", observedModel: "unknown", executionSurface: "chatgpt_standard",
    chargedMeters: { marginalUsd: 0, codexCredits: 0, openaiApiSpend: 0 }, originalHostDigest: DIGEST_A, recordedAt: "2026-08-04T12:00:00.000Z", expiresAt: "2026-08-05T12:00:00.000Z", outputTrusted: false, reason: "auth_context_unavailable", authReadiness: "auth_context_unavailable", retentionClass: "local-private-24h",
  });
  assert.equal(handleRequest(request("reconcile", { reservationId: review.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: oracleReceipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(oracleReceipt) }).response.reason, "reconciled");
  assert.equal(handleRequest(request("resolve", { role: "review.deep", adapterId: "oracle-browser", dispatchKind: "subagent_create", hostScope: "local", accountScope: "standard" }), { catalog: policy, state, now: NOW }).response.reason, "no_eligible_route");

  const lifecycle = admit(policy, state, { requestId: "admit-lifecycle", role: "lifecycle.oracle", adapterId: "oracle-homebrew-lifecycle", dispatchKind: "lifecycle_action", scopes: { task: "lifecycle-task" }, forecast: {} });
  const lifecycleIdentity = dispatchIdentity("oracle-homebrew-lifecycle", { sessionId: "lifecycle-session" });
  const lifecycleClaim = claim(policy, state, lifecycle, { identity: lifecycleIdentity });
  const lifecycleReceipt = baseReceipt(lifecycleClaim.response.reservation, lifecycleIdentity, {
    receiptId: "lifecycle-receipt", producer: "oracle-homebrew-lifecycle", measuredUsage: {}, measuredBilled: false,
    chargedMeters: { marginalUsd: 0, codexCredits: 0, openaiApiSpend: 0 }, originalHostDigest: DIGEST_A, recordedAt: "2026-08-04T12:00:00.000Z", expiresAt: "2026-08-05T12:00:00.000Z", outputTrusted: false, reason: null, freshReviewRequired: true, beforeVersion: "0.17.0", afterVersion: "0.17.1", formula: "steipete/tap/oracle",
  });
  assert.equal(handleRequest(request("reconcile", { reservationId: lifecycle.reservation.reservationId, frozenInputDigest: DIGEST_A, receipt: lifecycleReceipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(lifecycleReceipt) }).response.reason, "reconciled");
  assert.equal(Object.keys(state.lifecycleReviewRequirements).length, 1);
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("the public CLI accepts only a fixed Oracle receipt reference and settles an adapter-emitted private artifact", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-fixed-cli-")));
  try {
    fs.chmodSync(home, 0o700);
    const configDirectory = path.join(home, ".config", "railyard");
    const stateDirectory = path.join(home, ".local", "state", "railyard");
    privateDirectory(configDirectory);
    privateDirectory(path.join(home, ".local"));
    privateDirectory(path.join(home, ".local", "state"));
    privateDirectory(stateDirectory);
    const policy = oraclePolicy();
    const configPath = path.join(configDirectory, "model-routing.json");
    fs.writeFileSync(configPath, JSON.stringify(policy));
    fs.chmodSync(configPath, 0o600);

    const root = path.join(home, ".local", "state", "railyard", "oracle-route");
    const prepared = buildOracle({
      contractVersion: CONTRACT_VERSION,
      route: { adapter: "oracle-browser", requestedModel: "chatgpt_current_pro", executionSurface: "chatgpt_standard" },
      authReadiness: "unknown",
      allowUnknownAuth: true,
      retainHours: 1,
      prompt: "Review only the supplied routing fixture.",
      files: [],
      exclusions: [],
    }, { root });

    const refreshed = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "refresh",
      capability: { carrierId: "oracle-browser", adapterId: "oracle-browser", hostScope: "local", accountScope: "standard", state: "host_capability_attested" },
    }, home);
    assert.equal(refreshed.reason, "capability_refreshed", JSON.stringify(refreshed));

    const admitted = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "admit",
      callerKind: "deliver",
      role: "review.deep",
      adapterId: "oracle-browser",
      dispatchKind: "subagent_create",
      requestId: "oracle-cli-admit",
      frozenInputDigest: prepared.frozenInputDigest,
      forecast: {},
      scopes: { task: "oracle-cli-task" },
      hostScope: "local",
      accountScope: "standard",
    }, home);
    assert.equal(admitted.reason, "admitted", JSON.stringify(admitted));
    assert.equal(admitted.decision.capability.provenance, "measured_fact");

    const identity = {
      hostScope: "local",
      accountScope: "standard",
      dispatchKind: "subagent_create",
      sessionId: prepared.sessionId,
      toolId: "oracle-browser",
      toolVersion: "v2",
    };
    const claimed = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "claim-dispatch",
      reservationId: admitted.reservation.reservationId,
      frozenInputDigest: prepared.frozenInputDigest,
      dispatchIdentity: identity,
    }, home);
    assert.equal(claimed.reason, "dispatch_claimed", JSON.stringify(claimed));

    const oracleHome = path.join(root, "oracle-home");
    const oracleSessions = path.join(oracleHome, "sessions");
    const oracleSession = path.join(oracleSessions, oracleSessionSlug(prepared.sessionId));
    privateDirectory(oracleHome);
    privateDirectory(oracleSessions);
    privateDirectory(oracleSession);
    fs.writeFileSync(path.join(oracleSession, "meta.json"), JSON.stringify({
      model: "gpt-6-pro",
      browser: {
        config: { desiredModel: "Latest", modelStrategy: "select", thinkingTime: "pro" },
        modelSelection: {
          requestedModel: "Latest",
          resolvedLabel: "Latest",
          strategy: "select",
          status: "switched",
          verified: true,
          source: "chatgpt-model-picker",
        },
      },
    }), { mode: 0o600 });
    fs.writeFileSync(path.join(oracleSession, "output.log"), "[browser] Thinking time: Pro (already selected)\nAnswer:\nFixture finding.\n", { mode: 0o600 });

    const receipt = dispatchOracle({
      contractVersion: CONTRACT_VERSION,
      route: { adapter: "oracle-browser", requestedModel: "chatgpt_current_pro", executionSurface: "chatgpt_standard" },
      authReadiness: "unknown",
      allowUnknownAuth: true,
      retainHours: 1,
      prompt: "Review only the supplied routing fixture.",
      files: [],
      exclusions: [],
      sessionId: prepared.sessionId,
      frozenInputDigest: prepared.frozenInputDigest,
      claimId: claimed.claimId,
      reservationId: admitted.reservation.reservationId,
      policyDigest: policyDigest(policy),
      timeoutMs: 10_000,
    }, {
      root,
      inspectClaim: (input) => runCli(input, {
        home,
        env: isolatedCliEnvironment(home),
        trustedEmbedding: true,
        trustedPathOverrides: true,
      }),
      resolveCarrier: () => ({ binary: "/usr/bin/true", version: "0.20.3" }),
      revalidateCarrier: () => "/usr/bin/true",
      run: () => ({ status: 0, stdout: "Fixture finding.\n", stderr: "" }),
    });
    assert.equal(receipt.status, "settled");
    assert.equal(receipt.reason, null);
    assert.equal(receipt.observedModel, "gpt-6-pro");

    const rawRejected = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "reconcile",
      reservationId: admitted.reservation.reservationId,
      frozenInputDigest: prepared.frozenInputDigest,
      receipt,
    }, home);
    assert.equal(rawRejected.ok, false);

    const settled = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "reconcile",
      reservationId: admitted.reservation.reservationId,
      frozenInputDigest: prepared.frozenInputDigest,
      receipt: { receiptId: receipt.receiptId },
    }, home);
    assert.equal(settled.reason, "reconciled", JSON.stringify(settled));
    assert.equal(settled.disclosure.schema, "railyard/r28-route-disclosure/v1");
    assert.equal(settled.disclosure.meters.charged.value.marginalUsd, "0");

    const status = publicCli({ contractVersion: CONTRACT_VERSION, command: "status" }, home);
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.ok(Object.values(status.readiness).some((entry) => entry.state === "live_carrier_verified"), JSON.stringify(status));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("public CLI environment and JSON cannot mint visible-task authority or settle native claims", () => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-native-cli-")));
  try {
    fs.chmodSync(home, 0o700);
    const configDirectory = path.join(home, ".config", "railyard");
    const stateDirectory = path.join(home, ".local", "state", "railyard");
    privateDirectory(configDirectory);
    privateDirectory(path.join(home, ".local"));
    privateDirectory(path.join(home, ".local", "state"));
    privateDirectory(stateDirectory);
    const policy = catalog();
    const configPath = path.join(configDirectory, "model-routing.json");
    fs.writeFileSync(configPath, JSON.stringify(policy));
    fs.chmodSync(configPath, 0o600);

    fs.writeFileSync(configPath, JSON.stringify(configuredPolicy()));
    const publicFable = publicCli(request("resolve", {
      role: "implementation.hard",
      harness: "claude",
      adapterId: "claude-session-create",
      dispatchKind: "subagent_create",
    }), home);
    assert.equal(publicFable.reason, "resolved", JSON.stringify(publicFable));
    assert.equal(publicFable.decision.selected.modelAlias, "fable");
    fs.writeFileSync(configPath, JSON.stringify(policy));

    const callerControlledEnv = {
      CODEX_THREAD_ID: "thread-native-e2e",
      CODEX_PERMISSION_PROFILE: "disabled",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "user",
    };
    const authority = {
      authorityId: "native-cli-authority",
      objectiveEpoch: "native-cli-epoch",
      objectiveDigest: DIGEST_A,
      senderOwner: "native-cli-owner",
      accountScope: "local",
      carrierId: "codex-astra",
      adapterId: "codex-task-create",
      policyDigest: policyDigest(policy),
      destinationScope: "native-cli-host",
      destinationClass: "visible_task",
      maxTaskCount: 1,
      currentTurn: "native-cli-turn",
      // The CLI subprocess uses the real clock, so a fixed instant becomes a
      // time bomb; this test needs an unexpired authority to reach the
      // attestor-availability check.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      explicitUserInstructionDigest: DIGEST_B,
    };

    const unavailable = publicCli({ contractVersion: CONTRACT_VERSION, command: "mint-task-authority", authority }, home, callerControlledEnv);
    assert.equal(unavailable.reason, "trusted_task_authority_attestor_unavailable");
    const injected = publicCli({ contractVersion: CONTRACT_VERSION, command: "mint-task-authority", authority, module: "not-an-importer" }, home, callerControlledEnv);
    assert.equal(injected.reason, "unknown_request_field");
    const visibleAdmission = {
      contractVersion: CONTRACT_VERSION,
      command: "admit",
      callerKind: "deliver",
      role: "implementation",
      adapterId: "codex-task-create",
      dispatchKind: "task_create",
      requestId: "native-cli-visible-admit",
      frozenInputDigest: DIGEST_A,
      forecast: {},
      scopes: { task: "native-cli-visible-task" },
      hostScope: "native-cli-host",
      accountScope: "local",
      taskAuthorityId: authority.authorityId,
      objectiveEpoch: authority.objectiveEpoch,
      objectiveDigest: authority.objectiveDigest,
      instructionDigest: authority.explicitUserInstructionDigest,
      senderOwner: authority.senderOwner,
      destinationScope: authority.destinationScope,
      destinationClass: authority.destinationClass,
      currentTurn: authority.currentTurn,
    };
    assert.equal(publicCli(visibleAdmission, home, callerControlledEnv).reason, "transport_unsupported");

    const nativeInput = {
      contractVersion: CONTRACT_VERSION,
      command: "admit",
      callerKind: "fleet",
      role: "implementation",
      adapterId: "native-subagent-create",
      dispatchKind: "subagent_create",
      requestId: "native-cli-mu-admit",
      frozenInputDigest: DIGEST_B,
      forecast: {},
      scopes: { task: "native-cli-mu-task" },
      hostScope: "local",
      accountScope: "local",
      objectiveDigest: DIGEST_A,
      instructionDigest: DIGEST_B,
      r52: r52Readiness(),
    };
    assert.equal(publicCli(nativeInput, home, callerControlledEnv).reason, "transport_unsupported");

    const trustedOptions = {
      home,
      env: isolatedCliEnvironment(home),
      trustedEmbedding: true,
      now: NOW,
    };
    const nativeAdmitted = runCli(nativeInput, trustedOptions);
    assert.equal(nativeAdmitted.reason, "admitted", JSON.stringify(nativeAdmitted));
    const nativeIdentity = dispatchIdentity("native-subagent-create", { sessionId: "native-cli-mu-session" });
    const nativeClaimed = runCli({
      contractVersion: CONTRACT_VERSION,
      command: "claim-dispatch",
      reservationId: nativeAdmitted.reservation.reservationId,
      frozenInputDigest: DIGEST_B,
      dispatchIdentity: nativeIdentity,
    }, trustedOptions);
    assert.equal(nativeClaimed.reason, "dispatch_claimed", JSON.stringify(nativeClaimed));
    const nativeSettled = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "reconcile",
      reservationId: nativeAdmitted.reservation.reservationId,
      frozenInputDigest: DIGEST_B,
      receipt: { appToolEvidence: {
        schema: "railyard/app-tool-evidence/v1",
        receiptId: "native-cli-mu-receipt",
        status: "settled",
        controllerThreadId: callerControlledEnv.CODEX_THREAD_ID,
        permissionProfile: callerControlledEnv.CODEX_PERMISSION_PROFILE,
        originator: callerControlledEnv.CODEX_INTERNAL_ORIGINATOR_OVERRIDE,
        objectiveDigest: DIGEST_A,
        instructionDigest: DIGEST_B,
        dispatchIdentity: nativeIdentity,
        measuredUsage: {},
        measuredBilled: false,
      } },
    }, home, callerControlledEnv);
    assert.equal(nativeSettled.reason, "receipt_importer_unsupported", JSON.stringify(nativeSettled));
    const persisted = publicCli({ contractVersion: CONTRACT_VERSION, command: "status" }, home, callerControlledEnv);
    assert.equal(persisted.reservations.filter((reservation) => reservation.phase === "claimed").length, 1);

    const task_lunaOnly = catalog();
    task_lunaOnly.roles["implementation.mechanical"] = { tiers: [["task_luna"]] };
    fs.writeFileSync(configPath, JSON.stringify(task_lunaOnly));
    fs.chmodSync(configPath, 0o600);
    const unsupported = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "admit",
      callerKind: "fleet",
      role: "implementation.mechanical",
      adapterId: "codex-task-create",
      dispatchKind: "task_create",
      requestId: "task_luna-public-admit",
      frozenInputDigest: DIGEST_A,
      forecast: {},
      scopes: { task: "task_luna-public-task" },
      hostScope: "local",
      accountScope: "plan",
      r52: r52Readiness(),
    }, home, callerControlledEnv);
    assert.equal(unsupported.reason, "transport_unsupported", JSON.stringify(unsupported));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("protected inspect-claim ignores caller path and XDG overrides", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-inspect-")));
  try {
    fs.chmodSync(directory, 0o700);
    const policy = catalog();
    const state = createEmptyState();
    const admission = admit(policy, state, { requestId: "inspect-admit", scopes: { task: "inspect-task" } });
    const claimed = claim(policy, state, admission, { identity: dispatchIdentity("native-subagent-create", { sessionId: "inspect-session" }) });
    const configDirectory = path.join(directory, "attacker-config");
    const stateDirectory = path.join(directory, "attacker-state");
    privateDirectory(configDirectory);
    privateDirectory(stateDirectory);
    const configPath = path.join(configDirectory, "model-routing.json");
    const statePath = path.join(stateDirectory, "model-routing-state.json");
    fs.writeFileSync(configPath, JSON.stringify(policy));
    fs.writeFileSync(statePath, JSON.stringify(state));
    fs.chmodSync(configPath, 0o600);
    fs.chmodSync(statePath, 0o600);
    const inspected = runCli(request("inspect-claim", {
      claimId: claimed.response.claimId,
      reservationId: admission.reservation.reservationId,
    }), {
      home: directory,
      cwd: process.cwd(),
      env: {
        RAILYARD_MODEL_POLICY_PATH: configPath,
        RAILYARD_MODEL_STATE_PATH: statePath,
        XDG_CONFIG_HOME: configDirectory,
        XDG_STATE_HOME: stateDirectory,
        LOCALAPPDATA: directory,
      },
    });
    assert.notEqual(inspected.reason, "claim_verified", JSON.stringify(inspected));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native defaults resolve current GPT-6 models and explicit Astra never silently falls back", () => {
  for (const role of ["implementation", "implementation.fix", "review", "orchestration", "implementation.mechanical"]) {
    const result = handleRequest(request("resolve", { role }), { now: NOW });
    assert.equal(result.response.reason, "resolved");
    assert.equal(result.response.decision.selected.model, role === "implementation.mechanical" ? "gpt-6-luna" : "gpt-6-sol");
    assert.equal(result.response.decision.binding.adapterId, "native-subagent-create");
  }
  for (const effort of ["low", "medium", "high"]) {
    const result = handleRequest(request("resolve", { model: "gpt-6-astra", effort }), { now: NOW });
    assert.equal(result.response.reason, "resolved");
    assert.equal(result.response.decision.selected.effort, effort);
    assert.equal(result.response.decision.fallback, undefined);
  }
});

test("a stale state lock is broken, a live one still holds", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-lock-")));
  try {
    fs.chmodSync(directory, 0o700);
    const statePath = path.join(directory, "state.json");
    const lock = `${statePath}.lock`;
    const env = { RAILYARD_MODEL_STATE_PATH: statePath };
    const mutate = () => runCli(request("refresh", {
      capability: { carrierId: "oracle-browser", adapterId: "oracle-browser", hostScope: "local", accountScope: "standard", state: "unavailable", negativeReason: "transient_failure" },
    }), { cwd: process.cwd(), env });

    // A live holder is real contention: refuse.
    fs.writeFileSync(lock, JSON.stringify({ owner: "live", pid: process.pid }) + "\n", { mode: 0o600 });
    assert.equal(mutate().reason, "state_lock_held");

    // A dead pid past the TTL is crash residue: break it and proceed. Before
    // recovery existed this wedged every mutating command forever.
    fs.writeFileSync(lock, JSON.stringify({ owner: "dead", pid: 0x7fffffff }) + "\n", { mode: 0o600 });
    const old = Date.now() / 1000 - 3600;
    fs.utimesSync(lock, old, old);
    assert.notEqual(mutate().reason, "state_lock_held");
    assert.equal(fs.existsSync(lock), false);

    // A dead pid *inside* the TTL is still treated as contention.
    fs.writeFileSync(lock, JSON.stringify({ owner: "fresh", pid: 0x7fffffff }) + "\n", { mode: 0o600 });
    assert.equal(mutate().reason, "state_lock_held");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("expired capability records are pruned so refresh cannot grow state without bound", () => {
  const policy = oraclePolicy();
  const state = createEmptyState();
  const refreshHost = (hostScope, now) => handleRequest(request("refresh", {
    capability: { carrierId: "oracle-browser", adapterId: "oracle-browser", hostScope, accountScope: "standard", state: "unavailable", negativeReason: "transient_failure" },
  }), { catalog: policy, state, now });

  for (let index = 0; index < 40; index += 1) {
    assert.equal(refreshHost(`host-${index}`, NOW).response.reason, "capability_refreshed");
  }
  assert.equal(Object.keys(state.capabilities).length, 40);

  // Long after every record expired, one more refresh sweeps the dead ones —
  // previously nothing ever removed a capability and ~2,400 hostScopes wedged
  // writes at the 1 MiB ceiling permanently.
  const later = NOW + 30 * 24 * 60 * 60 * 1000;
  assert.equal(refreshHost("host-fresh", later).response.reason, "capability_refreshed");
  assert.deepEqual(Object.values(state.capabilities).map((item) => item.hostScope), ["host-fresh"]);
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));

  // Negative "unsupported" evidence is honored past expiry, so it survives.
  const unsupported = createEmptyState();
  assert.equal(handleRequest(request("refresh", {
    capability: { carrierId: "oracle-browser", adapterId: "oracle-browser", hostScope: "pinned", accountScope: "standard", state: "unavailable", negativeReason: "unsupported_adapter" },
  }), { catalog: policy, state: unsupported, now: NOW }).response.reason, "capability_refreshed");
  assert.equal(handleRequest(request("refresh", {
    capability: { carrierId: "oracle-browser", adapterId: "oracle-browser", hostScope: "other", accountScope: "standard", state: "unavailable", negativeReason: "transient_failure" },
  }), { catalog: policy, state: unsupported, now: later }).response.reason, "capability_refreshed");
  assert.ok(Object.values(unsupported.capabilities).some((item) => item.hostScope === "pinned"));
});

test("blocked R52 readiness is refused for every caller, not only fleet", () => {
  const blocked = { ...r52Readiness(), hostReadiness: { state: "blocked", evidenceDigest: "1".repeat(64) } };
  for (const callerKind of ["deliver", "fleet", "orchestrate", "thermos"]) {
    const handled = handleRequest(request("resolve", { callerKind, r52: blocked }), { state: createEmptyState(), now: NOW });
    assert.equal(handled.response.reason, "model_routing_capability_unavailable", callerKind);
  }
  // Ready readiness still binds, and omitting it entirely stays fine off-fleet.
  const ready = handleRequest(request("resolve", { callerKind: "deliver", model: "gpt-6-astra", effort: "medium", r52: r52Readiness() }), { state: createEmptyState(), now: NOW });
  assert.equal(ready.response.ok, true, JSON.stringify(ready.response));
  assert.ok(ready.response.decision.binding.r52.digest);
  assert.equal(handleRequest(request("resolve", { callerKind: "deliver", model: "gpt-6-astra", effort: "medium" }), { state: createEmptyState(), now: NOW }).response.ok, true);
});

test("a strict budget meter is reserved and fails closed: no carrier attests enforcement", () => {
  const policy = catalog({ budgets: { task: { marginalUsd: { strict: "1000" } } } });
  const handled = handleRequest(request("admit", {
    requestId: "strict-one", frozenInputDigest: DIGEST_A,
    forecast: { marginalUsd: "1" }, scopes: { task: "strict-task" },
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  // Headroom is ample — the refusal is the missing enforcement attestation.
  assert.equal(handled.response.reason, "strict_limit_unenforceable", JSON.stringify(handled.response));
  assert.equal(handled.response.meter, "marginalUsd");
  assert.ok(handled.response.rejectedAlternatives.some((item) => item.reason === "strict_limit_unenforceable"));
  assert.equal(
    Object.values(CARRIER_DESCRIPTORS).some((carrier) => carrier.enforcedMeters !== undefined),
    false,
    "wire enforcedMeters only onto a carrier that can genuinely attest, then revisit this test",
  );
});

test("state paths fail closed for a selected missing policy and the paired fast-path fixture proves no I/O", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "model-routing-path-")));
  try {
    fs.chmodSync(directory, 0o700);
    const selected = path.join(directory, "selected-policy.json");
    assert.equal(resolvePaths({ home: directory, cwd: process.cwd(), env: { RAILYARD_MODEL_POLICY_PATH: selected } }).ok, true);
    assert.equal(runCli(request("validate"), { cwd: process.cwd(), env: { RAILYARD_MODEL_POLICY_PATH: selected, RAILYARD_MODEL_STATE_PATH: path.join(directory, "state.json") } }).reason, "selected_policy_missing");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const measured = measureFastPath(request("resolve", { model: "gpt-6-astra", effort: "medium" }), { iterations: 9, now: NOW });
  assert.equal(measured.ok, true, JSON.stringify(measured));
  assert.equal(measured.receipt.paired.baseline.toolCalls, 0);
  assert.equal(measured.receipt.paired.routed.stateWrites, 0);
  assert.equal(measured.receipt.paired.delta.tokenDelta, 0);
  assert.equal(measured.receipt.modelEvidence.unchanged, true);
  assert.ok(measured.receipt.receiptBytes <= 4096);
});

test("ancestor safety checks writability, not ownership, while the final config/state directory stays strictly owned", {
  // The checks under test are uid-based (mirroring production's own
  // typeof process.getuid === "function" guard), so there is nothing to
  // assert on a platform without POSIX uids.
  skip: typeof process.getuid !== "function" && "requires POSIX process.getuid",
}, () => {
  const selfUid = process.getuid();
  const otherUid = selfUid + 1;

  // Fakes the stat layer for a synthetic ancestry chain the way the
  // cleanup-codex suite fakes fsApi.lstatSync: keyed by exact path, anything
  // unlisted is "absent" (null), matching safeStat's ENOENT contract — so a
  // test only has to describe the one or two ancestors it cares about.
  const fakeStat = (entries) => (file) => {
    const entry = entries[file];
    if (!entry) return null;
    return {
      uid: entry.uid,
      mode: entry.mode,
      isDirectory: () => entry.isDirectory !== false,
      isSymbolicLink: () => Boolean(entry.isSymbolicLink),
    };
  };

  const candidate = "/Volumes/Data/Users/claire/.config/railyard/model-routing.json";
  const finalDirectory = "/Volumes/Data/Users/claire/.config/railyard";
  const options = { kind: "config", cwd: "/private/tmp/path-safety-cwd-fixture", platform: "darwin" };

  // (a) The field case: a standard macOS secondary-volume layout where
  // /Volumes/Data/Users is admin-owned, mode 755. Two levels above the
  // config directory, it used to fail unexpected_config_directory_owner
  // purely because the admin UID differs from the caller's. 755 has no
  // group/other write bit, so nobody but its own owner can write into it —
  // that is now accepted regardless of who that owner is.
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: selfUid, mode: 0o700 },
    "/Volumes/Data/Users": { uid: otherUid, mode: 0o755 },
  }) }), null);

  // (b) A group-writable ancestor without the sticky bit is still rejected.
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: selfUid, mode: 0o700 },
    "/Volumes/Data/Users": { uid: otherUid, mode: 0o775 },
  }) }), "unsafe_config_ancestor_mode");

  // (c) An other-writable ancestor without the sticky bit is still rejected.
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: selfUid, mode: 0o700 },
    "/Volumes/Data/Users": { uid: otherUid, mode: 0o757 },
  }) }), "unsafe_config_ancestor_mode");

  // (d) A sticky world-writable ancestor (the /tmp shape, mode 1777) is
  // accepted: the sticky bit means only an entry's own owner can remove or
  // rename it, so world-writability there does not let another user replace
  // what the real ancestor holds.
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: selfUid, mode: 0o700 },
    "/Volumes/Data/Users": { uid: otherUid, mode: 0o1777 },
  }) }), null);

  // (e) The final config/state directory is untouched by the relaxation:
  // owned by neither the caller nor root still fails...
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: otherUid, mode: 0o700 },
  }) }), "unexpected_config_directory_owner");
  // ...root ownership of the final directory still passes, same as before...
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: 0, mode: 0o700 },
  }) }), null);
  // ...and a self-owned but group-writable final directory still fails: the
  // stricter final-directory rule never adopted the ancestor relaxation.
  assert.equal(pathSafetyIssue(candidate, { ...options, stat: fakeStat({
    [finalDirectory]: { uid: selfUid, mode: 0o770 },
  }) }), "unsafe_config_directory_mode");
});

test("the learning command family inspects, disables, re-enables, and clears observational state", () => {
  const policy = catalog();
  const state = createEmptyState();
  const fresh = handleRequest(request("learning", { operation: "inspect" }), { catalog: policy, state, now: NOW });
  assert.equal(fresh.response.reason, "learning_status", JSON.stringify(fresh.response));
  assert.equal(fresh.response.enabled, true);
  assert.deepEqual(fresh.response.outcomes, {});
  assert.deepEqual(fresh.response.aggregates, {});
  assert.equal(fresh.changed, false);

  const admission = admit(policy, state, { scopes: { task: "learning-family-task" } });
  const claimed = claim(policy, state, admission);
  const receipt = baseReceipt(claimed.response.reservation, claimed.identity, { receiptId: "learning-family-receipt", outcomeId: "learning-family-outcome" });
  const settled = handleRequest(request("reconcile", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    receipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(settled.response.ok, true, JSON.stringify(settled.response));

  const populated = handleRequest(request("learning", { operation: "inspect" }), { catalog: policy, state, now: NOW });
  assert.ok(Object.hasOwn(populated.response.outcomes, "learning-family-outcome"));
  assert.equal(Object.keys(populated.response.aggregates).length > 0, true);

  const disabled = handleRequest(request("learning", { operation: "disable" }), { catalog: policy, state, now: NOW });
  assert.equal(disabled.response.reason, "learning_disabled");
  assert.equal(disabled.changed, true);
  assert.equal(state.learningControl.disabled, true);
  assert.equal(handleRequest(request("learning", { operation: "inspect" }), { catalog: policy, state, now: NOW }).response.enabled, false);
  assert.equal(handleRequest(request("status"), { catalog: policy, state, now: NOW }).response.learning.enabled, false);

  const enabled = handleRequest(request("learning", { operation: "enable" }), { catalog: policy, state, now: NOW });
  assert.equal(enabled.response.reason, "learning_enabled");
  assert.equal(state.learningControl.disabled, false);
  assert.equal(handleRequest(request("learning", { operation: "inspect" }), { catalog: policy, state, now: NOW }).response.enabled, true);

  const cleared = handleRequest(request("learning", { operation: "clear" }), { catalog: policy, state, now: NOW });
  assert.equal(cleared.response.reason, "learning_cleared");
  assert.equal(cleared.changed, true);
  assert.deepEqual(state.learningOutcomes, {});
  assert.deepEqual(state.learningAggregates, {});
  assert.ok(typeof state.learningControl.clearedAt === "string");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  // Clearing samples never erases the settled accounting evidence beside them.
  assert.equal(state.reservations[admission.reservation.reservationId].phase, "settled");
  assert.equal(handleRequest(request("learning", { operation: "nonsense" }), { catalog: policy, state, now: NOW }).response.reason, "unknown_command");
});

test("build-work-contract reaches the same closed builder through the command dispatch", () => {
  const workContract = {
    objectiveDigest: DIGEST_A,
    sourceOfTruthDigest: DIGEST_B,
    scopeDigest: "c".repeat(64),
    constraintsDigest: "d".repeat(64),
    authorizationDigest: "e".repeat(64),
    acceptanceDigest: "f".repeat(64),
    stopDigest: "1".repeat(64),
    carrierId: "codex-6-sol",
    model: "gpt-6-sol",
    effort: "high",
  };
  const built = handleRequest(request("build-work-contract", { workContract }), { now: NOW });
  assert.equal(built.response.reason, "work_contract_built", JSON.stringify(built.response));
  assert.equal(built.changed, false);
  assert.equal(built.response.contract.presentation.family, "gpt_sol");
  assert.equal(built.response.contract.invariantDigest, buildInvariantWorkContract(workContract).contract.invariantDigest);

  const daybreak = buildInvariantWorkContract({
    ...workContract,
    carrierId: "codex-daybreak-blue",
    model: "gpt-daybreak-blue-latest",
    effort: "ultra",
  });
  assert.equal(daybreak.ok, true, JSON.stringify(daybreak));
  assert.equal(daybreak.contract.presentation.family, "gpt_sol");

  assert.equal(handleRequest(request("build-work-contract"), { now: NOW }).response.reason, "invalid_work_contract");
  assert.equal(handleRequest(request("build-work-contract", { workContract: { ...workContract, prompt: "not metadata" } }), { now: NOW }).response.reason, "invalid_work_contract");
  assert.equal(handleRequest(request("build-work-contract", { workContract: { ...workContract, model: "unbound-model" } }), { now: NOW }).response.reason, "presentation_overlay_mismatch");
  const publicRun = runCli(request("build-work-contract", { workContract }), { cwd: process.cwd(), env: {}, now: NOW, home: os.homedir() });
  assert.equal(publicRun.reason, "work_contract_built", JSON.stringify(publicRun));
});

test("a tampered authority or lease record refuses the whole state document", () => {
  const policy = catalog({ budgets: { project: { marginalUsd: { hardAdmission: "3" } } } });
  const state = createEmptyState();
  const admission = admit(policy, state, { hostScope: "tamper-child", accountScope: "local", scopes: { task: "tamper-task" } });
  const authority = mintAuthority(policy, state, {
    authorityId: "tamper-authority", objectiveEpoch: "tamper-epoch", objectiveDigest: DIGEST_A, senderOwner: "tamper-owner", accountScope: "local",
    carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy), destinationScope: "local", destinationClass: "visible_task",
    maxTaskCount: 1, currentTurn: "tamper-turn", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_A,
  });
  const lease = {
    leaseId: "tamper-lease", issuerScope: "tamper-allocator", allocatorScopes: { project: "project-one" }, destinationScope: "tamper-child", destinationAccountScope: "local",
    epochId: "tamper-epoch-id", expiresAt: "2026-08-05T12:00:00.000Z", carrierId: "codex-astra", adapterId: "native-subagent-create",
    ceiling: { marginalUsd: "2" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
  };
  assert.equal(handleRequest(request("issue-lease", { lease }), { catalog: policy, state, now: NOW }).response.reason, "lease_issued");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));

  for (const [field, value] of [
    ["cooperative", false],
    ["source", "inferred_intent"],
    ["attestorId", "railyard-not-the-attestor-v1"],
    ["maxTaskCount", 0],
    ["usedTaskCount", 2],
    ["destinationClass", "any_destination"],
    ["expiresAt", "2026-08-03T12:00:00.000Z"],
  ]) {
    const tampered = structuredClone(state);
    tampered.taskAuthority[authority.authorityId][field] = value;
    assert.equal(validateState(tampered).reason, "invalid_state", field);
    assert.equal(validateState(tampered).field, "taskAuthority", field);
  }
  const renamed = structuredClone(state);
  renamed.taskAuthority[authority.authorityId].authorityId = "other-authority";
  assert.equal(validateState(renamed).field, "taskAuthority");

  for (const [field, value] of [
    ["cooperative", false],
    ["accepted", "yes"],
    ["maxSlots", 0],
    ["slotsClaimed", 3],
    ["carrierVersion", "invalid version"],
    ["adapterVersion", "invalid version"],
    ["remainingCeiling", { marginalUsd: "5" }],
    ["expiresAt", "2026-08-03T12:00:00.000Z"],
  ]) {
    const tampered = structuredClone(state);
    tampered.leases[lease.leaseId][field] = value;
    assert.equal(validateState(tampered).reason, "invalid_state", field);
    assert.equal(validateState(tampered).field, "leases", field);
  }
  const relabelled = structuredClone(state);
  relabelled.leases[lease.leaseId].leaseId = "other-lease";
  assert.equal(validateState(relabelled).field, "leases");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  assert.equal(admission.reservation.phase, "reserved");
});

test("a mutating command that refuses leaves the caller's state exactly as it found it", () => {
  const policy = catalog();
  const state = createEmptyState();
  const admission = admit(policy, state, { requestId: "rollback-admit", scopes: { task: "rollback-task", run: "rollback-run" } });
  const claimed = claim(policy, state, admission);
  // Settlement walks the reservation's scopes in order and charges each one.
  // Sealing the second scope means the first is already charged when the
  // command refuses — the partial-spend case a commit boundary has to erase.
  state.budgetEpochs[scopeAccountingId({ kind: "run", id: "rollback-run" })] = {
    frozen: true, reason: "manual_seal", sealedAt: "2026-08-04T11:00:00.000Z",
  };
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  const before = stableDigest(state);

  const receipt = baseReceipt(claimed.response.reservation, claimed.identity, { receiptId: "rollback-receipt", outcomeId: "rollback-outcome" });
  const refused = handleRequest(request("reconcile", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    receipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(refused.response.reason, "budget_epoch_sealed", JSON.stringify(refused.response));
  assert.equal(refused.changed, false);
  assert.equal(stableDigest(state), before);
  assert.deepEqual(state.spendAggregates, {});
  assert.equal(state.reservations[admission.reservation.reservationId].phase, "claimed");
  assert.deepEqual(state.learningOutcomes, {});

  delete state.budgetEpochs[scopeAccountingId({ kind: "run", id: "rollback-run" })];
  const settled = handleRequest(request("reconcile", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    receipt,
  }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(settled.response.ok, true, JSON.stringify(settled.response));
  assert.equal(settled.changed, true);
  assert.equal(state.reservations[admission.reservation.reservationId].phase, "settled");
  assert.equal(Object.keys(state.spendAggregates).length, 2);
});


// review.cross_family exists to leave the family: a Codex-side CE review asks a
// CLAUDE model for the independent opinion. Fable is that reviewer. Daybreak is
// the REFUSAL fallback — when the Claude reviewer declines the material (
// low-level, cryptographic, otherwise security-adjacent work it will not
// engage with), a same-family Daybreak review beats no review. Both must be
// eligible under one CE seam for the caller to be able to walk the tiers,
// which is what this pins: the seam admits both, and Fable outranks Daybreak.
function daybreakReady(policy) {
  const state = createEmptyState();
  state.daybreakAvailability = { available: true, checkedAt: new Date(NOW).toISOString() };
  state.daybreakCatalogDigest = policyDigest(policy);
  return state;
}

test("a cross-family review routes to the Claude reviewer through the attested seam", () => {
  const policy = catalog({
    extraProviders: {
      claude_review: { carrierId: "claude-ce-review", executionSurface: "provider_subscription", account: "claude", locality: "external", retention: "provider_default", harness: "claude" },
    },
    extraModels: {
      fable_review: { provider: "claude_review", carrierId: "claude-ce-review", requestedModel: "fable", efforts: ["high"], roles: ["review.cross_family"] },
    },
    extraRoles: { "review.cross_family": { tiers: [["fable_review"]] } },
  });
  const state = attestedCapability(policy, {
    carrierId: "claude-ce-review",
    adapterId: "claude-cli-via-task",
    accountScope: "claude",
    observedModel: "fable",
  });
  const seam = { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } };
  const resolved = handleRequest(request("resolve", {
    callerKind: "compound-engineering",
    role: "review.cross_family",
    harness: "codex",
    crossHarnessReason: "cross-family second opinion on codex-authored work",
    adapterId: "claude-cli-via-task",
    dispatchKind: "task_create",
    ceSeam: seam,
  }), { catalog: policy, state, now: NOW });

  assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
  assert.equal(resolved.response.decision.selected.modelAlias, "fable_review", "Fable is the cross-family reviewer");

  // Deliberately NO carrier fallback on refusal: provider-task-routing.md
  // rejects a provider refusal-fallback outright and allows exactly one retry
  // on the SAME routed model. Tier order could not express it anyway - the
  // schemas carry no refusal signal, so a lower tier would fire on mere
  // unavailability, which is not a refusal.
});

// The refusal fallback has exactly one legitimate trigger. These three cases
// pin it, and the middle one is the whole point: a top carrier that is merely
// UNAVAILABLE must not silently produce a same-family answer to a question that
// asked for a cross-family one.
test("a cross-family review substitutes only on an actual refusal, never on unavailability", () => {
  const policy = catalog({
    extraProviders: {
      claude_review: { carrierId: "claude-ce-review", executionSurface: "provider_subscription", account: "claude", locality: "external", retention: "provider_default", harness: "claude" },
      daybreak: { carrierId: "codex-daybreak-blue", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default", harness: "codex" },
    },
    extraModels: {
      fable_review: { provider: "claude_review", carrierId: "claude-ce-review", requestedModel: "fable", efforts: ["high"], roles: ["review.cross_family"] },
      daybreak_blue: { provider: "daybreak", carrierId: "codex-daybreak-blue", requestedModel: "gpt-daybreak-blue-latest", efforts: ["high"], roles: ["review.cross_family"] },
    },
    extraRoles: {
      "review.cross_family": { tiers: [{ models: ["fable_review"] }, { models: ["daybreak_blue"], afterRefusalOnly: true }] },
    },
  });
  const seam = { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } };
  const base = {
    callerKind: "compound-engineering",
    role: "review.cross_family",
    harness: "codex",
    crossHarnessReason: "cross-family second opinion on codex-authored work",
    ceSeam: seam,
  };
  const claudeReady = attestedCapability(policy, {
    carrierId: "claude-ce-review",
    adapterId: "claude-cli-via-task",
    accountScope: "claude",
    observedModel: "fable",
  });

  // 1. No refusal: the Claude reviewer answers, and nothing is a substitute.
  const normal = handleRequest(request("resolve", { ...base, adapterId: "claude-cli-via-task", dispatchKind: "task_create" }), { catalog: policy, state: claudeReady, now: NOW });
  assert.equal(normal.response.reason, "resolved", JSON.stringify(normal.response));
  assert.equal(normal.response.decision.selected.modelAlias, "fable_review");
  assert.equal(normal.response.decision.fallback?.reason ?? "not_applicable", "not_applicable");

  // 2. THE ONE THAT MATTERS. Claude simply unavailable, no refusal recorded:
  //    the refusal-gated tier stays shut and the resolve FAILS rather than
  //    quietly returning a same-family review.
  const unavailable = handleRequest(request("resolve", base), { catalog: policy, state: daybreakReady(policy), now: NOW });
  assert.equal(unavailable.response.reason, "no_eligible_route", JSON.stringify(unavailable.response));
  assert.equal(
    unavailable.response.rejectedAlternatives.find((item) => item.modelAlias === "daybreak_blue")?.reason,
    "refusal_required",
    "an unavailable top carrier must NOT open the refusal-gated tier",
  );

  // 3. An actual refusal: the substitute is reachable, and the decision says
  //    plainly that it IS a substitute.
  const state = daybreakReady(policy);
  const afterRefusal = handleRequest(request("resolve", { ...base, refusedAliases: ["fable_review"] }), { catalog: policy, state, now: NOW });
  assert.equal(afterRefusal.response.reason, "resolved", JSON.stringify(afterRefusal.response));
  assert.equal(afterRefusal.response.decision.selected.modelAlias, "daybreak_blue");
  assert.equal(afterRefusal.response.decision.fallback.reason, "review_refusal_substitute");
  assert.equal(
    afterRefusal.response.decision.rejectedAlternatives.find((item) => item.modelAlias === "fable_review")?.reason,
    "model_refused",
    "the refused model must be reported as refused, not as unavailable",
  );
});

// relativeCostIndex is normalized WITHIN a meter, so it ranks honestly among
// same-meter models and means nothing across meters. Both halves matter: the
// first is why cost priority is worth configuring at all, the second is why it
// must not silently decide a cross-meter contest with a fabricated comparison.
test("cost ranks within a meter and is not a discriminator across meters", () => {
  const policy = catalog({
    extraProviders: {
      codex_b: { carrierId: "codex-6-sol", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default" },
      // Same carrier as `luna` (so it is genuinely eligible - no attestation
      // gate to reject it for an unrelated reason) but a DIFFERENT meter.
      codex_other: { carrierId: "codex-astra", executionSurface: "codex", account: "other-meter", locality: "external", retention: "provider_default" },
    },
    extraModels: {
      // Same meter as `luna` (account "local"), and far more expensive.
      pricey: { provider: "codex_b", carrierId: "codex-6-sol", requestedModel: "gpt-6-sol", efforts: ["max"], roles: ["implementation"], relativeCostIndex: 900 },
      cheap_other: { provider: "codex_other", carrierId: "codex-astra", requestedModel: "gpt-6-astra", efforts: ["max"], roles: ["implementation.mechanical"], relativeCostIndex: 1 },
    },
    extraRoles: {
      // Deliberately lists the expensive model FIRST, so a pass is cost
      // actually winning rather than list position happening to agree.
      implementation: { tiers: [{ models: ["pricey", "luna"], softPriorities: ["cost"] }] },
      // cheap_other sits on a different meter and is listed second with a far
      // LOWER index (1 vs 50). If the index were compared across meters it
      // would win - that is exactly the bug this pins.
      "implementation.mechanical": { tiers: [{ models: ["luna", "cheap_other"], softPriorities: ["cost"] }] },
    },
  });

  const sameMeter = handleRequest(request("resolve", { role: "implementation" }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(sameMeter.response.reason, "resolved", JSON.stringify(sameMeter.response));
  assert.equal(
    sameMeter.response.decision.selected.modelAlias,
    "luna",
    "within one meter, the cheaper index must win even when listed second",
  );

  const crossMeter = handleRequest(request("resolve", { role: "implementation.mechanical" }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(crossMeter.response.reason, "resolved", JSON.stringify(crossMeter.response));
  assert.equal(
    crossMeter.response.decision.selected.modelAlias,
    "luna",
    "across meters cost decides nothing: list position governs, so the first entry wins despite the far lower index",
  );
});


test("historical retired route state stays readable and authentic receipts settle original accounting", () => {
  for (const retiredAdapter of [false, true]) {
    const policy = catalog({});
    const state = attestedCapability(policy, { carrierId: "codex-astra", adapterId: "native-subagent-create", accountScope: "local", observedModel: "gpt-6-astra" });
    const admission = admit(policy, state);
    const claimed = claim(policy, state, admission);
    const reservation = state.reservations[admission.reservation.reservationId];
    reservation.selected.carrierId = "codex-sol";
    reservation.selected.model = "gpt-5.6-sol";
    reservation.policyDigest = "builtin-model-routing-v2";
    reservation.decision.policyDigest = reservation.policyDigest;
    reservation.decision.selected = structuredClone(reservation.selected);
    state.capabilities.capability_one.carrierId = "codex-sol";
    state.capabilities.capability_one.observedModel = "gpt-5.6-sol";
    state.capabilities.capability_one.resolvedModelDigest = stableDigest("gpt-5.6-sol");
    if (retiredAdapter) {
      reservation.binding.adapterId = "configured-profile-task-create";
      reservation.selected.adapterId = reservation.binding.adapterId;
      reservation.decision.selected.adapterId = reservation.binding.adapterId;
      reservation.decision.binding.adapterId = reservation.binding.adapterId;
    }
    const before = structuredClone(reservation.selected);
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "routing-history-"));
    try {
      const statePath = path.join(directory, "state.json");
      fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
      const loaded = loadStateForCli({ state: { path: statePath }, config: { path: path.join(directory, "catalog.json") } });
      assert.equal(loaded.ok, true, JSON.stringify(loaded));
      assert.deepEqual(loaded.state, state);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    const malformed = structuredClone(state);
    malformed.reservations[reservation.reservationId].forecast.marginalUsd = "invalid";
    assert.equal(validateState(malformed).ok, false, "historical identity does not bypass accounting validation");
    assert.equal(validSelected(reservation.selected), false, "stored retired selections do not validate as live routes");
    const receipt = baseReceipt(reservation, claimed.identity);
    const wrongDestination = { ...receipt, sessionId: "another-task" };
    const refused = handleRequest(request("reconcile", { reservationId: reservation.reservationId, frozenInputDigest: reservation.frozenInputDigest, receipt: wrongDestination }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(wrongDestination) });
    assert.equal(refused.response.reason, "receipt_dispatch_identity_mismatch");
    const settled = handleRequest(request("reconcile", { reservationId: reservation.reservationId, frozenInputDigest: reservation.frozenInputDigest, receipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
    assert.equal(settled.response.ok, true, JSON.stringify(settled.response));
    assert.equal(state.reservations[reservation.reservationId].phase, "settled");
    assert.deepEqual(state.reservations[reservation.reservationId].selected, before, "settlement never relabels old execution");
    assert.equal(state.spendAggregates[scopeAccountingId(reservation.scope)].marginalUsd.hardAccounted, "1");
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
    const replayed = handleRequest(request("reconcile", { reservationId: reservation.reservationId, frozenInputDigest: reservation.frozenInputDigest, receipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
    assert.equal(replayed.response.reason, "reconciliation_replayed");
    assert.equal(state.spendAggregates[scopeAccountingId(reservation.scope)].marginalUsd.hardAccounted, "1");
  }
});

for (const historicalPolicy of ["builtin-model-routing-v1", "builtin-model-routing-gpt6-sol-v2"]) {
  test(`stale continuation re-selection from ${historicalPolicy} uses current rules and preserves the authenticated destination`, () => {
    const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "5" } } } });
    const state = createEmptyState();
    const authority = {
      authorityId: "authority-msg", objectiveEpoch: "epoch-msg", objectiveDigest: DIGEST_A, senderOwner: "owner-msg", accountScope: "local", carrierId: "codex-astra", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
      destinationScope: "host-msg", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "turn-msg", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_B,
    };
    mintAuthority(policy, state, authority);
    const admission = admit(policy, state, { adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "message-task" }, taskAuthorityId: authority.authorityId, objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-msg", destinationClass: "visible_task", currentTurn: "turn-msg" });
    const created = claim(policy, state, admission, { identity: dispatchIdentity("codex-task-create", { hostScope: "host-msg", sessionId: "task-msg" }), fields: { taskAuthorityId: authority.authorityId } });
    const priorRoute = {
      reservationId: admission.reservation.reservationId,
      claimId: created.response.claimId,
      carrierId: "codex-astra",
      model: "gpt-6-astra",
      effort: "max",
      adapterId: "codex-task-create",
      adapterVersion: "v1",
      policyDigest: policyDigest(policy),
      hostScope: "host-msg",
      accountScope: "local",
      sessionId: "task-msg",
      toolId: "codex-task",
      toolVersion: "v1",
      workClassDigest: admission.reservation.workClassDigest,
    };
    const historical = state.reservations[admission.reservation.reservationId];
    historical.policyDigest = historicalPolicy;
    historical.decision.policyDigest = historicalPolicy;
    priorRoute.policyDigest = historicalPolicy;
    const unchangedState = structuredClone(state);
    const unchanged = handleRequest(request("resolve", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-unchanged", priorRoute,
      priorWorkClassDigest: historical.workClassDigest,
      dispatchIdentity: dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }),
    }), { catalog: policy, state, now: NOW });
    assert.equal(unchanged.response.reason, "resolved", JSON.stringify(unchanged.response));
    assert.deepEqual(state, unchangedState, "unchanged allocation resolves without mutating historical state");
    policy.models.luna.efforts = ["high", "max"];
    const effortOnly = handleRequest(request("resolve", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-effort-only", priorRoute,
      effort: "high", priorWorkClassDigest: historical.workClassDigest,
      dispatchIdentity: dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }),
    }), { catalog: policy, state, now: NOW });
    assert.equal(effortOnly.response.reason, "route_reevaluation_required", JSON.stringify(effortOnly.response));
    assert.deepEqual(state, unchangedState, "read-only effort changes cannot mutate historical state");
    historical.selected.carrierId = "retired-native-carrier";
    historical.selected.model = "retired-native-model";
    historical.decision.selected = structuredClone(historical.selected);
    historical.policyDigest = historicalPolicy;
    historical.decision.policyDigest = historical.policyDigest;
    Object.assign(priorRoute, { carrierId: historical.selected.carrierId, model: historical.selected.model, policyDigest: historical.policyDigest });
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
    policy.providers.sol = { carrierId: "codex-6-sol", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default" };
    policy.models.sol = { provider: "sol", carrierId: "codex-6-sol", requestedModel: "gpt-6-sol", effort: "high", efforts: ["high", "max"], roles: ["implementation"], relativeCostIndex: 10 };
    policy.roles.implementation.tiers[0].models = ["sol"];
    const neutral = handleRequest(request("resolve", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-neutral", priorRoute,
      priorWorkClassDigest: admission.reservation.workClassDigest,
      dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }) },
    }), { catalog: policy, state, now: NOW });
    assert.equal(neutral.response.reason, "route_reevaluation_required", JSON.stringify(neutral.response));
    assert.equal(historical.currentRoute, undefined, "read-only resolution does not apply a new allocation");
    assert.equal(historical.selected.model, "retired-native-model");
    const tampered = handleRequest(request("resolve", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "tampered-policy", priorRoute: { ...priorRoute, policyDigest: DIGEST_B },
      priorWorkClassDigest: historical.workClassDigest,
      dispatchIdentity: dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }),
    }), { catalog: policy, state, now: NOW });
    assert.equal(tampered.response.reason, "prior_route_binding_mismatch");
    const crossedDestination = handleRequest(request("resolve", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "none", actionId: "message-crossed", priorRoute,
      priorWorkClassDigest: admission.reservation.workClassDigest,
      dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "wrong-session" }) },
    }), { catalog: policy, state, now: NOW });
    assert.equal(crossedDestination.response.reason, "prior_destination_identity_mismatch");
    const adjustment = handleRequest(request("admit", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "adjust_active", requestId: "message-adjust", activeReservationId: admission.reservation.reservationId,
      frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "message-task" }, priorRoute,
      priorWorkClassDigest: admission.reservation.workClassDigest,
      dispatchIdentity: { ...dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }) },
    }), { catalog: policy, state, now: NOW });
    assert.equal(adjustment.response.reason, "active_budget_adjusted", JSON.stringify(adjustment.response));
    assert.equal(adjustment.response.decision.selected.model, "gpt-6-sol");
    assert.equal(historical.selected.model, "retired-native-model");
    assert.equal(state.reservations[historical.reservationId].routeLearningEligible, false);
    assert.equal(historical.policyDigest, historicalPolicy);
    const continued = state.reservations[historical.reservationId];
    const currentPriorRoute = {
      ...priorRoute,
      carrierId: continued.currentRoute.selected.carrierId,
      model: continued.currentRoute.selected.model,
      effort: continued.currentRoute.selected.effort,
      policyDigest: continued.currentRoute.policyDigest,
    };
    const raised = handleRequest(request("admit", {
      adapterId: "codex-task-message", dispatchKind: "task_message", budgetEffect: "adjust_active", requestId: "message-adjust-again", activeReservationId: historical.reservationId,
      model: "gpt-6-sol", effort: "max", frozenInputDigest: DIGEST_A,
      forecast: { marginalUsd: "1" }, scopes: { task: "message-task" }, priorRoute: currentPriorRoute,
      priorWorkClassDigest: historical.workClassDigest,
      dispatchIdentity: dispatchIdentity("codex-task-message", { hostScope: "host-msg", sessionId: "task-msg" }),
    }), { catalog: policy, state, now: NOW });
    assert.equal(raised.response.reason, "active_budget_adjusted", JSON.stringify(raised.response));
    assert.equal(raised.response.decision.selected.effort, "max");
    assert.equal(state.reservations[historical.reservationId].currentRoute.selected.effort, "max");
    assert.equal(state.reservations[historical.reservationId].selected.model, "retired-native-model");
    assert.equal(state.reservations[historical.reservationId].policyDigest, historicalPolicy);
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  });
}

test("an already claimed dispatch replays its exact identity after policy rotation", () => {
  const policy = catalog();
  const state = createEmptyState();
  const admission = admit(policy, state);
  const identity = dispatchIdentity("native-subagent-create");
  const claimInput = request("claim-dispatch", {
    reservationId: admission.reservation.reservationId,
    frozenInputDigest: DIGEST_A,
    dispatchIdentity: identity,
  });
  const first = handleRequest(claimInput, { catalog: policy, state, now: NOW });
  assert.equal(first.response.reason, "dispatch_claimed", JSON.stringify(first.response));
  policy.providers.codex.locality = "same_region";
  const before = structuredClone(state);
  const replay = handleRequest(claimInput, { catalog: policy, state, now: NOW });
  assert.equal(replay.response.reason, "claim_replayed", JSON.stringify(replay.response));
  assert.equal(replay.response.claimId, first.response.claimId);
  assert.equal(replay.changed, false);
  assert.deepEqual(state, before);
  const wrongIdentity = handleRequest({ ...claimInput, dispatchIdentity: { ...identity, sessionId: "another-session" } }, { catalog: policy, state, now: NOW });
  assert.equal(wrongIdentity.response.reason, "dispatch_identity_mismatch");
  assert.deepEqual(state, before);
});

test("invalidating stale undispatched routes releases tight budgets atomically and replays safely", () => {
  const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "1" } } } });
  for (const change of ["policy", "model", "carrier", "version"]) {
    const state = createEmptyState();
    const admission = admit(policy, state);
    const reservation = state.reservations[admission.reservation.reservationId];
    if (change === "policy") {
      reservation.policyDigest = "builtin-model-routing-v1";
      reservation.decision.policyDigest = reservation.policyDigest;
    } else if (change === "carrier") {
      reservation.selected.carrierId = "retired-native-carrier";
      reservation.decision.selected.carrierId = reservation.selected.carrierId;
    } else if (change === "version") {
      reservation.selected.carrierVersion = "v0";
      reservation.decision.selected.carrierVersion = "v0";
      reservation.binding.adapterVersion = "v0";
      reservation.selected.adapterVersion = "v0";
      reservation.decision.binding.adapterVersion = "v0";
      reservation.decision.selected.adapterVersion = "v0";
    } else {
      reservation.selected.model = "retired-native-model";
      reservation.decision.selected.model = reservation.selected.model;
    }
    const nextInput = request("admit", {
      requestId: "current-admission", frozenInputDigest: DIGEST_A,
      forecast: { marginalUsd: "1" }, scopes: { task: "task-one", run: "run-one", project: "project-one" },
    });
    assert.equal(handleRequest(nextInput, { catalog: policy, state, now: NOW }).response.ok, false);
    const claimInput = request("claim-dispatch", {
      reservationId: reservation.reservationId,
      frozenInputDigest: reservation.frozenInputDigest,
      dispatchIdentity: { ...dispatchIdentity(reservation.binding.adapterId), ...(change === "version" ? { toolVersion: "v0", toolId: "retired-native-producer" } : {}) },
    });
    const before = structuredClone(state);
    const wrongDestination = handleRequest({ ...claimInput, dispatchIdentity: { ...claimInput.dispatchIdentity, hostScope: "unrelated-host" } }, { catalog: policy, state, now: NOW });
    assert.equal(wrongDestination.response.reason, "dispatch_identity_mismatch");
    assert.deepEqual(state, before);
    assert.equal(handleRequest({ ...claimInput, frozenInputDigest: DIGEST_B }, { catalog: policy, state, now: NOW }).response.reason, "claim_input_mismatch");
    assert.deepEqual(state, before);
    const result = handleRequest(claimInput, { catalog: policy, state, now: NOW });
    assert.equal(result.response.ok, false);
    assert.equal(result.response.reason, "route_reevaluation_required", JSON.stringify(result.response));
    assert.equal(result.changed, true);
    const invalidated = state.reservations[reservation.reservationId];
    assert.equal(invalidated.phase, "invalidated");
    assert.equal(invalidated.claimId, null);
    assert.equal(invalidated.claimed, undefined);
    assert.deepEqual(invalidated.selected, reservation.selected);
    assert.deepEqual(invalidated.decision, reservation.decision);
    assert.deepEqual(invalidated.forecast, { marginalUsd: "1" });
    const after = structuredClone(state);
    const replay = handleRequest(claimInput, { catalog: policy, state, now: NOW });
    assert.equal(replay.response.reason, "route_reevaluation_required");
    assert.equal(replay.changed, false);
    assert.deepEqual(state, after);
    const oldAdmissionReplay = handleRequest({ ...nextInput, requestId: "admit-one" }, { catalog: policy, state, now: NOW });
    assert.equal(oldAdmissionReplay.response.reason, "route_reevaluation_required");
    const fresh = handleRequest(nextInput, { catalog: policy, state, now: NOW });
    assert.equal(fresh.response.reason, "admitted", JSON.stringify(fresh.response));
    assert.equal(fresh.response.decision.selected.model, "gpt-6-astra");
    assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  }
});


test("stored descriptor versions survive catalog upgrades while live selections stay strict", () => {
  const policy = catalog({});
  const state = attestedCapability(policy, { carrierId: "codex-astra", adapterId: "native-subagent-create", accountScope: "local", observedModel: "gpt-6-astra" });
  const admission = admit(policy, state);
  const reservation = state.reservations[admission.reservation.reservationId];
  reservation.selected.carrierVersion = "v0";
  reservation.selected.adapterVersion = "v0";
  reservation.binding.adapterVersion = "v0";
  reservation.binding.controls = { oldModelControl: "carrier-owned" };
  reservation.decision.selected = structuredClone(reservation.selected);
  reservation.decision.binding = structuredClone(reservation.binding);
  for (const capability of Object.values(state.capabilities)) {
    capability.carrierVersion = "v0";
    capability.adapterVersion = "v0";
  }
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  assert.equal(validSelected(reservation.selected), false);
  assert.equal(validBinding(reservation.binding), false);
  for (const historicalPolicy of ["builtin-model-routing-v2", "builtin-model-routing-gpt6-sol-v2"]) {
    const historical = structuredClone(state);
    const historicalReservation = historical.reservations[reservation.reservationId];
    historicalReservation.policyDigest = historicalPolicy;
    historicalReservation.decision.policyDigest = historicalPolicy;
    assert.equal(validateState(historical).ok, true, historicalPolicy);
  }
  for (const malformedPolicy of ["builtin-model-routing-arbitrary", "builtin-model-routing--sol-v2", "builtin-model-routing-Sol-v2", "builtin-model-routing-sol-v0", "builtin-model-routing-sol-v2-extra"]) {
    const badPolicy = structuredClone(state);
    const badReservation = badPolicy.reservations[reservation.reservationId];
    badReservation.policyDigest = malformedPolicy;
    badReservation.decision.policyDigest = malformedPolicy;
    assert.equal(validateState(badPolicy).ok, false, malformedPolicy);
  }
});


test("authentic old-version adapter receipts settle immutable dispatch evidence", () => {
  const policy = catalog({});
  const state = attestedCapability(policy, { carrierId: "codex-astra", adapterId: "native-subagent-create", accountScope: "local", observedModel: "gpt-6-astra" });
  const admission = admit(policy, state);
  const claimed = claim(policy, state, admission);
  const reservation = state.reservations[admission.reservation.reservationId];
  reservation.selected.carrierVersion = "v0";
  reservation.selected.adapterVersion = "v0";
  reservation.binding.adapterVersion = "v0";
  reservation.claimed.toolVersion = "v0";
  reservation.decision.selected = structuredClone(reservation.selected);
  reservation.decision.binding = structuredClone(reservation.binding);
  const original = structuredClone(reservation);
  const receipt = baseReceipt(reservation, { ...claimed.identity, toolVersion: "v0" }, { adapterVersion: "v0" });
  const forged = { ...receipt, adapterVersion: "v1", toolVersion: "v1" };
  const rejected = handleRequest(request("reconcile", { reservationId: reservation.reservationId, frozenInputDigest: reservation.frozenInputDigest, receipt: forged }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(forged) });
  assert.equal(rejected.response.reason, "receipt_dispatch_identity_mismatch");
  const reconciled = handleRequest(request("reconcile", { reservationId: reservation.reservationId, frozenInputDigest: reservation.frozenInputDigest, receipt }), { catalog: policy, state, now: NOW, trustedReceiptImporter: trustedReceiptImporter(receipt) });
  assert.equal(reconciled.response.ok, true, JSON.stringify(reconciled.response));
  const settled = state.reservations[reservation.reservationId];
  assert.equal(settled.phase, "settled");
  assert.deepEqual(settled.selected, original.selected);
  assert.deepEqual(settled.binding, original.binding);
  assert.deepEqual(settled.claimed, original.claimed);
  assert.equal(state.spendAggregates[scopeAccountingId(reservation.scope)].marginalUsd.hardAccounted, "1");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("CLI persists stale claim invalidation despite refusing dispatch and releases the budget", () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "routing-invalidation-")));
  try {
    const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "1" } } } });
    const state = createEmptyState();
    const admission = admit(policy, state);
    const reservation = state.reservations[admission.reservation.reservationId];
    reservation.policyDigest = "builtin-model-routing-v1";
    reservation.decision.policyDigest = reservation.policyDigest;
    const statePath = path.join(directory, "state.json");
    const policyPath = path.join(directory, "policy.json");
    fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
    fs.writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
    const options = { trustedEmbedding: true, now: NOW, home: directory, env: { RAILYARD_MODEL_STATE_PATH: statePath, RAILYARD_MODEL_POLICY_PATH: policyPath } };
    const refused = runCli(request("claim-dispatch", {
      reservationId: reservation.reservationId,
      frozenInputDigest: reservation.frozenInputDigest,
      dispatchIdentity: dispatchIdentity(reservation.binding.adapterId),
    }), options);
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "route_reevaluation_required", JSON.stringify(refused));
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(persisted.reservations[reservation.reservationId].phase, "invalidated");
    assert.equal(persisted.reservations[reservation.reservationId].claimId, null);
    const fresh = runCli(request("admit", {
      requestId: "current-cli-admission", frozenInputDigest: DIGEST_A,
      forecast: { marginalUsd: "1" }, scopes: { task: "task-one", run: "run-one", project: "project-one" },
    }), options);
    assert.equal(fresh.reason, "admitted", JSON.stringify(fresh));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("leased stale claims persist invalidation and release only safe stale lease capacity", () => {
  for (const scenario of ["current-lease", "stale-empty-lease", "stale-active-lease", "stale-empty-ceiling", "stale-empty-expired", "stale-empty-slots", "stale-empty-released"]) {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "routing-slot-invalidation-")));
    try {
      const policy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "1" } }, project: { marginalUsd: { hardAdmission: "2" } } } });
      const state = createEmptyState();
      const admission = admit(policy, state, { hostScope: "child-one", scopes: { task: "child-task" } });
      const lease = {
        leaseId: "slot-lease", issuerScope: "allocator-one", allocatorScopes: { project: "allocator-project" }, destinationScope: "child-one", destinationAccountScope: "local", epochId: "slot-epoch", expiresAt: "2026-08-05T12:00:00.000Z",
        carrierId: "codex-astra", adapterId: "native-subagent-create", ceiling: { marginalUsd: "2" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
      };
      const reference = { leaseId: lease.leaseId, destinationScope: "child-one", destinationAccountScope: "local" };
      assert.equal(handleRequest(request("issue-lease", { lease }), { catalog: policy, state, now: NOW }).response.reason, "lease_issued");
      assert.equal(handleRequest(request("accept-lease", { lease: reference }), { catalog: policy, state, now: NOW }).response.reason, "lease_accepted");
      if (scenario === "stale-active-lease") {
        const active = admit(policy, state, { requestId: "other-active-work", hostScope: "child-one", scopes: { task: "other-task" } });
        assert.equal(handleRequest(request("claim-slot", {
          reservationId: active.reservation.reservationId, frozenInputDigest: DIGEST_A, lease: reference,
          dispatchIdentity: dispatchIdentity("native-subagent-create", { hostScope: "child-one", sessionId: "other-session" }),
        }), { catalog: policy, state, now: NOW }).response.reason, "delegated_slot_claimed");
      }
      const storedLease = state.leases[lease.leaseId];
      if (scenario === "stale-empty-ceiling") storedLease.remainingCeiling.marginalUsd = "0";
      if (scenario === "stale-empty-expired") {
        storedLease.issuedAt = new Date(NOW - 2000).toISOString();
        storedLease.expiresAt = new Date(NOW - 1000).toISOString();
      }
      if (scenario === "stale-empty-slots") storedLease.slotsClaimed = storedLease.maxSlots;
      if (scenario === "stale-empty-released") {
        storedLease.released = true;
        storedLease.releasedAt = new Date(NOW).toISOString();
        storedLease.remainingCeiling.marginalUsd = "0";
      }
      if (["stale-empty-ceiling", "stale-empty-expired", "stale-empty-slots", "stale-empty-released"].includes(scenario)) {
        const beforeRejectedClaim = structuredClone(state);
        const currentRefusal = handleRequest(request("claim-slot", {
          reservationId: admission.reservation.reservationId, frozenInputDigest: DIGEST_A, lease: reference,
          dispatchIdentity: dispatchIdentity("native-subagent-create", { hostScope: "child-one" }),
        }), { catalog: policy, state, now: NOW });
        assert.equal(currentRefusal.response.reason, scenario === "stale-empty-ceiling" ? "lease_ceiling_exceeded" : "lease_unavailable");
        assert.deepEqual(state, beforeRejectedClaim, "current-route refusal must roll back its provisional claim");
      }
      const beforeLease = structuredClone(state.leases[lease.leaseId]);
      const reservation = state.reservations[admission.reservation.reservationId];
      if (scenario === "current-lease") {
        reservation.selected.model = "retired-native-model";
        reservation.decision.selected.model = reservation.selected.model;
      } else policy.providers.codex.locality = "same_region";
      const statePath = path.join(directory, "state.json");
      const policyPath = path.join(directory, "policy.json");
      fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
      fs.writeFileSync(policyPath, JSON.stringify(policy), { mode: 0o600 });
      const options = { trustedEmbedding: true, now: NOW, home: directory, env: { RAILYARD_MODEL_STATE_PATH: statePath, RAILYARD_MODEL_POLICY_PATH: policyPath } };
      const refused = runCli(request("claim-slot", {
        reservationId: reservation.reservationId, frozenInputDigest: DIGEST_A, lease: reference,
        dispatchIdentity: dispatchIdentity("native-subagent-create", { hostScope: "child-one" }),
      }), options);
      assert.equal(refused.ok, false);
      assert.equal(refused.reason, "route_reevaluation_required", JSON.stringify(refused));
      const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
      assert.equal(persisted.reservations[reservation.reservationId].phase, "invalidated");
      assert.equal(persisted.reservations[reservation.reservationId].claimId, null);
      assert.deepEqual(persisted.reservations[reservation.reservationId].forecast, { marginalUsd: "1" });
      assert.equal(persisted.leases[lease.leaseId].slotsClaimed, beforeLease.slotsClaimed);
      assert.deepEqual(persisted.leases[lease.leaseId].allocations, beforeLease.allocations);
      if (scenario.startsWith("stale-empty-")) {
        assert.equal(refused.leaseReleased, true);
        assert.equal(persisted.leases[lease.leaseId].released, true);
        assert.equal(persisted.leases[lease.leaseId].remainingCeiling.marginalUsd, "0");
        assert.equal(runCli(request("issue-lease", { lease: { ...lease, leaseId: "current-slot-lease" } }), options).reason, "lease_issued");
      } else {
        assert.deepEqual(persisted.leases[lease.leaseId], beforeLease);
        if (scenario === "stale-active-lease") {
          assert.equal(refused.leaseReleaseRequired, true);
          assert.equal(runCli(request("release-lease", { lease: reference }), options).reason, "lease_released");
          assert.equal(runCli(request("issue-lease", { lease: { ...lease, leaseId: "current-slot-lease", ceiling: { marginalUsd: "1" } } }), options).reason, "lease_issued");
          const released = JSON.parse(fs.readFileSync(statePath, "utf8"));
          assert.deepEqual(released.leases[lease.leaseId].allocations, beforeLease.allocations);
        }
      }
      const fresh = runCli(request("admit", {
        requestId: "fresh-slot-admission", frozenInputDigest: DIGEST_A, hostScope: "child-one",
        forecast: { marginalUsd: "1" }, scopes: { task: "child-task" },
      }), options);
      assert.equal(fresh.reason, "admitted", JSON.stringify(fresh));
      if (scenario === "current-lease") {
        const claimedFresh = runCli(request("claim-slot", {
          reservationId: fresh.reservation.reservationId, frozenInputDigest: DIGEST_A, lease: reference,
          dispatchIdentity: dispatchIdentity("native-subagent-create", { hostScope: "child-one" }),
        }), options);
        assert.equal(claimedFresh.reason, "delegated_slot_claimed", JSON.stringify(claimedFresh));
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
});
