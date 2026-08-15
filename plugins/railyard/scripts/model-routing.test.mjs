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
  CONTRACT_VERSION,
  createEmptyState,
  DAYBREAK_MODEL,
  DAYBREAK_AVAILABILITY_TTL_MS,
  handleRequest,
  MAX_APP_SERVER_RESPONSE_BYTES,
  measureFastPath,
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
  validateCatalog,
  validateState,
} from "./model-routing.mjs";
import { validBinding } from "./model-routing/state-schema.mjs";
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

function rate({ model = "gpt-5.6-luna", carrierId = "codex-luna", effort = "max", billingSurface = "codex", amount = "0.10" } = {}) {
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
      codex: { carrierId: "codex-luna", executionSurface: "codex", account: "local", locality: "external", retention: "provider_default" },
      glm: { carrierId: "glm-5-2-engineer", executionSurface: "provider_subscription", account: "plan", locality: "same_region", retention: "ephemeral" },
      ...extraProviders,
    },
    models: {
      luna: {
        provider: "codex",
        carrierId: "codex-luna",
        requestedModel: "gpt-5.6-luna",
        efforts: ["max"],
        roles: ["implementation", "implementation.mechanical"],
        relativeCostIndex: 50,
        ...(rates ? { rates: [rate()] } : {}),
      },
      glm: {
        provider: "glm",
        carrierId: "glm-5-2-engineer",
        requestedModel: "glm-5.2",
        efforts: ["xhigh"],
        roles: ["implementation.mechanical"],
        relativeCostIndex: 1,
        workShape: {
          ambiguity: ["low"], novelty: ["low"], repetition: ["high"], decomposability: ["high"], unitVolume: ["high"], semanticRisk: ["low"], verificationStrength: ["high"],
        },
        ...(rates ? { rates: [rate({ model: "glm-5.2", carrierId: "glm-5-2-engineer", effort: "xhigh", billingSurface: "provider_subscription", amount: "0.02" })] } : {}),
      },
      ...extraModels,
    },
    roles: {
      implementation: { tiers: [{ models: ["luna"], softPriorities: ["cost"] }] },
      "implementation.mechanical": { tiers: [{ models: ["luna", "glm"], softPriorities: ["cost"] }] },
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

function ownerPolicy() {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../references/model-routing.example.json"), "utf8"));
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

function attestedCapability(policy, { carrierId = "glm-5-2-engineer", adapterId = "configured-profile-task-create", hostScope = "local", accountScope = "plan", observedModel = "glm-5.2", capabilities = [] } = {}) {
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

test("the built-in route stays Luna Max, and no-config task messages fail closed without a resolver-owned prior route", () => {
  const state = createEmptyState();
  const resolved = handleRequest(request("resolve"), { state, now: NOW });
  assert.equal(resolved.response.ok, true);
  assert.equal(resolved.response.decision.selected.model, "gpt-5.6-luna");
  assert.equal(resolved.response.decision.selected.effort, "max");
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

test("the owner catalog selects Fable for hard Claude work and records an explicit Luna handoff reason", () => {
  const policy = ownerPolicy();
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
    }), { catalog: policy, state: createEmptyState(), now: NOW, trustedRuntimeAttestor: lunaAvailableAttestor() });
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

  const review = handleRequest(request("resolve", { role: "review.code", harness: "codex" }), {
    catalog: policy,
    state: createEmptyState(),
    now: NOW,
  });
  assert.equal(review.response.reason, "resolved", JSON.stringify(review.response));
  assert.equal(review.response.decision.selected.modelAlias, "sol");
  assert.equal(review.response.decision.selected.effort, "high");
  assert.equal(validBinding(review.response.decision.binding), true);
  const crossFamily = handleRequest(request("resolve", { role: "review.cross_family", harness: "codex" }), {
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
    fs.writeFileSync(configPath, JSON.stringify(ownerPolicy()));
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
    const securityRequest = request("resolve", { role: "security.review", harness: "codex" });
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
    assert.equal(cached.daybreakCatalogDigest, policyDigest(ownerPolicy()));

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
    assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).daybreakCatalogDigest, policyDigest(ownerPolicy()));

    const remoteScope = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "codex",
      hostScope: "remote-runner",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(remoteScope.decision.selected.model, "gpt-5.6-sol");
    assert.equal(probeCalls, 2);

    const differentAccount = await runCliAsync(request("resolve", {
      role: "security.review",
      harness: "codex",
      accountScope: "different-account",
    }), {
      ...options,
      daybreakProbe: async () => {
        probeCalls += 1;
        return { available: true };
      },
    });
    assert.equal(differentAccount.decision.selected.model, "gpt-5.6-sol");
    assert.equal(probeCalls, 2);

    const changedCatalog = ownerPolicy();
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
    assert.equal(future.decision.selected.model, "gpt-5.6-sol");
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
    assert.equal(unavailable.decision.selected.model, "gpt-5.6-sol");
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
    assert.equal(locked.decision.selected.model, "gpt-5.6-sol");
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
    assert.equal(unknown.decision.selected.model, "gpt-5.6-sol");
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
      assert.equal(writeFailure.decision.selected.model, "gpt-5.6-sol");
      assert.equal(probeCalls, 7);
    } finally {
      fs.chmodSync(stateDirectory, 0o700);
      try { fs.unlinkSync(`${statePath}.lock`); } catch { /* no-op */ }
    }

    const nonSecurity = await runCliAsync(request("resolve", {
      role: "implementation.hard",
      harness: "codex",
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
  const policy = ownerPolicy();
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
  const policy = ownerPolicy();
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

test("a catalog cannot promote Luna into a coordinator role", () => {
  const policy = ownerPolicy();
  policy.roles.orchestration = { tiers: [["luna", "sol"]] };
  const resolved = handleRequest(request("resolve", {
    role: "orchestration",
    harness: "codex",
  }), { catalog: policy, state: createEmptyState(), now: NOW });
  assert.equal(resolved.response.reason, "resolved", JSON.stringify(resolved.response));
  assert.equal(resolved.response.decision.selected.modelAlias, "sol");
  assert.equal(resolved.response.decision.rejectedAlternatives[0].modelAlias, "luna");
  assert.equal(resolved.response.decision.rejectedAlternatives[0].reason, "role_ineligible");
});

test("the owner catalog keeps subscription meters separate and gates GLM on Codex config", () => {
  const policy = ownerPolicy();
  assert.deepEqual(Object.keys(policy.budgets.task).sort(), ["claude_subscription", "codex_subscription", "zai_credits"]);
  const previous = process.env.CODEX_HOME;
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "railyard-codex-policy-"));
  try {
    process.env.CODEX_HOME = codexHome;
    assert.equal(providerAvailabilityIssue(policy.providers.zai), "provider_unavailable");
    fs.writeFileSync(path.join(codexHome, "config.toml"), "[model_providers.zai_litellm]\n");
    assert.equal(providerAvailabilityIssue(policy.providers.zai), null);
    fs.writeFileSync(path.join(codexHome, "config.toml"), "[model_providers.zai_litellm] # enabled\n");
    assert.equal(providerAvailabilityIssue(policy.providers.zai), null);
    assert.equal(providerAvailabilityIssue(policy.providers.zai, { hostScope: "runner-2" }), null);

    const transportScopes = [];
    const runtimeScopes = [];
    const remote = handleRequest(request("resolve", {
      role: "implementation.cross-harness",
      harness: "codex",
      destinationScope: "runner-2",
      crossHarnessReason: "Use the remote Codex-family GLM destination for this bounded task.",
      adapterId: "configured-profile-task-create",
      dispatchKind: "task_create",
    }), {
      catalog: policy,
      state: attestedCapability(policy, {
        hostScope: "runner-2",
        accountScope: "zai-credits",
      }),
      now: NOW,
      trustedTransportAttestor: ({ hostScope, accountScope }) => {
        transportScopes.push({ hostScope, accountScope });
        return { attestorId: "railyard-transport-attestor-v1", attestationDigest: DIGEST_A, compatibility: "native_compatible", bridgeAvailable: false };
      },
      trustedRuntimeAttestor: ({ hostScope, accountScope }) => {
        runtimeScopes.push({ hostScope, accountScope });
        return { attestorId: "railyard-runtime-attestor-v1", attestationDigest: DIGEST_A, lunaAvailability: "available", hostScope, accountScope };
      },
    });
    assert.equal(remote.response.reason, "resolved", JSON.stringify(remote.response));
    assert.equal(remote.response.decision.selected.modelAlias, "glm");
    assert.equal(remote.response.decision.binding.hostScope, "runner-2");
    assert.equal(remote.response.decision.binding.accountScope, "zai-credits");
    assert.deepEqual(transportScopes, [{ hostScope: "runner-2", accountScope: "zai-credits" }]);
    assert.deepEqual(runtimeScopes, [{ hostScope: "runner-2", accountScope: "codex-sub" }]);
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
});

test("configured runtime candidates fail closed when the trusted attestor is invalid", () => {
  const policy = ownerPolicy();
  for (const trustedRuntimeAttestor of [
    () => { throw new Error("attestor unavailable"); },
    () => ({}),
    () => ({ attestorId: "railyard-runtime-attestor-v1", attestationDigest: DIGEST_A, lunaAvailability: "unknown", hostScope: "local", accountScope: "codex-sub" }),
  ]) {
    const refused = handleRequest(request("resolve", { role: "implementation", harness: "codex" }), {
      catalog: policy,
      state: createEmptyState(),
      now: NOW,
      trustedRuntimeAttestor,
    });
    assert.equal(refused.response.reason, "no_eligible_route", JSON.stringify(refused.response));
    assert.equal(refused.response.rejectedAlternatives.find((item) => item.modelAlias === "luna")?.reason, "invalid_runtime_attestation");
  }
});

test("the owner catalog gives hard Codex implementation the max-effort Sol route", () => {
  const policy = ownerPolicy();
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
  unsafe.models.glm.profile = "caller-controlled";
  assert.equal(validateCatalog(unsafe).reason, "unsafe_catalog");

  const privatePolicy = catalog({ privacy: { locality: "local_only", retention: "none" } });
  assert.equal(handleRequest(request("resolve", { privacy: { locality: "external", retention: "provider_default" } }), { catalog: privatePolicy, now: NOW }).response.reason, "no_eligible_route");

  const plan = handleRequest(request("resolve", {
    callerKind: "compound-engineering",
    ceSeam: { id: "ce-plan.execution", skill: "ce-plan", artifact: { schema: "railyard/ce-plan-execution-input/v1", digest: DIGEST_A } },
  }), { now: NOW });
  assert.equal(plan.response.ok, true, JSON.stringify(plan.response));
  assert.equal(plan.response.decision.executionOverride.seam.id, "ce-plan.execution");

  const incompatible = handleRequest(request("resolve", {
    callerKind: "compound-engineering",
    ceSeam: { id: "ce-code-review.execution", skill: "ce-code-review", artifact: { schema: "railyard/ce-code-review-findings/v1", digest: DIGEST_A } },
  }), { now: NOW });
  assert.equal(incompatible.response.reason, "ce_seam_binding_mismatch");
});

test("capability attestation binds evidence facts and configured TTLs", () => {
  const policy = catalog({ discovery: { positiveTtlSeconds: 3600, negativeTtlSeconds: 90, manualRefresh: true } });
  const state = createEmptyState();
  const refresh = request("refresh", {
    capability: { carrierId: "glm-5-2-engineer", adapterId: "configured-profile-task-create", hostScope: "local", accountScope: "plan", state: "host_capability_attested" },
  });
  assert.equal(handleRequest(refresh, { catalog: policy, state, now: NOW }).response.reason, "trusted_attestor_unavailable");
  const refreshed = handleRequest(refresh, { catalog: policy, state, now: NOW, trustedCapabilityAttestor: refreshAttestor({ observedModel: "glm-5.2" }) });
  assert.equal(refreshed.response.reason, "capability_refreshed");
  const evidence = Object.values(state.capabilities)[0];
  assert.equal(evidence.resolvedModelDigest, stableDigest("glm-5.2"));
  assert.equal(evidence.expiresAt, "2026-08-04T12:30:00.000Z");

  const tooLong = handleRequest(refresh, { catalog: policy, state: createEmptyState(), now: NOW, trustedCapabilityAttestor: refreshAttestor({ observedModel: "glm-5.2", expiresAt: "2026-08-05T12:00:00.000Z" }) });
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
  delete invalid.models.glm.rates[0].resolvedModelDigest;
  assert.equal(validateCatalog(invalid).reason, "invalid_model");

  const policy = catalog({ rates: true });
  const resolved = handleRequest(request("resolve", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
  }), { catalog: policy, state: attestedCapability(policy), now: NOW });
  assert.equal(resolved.response.decision.selected.modelAlias, "glm");

  policy.models.glm.rates[0].resolvedModelDigest = DIGEST_B;
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
  assert.equal(route.carrierId, "codex-luna");
  assert.equal(route.carrierVersion, CARRIER_DESCRIPTORS["codex-luna"].version);
  assert.equal(route.billingSurface, "codex");
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));

  const learnedPolicy = catalog({ budgets: { task: { marginalUsd: { soft: "10" } } } });
  learnedPolicy.roles["implementation.mechanical"] = { tiers: [{ models: ["luna", "glm"], softPriorities: ["learnedEstimate"] }] };
  const selectionState = attestedCapability(learnedPolicy);
  const shape = request("resolve").workShape;
  const baseBucket = stableDigest({ role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape });
  const glmRouteBucket = stableDigest({
    baseBucket,
    resolvedModel: "glm-5.2",
    carrierId: "glm-5-2-engineer",
    carrierVersion: CARRIER_DESCRIPTORS["glm-5-2-engineer"].version,
    effort: "xhigh",
    billingSurface: "provider_subscription",
  });
  selectionState.learningAggregates.learning_base_fixture = {
    kind: "baseDemand", baseBucket, role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape,
    count: 5, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 5, ratingTotal: 25,
    usageTotals: { marginalUsd: "6" }, forecastTotals: { marginalUsd: "5" }, forecastInfluenceByMeter: { marginalUsd: 0.2 }, updatedAt: "2026-08-04T12:00:00.000Z",
  };
  selectionState.learningAggregates.learning_glm_fixture = {
    kind: "routeEffect", baseBucket, routeEffectBucket: glmRouteBucket, role: "implementation.mechanical", risk: "unknown", contextClass: "unknown", workShape: shape,
    carrierId: "glm-5-2-engineer", carrierVersion: CARRIER_DESCRIPTORS["glm-5-2-engineer"].version, effort: "xhigh", billingSurface: "provider_subscription", resolvedModelBucket: stableDigest({ carrierId: "glm-5-2-engineer", model: "glm-5.2" }),
    count: 5, totalDurationMs: 0, totalRetries: 0, failures: 0, verified: 5, ratingTotal: 25, tieBreakInfluence: 0.2, updatedAt: "2026-08-04T12:00:00.000Z",
  };
  assert.equal(validateState(selectionState).ok, true, JSON.stringify(validateState(selectionState)));
  const glmAuthority = {
    authorityId: "learning-glm-authority", objectiveEpoch: "learning-epoch", objectiveDigest: DIGEST_A, senderOwner: "learning-owner", accountScope: "plan", carrierId: "glm-5-2-engineer", adapterId: "configured-profile-task-create", policyDigest: policyDigest(learnedPolicy),
    destinationScope: "local", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "learning-turn", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_A,
  };
  mintAuthority(learnedPolicy, selectionState, glmAuthority);
  const learned = handleRequest(request("admit", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
    requestId: "learned-selection", frozenInputDigest: DIGEST_A, forecast: { marginalUsd: "1" }, scopes: { task: "learned-task" },
    taskAuthorityId: glmAuthority.authorityId, objectiveEpoch: glmAuthority.objectiveEpoch, objectiveDigest: glmAuthority.objectiveDigest, instructionDigest: glmAuthority.explicitUserInstructionDigest, senderOwner: glmAuthority.senderOwner, destinationScope: "local", destinationClass: "visible_task", currentTurn: glmAuthority.currentTurn,
  }), { catalog: learnedPolicy, state: selectionState, now: NOW });
  assert.equal(learned.response.ok, true, JSON.stringify(learned.response));
  assert.equal(learned.response.decision.selected.modelAlias, "glm");
  assert.equal(learned.response.reservation.forecast.marginalUsd, "1.2");
  assert.equal(learned.response.decision.learning.policyOrdering, "unchanged");

  const explicitPolicy = catalog({ budgets: { task: { marginalUsd: { soft: "10" } } } });
  explicitPolicy.roles["implementation.mechanical"] = { tiers: [["luna", "glm"]] };
  const explicitState = attestedCapability(explicitPolicy);
  explicitState.learningAggregates = JSON.parse(JSON.stringify(selectionState.learningAggregates));
  const explicit = handleRequest(request("resolve", {
    role: "implementation.mechanical", adapterId: undefined, dispatchKind: undefined, hostScope: "local", accountScope: "plan",
  }), { catalog: explicitPolicy, state: explicitState, now: NOW });
  assert.equal(explicit.response.decision.selected.modelAlias, "luna");

  const hardPolicy = catalog({ budgets: { task: { marginalUsd: { hardAdmission: "2" } } } });
  hardPolicy.roles["implementation.mechanical"] = { tiers: [{ models: ["luna", "glm"], softPriorities: ["learnedEstimate"] }] };
  const hardState = attestedCapability(hardPolicy);
  hardState.learningAggregates = JSON.parse(JSON.stringify(selectionState.learningAggregates));
  hardState.learningAggregates.learning_base_fixture.forecastInfluenceByMeter.marginalUsd = -0.2;
  const hardAuthority = { ...glmAuthority, authorityId: "hard-glm-authority", policyDigest: policyDigest(hardPolicy), explicitUserInstructionDigest: DIGEST_B };
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
  const terra = handleRequest(request("resolve"), {
    state: createEmptyState(),
    now: NOW,
    trustedRuntimeAttestor: () => ({
      attestorId: "railyard-runtime-attestor-v1",
      attestationDigest: DIGEST_A,
      lunaAvailability: "unavailable",
      hostScope: "local",
      accountScope: "codex-sub",
      terra: { verified: true, model: "gpt-5.6-terra", effort: "max" },
    }),
  });
  assert.equal(terra.response.decision.selected.carrierId, "codex-terra-runtime");
  assert.equal(terra.response.decision.fallback.reason, "implementation_model_substitute");
  assert.equal(terra.response.decision.fallbackReceipt.schema, "railyard/r28-route-disclosure/v1");

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
    authorityId: "authority-one", objectiveEpoch: "epoch-one", objectiveDigest: DIGEST_A, senderOwner: "owner-one", accountScope: "local", carrierId: "codex-luna", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
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
    authorityId: "bridge-authority-one", objectiveEpoch: "bridge-epoch", objectiveDigest: DIGEST_A, senderOwner: "bridge-owner", accountScope: "local", carrierId: "codex-luna", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
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
    carrierId: "codex-luna", adapterId: "native-subagent-create", ceiling: { marginalUsd: "2" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
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
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
});

test("terminal receipts cannot reopen settled work, and an epoch cannot seal across active lease work", () => {
  const policy = catalog({ budgets: { project: { marginalUsd: { hardAdmission: "8" } } } });
  const state = createEmptyState();
  const first = admit(policy, state, { requestId: "epoch-first", hostScope: "epoch-child", accountScope: "local", scopes: { task: "epoch-first-task" } });
  const second = admit(policy, state, { requestId: "epoch-second", frozenInputDigest: DIGEST_B, hostScope: "epoch-child", accountScope: "local", scopes: { task: "epoch-second-task" } });
  const lease = {
    leaseId: "epoch-lease", issuerScope: "epoch-allocator", allocatorScopes: { project: "epoch-project" }, destinationScope: "epoch-child", destinationAccountScope: "local", epochId: "epoch-one", expiresAt: "2026-08-05T12:00:00.000Z",
    carrierId: "codex-luna", adapterId: "native-subagent-create", ceiling: { marginalUsd: "4" }, maxSlots: 2, allocatorReceiptDigest: DIGEST_B,
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
    authorityId: "authority-msg", objectiveEpoch: "epoch-msg", objectiveDigest: DIGEST_A, senderOwner: "owner-msg", accountScope: "local", carrierId: "codex-luna", adapterId: "codex-task-create", policyDigest: policyDigest(policy),
    destinationScope: "host-msg", destinationClass: "visible_task", maxTaskCount: 1, currentTurn: "turn-msg", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_B,
  };
  mintAuthority(policy, state, authority);
  const admission = admit(policy, state, { adapterId: "codex-task-create", dispatchKind: "task_create", scopes: { task: "message-task" }, taskAuthorityId: authority.authorityId, objectiveEpoch: authority.objectiveEpoch, objectiveDigest: authority.objectiveDigest, instructionDigest: authority.explicitUserInstructionDigest, senderOwner: authority.senderOwner, destinationScope: "host-msg", destinationClass: "visible_task", currentTurn: "turn-msg" });
  const created = claim(policy, state, admission, { identity: dispatchIdentity("codex-task-create", { hostScope: "host-msg", sessionId: "task-msg" }), fields: { taskAuthorityId: authority.authorityId } });
  const priorRoute = {
    reservationId: admission.reservation.reservationId,
    claimId: created.response.claimId,
    carrierId: "codex-luna",
    model: "gpt-5.6-luna",
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
  assert.deepEqual(neutralReceipt.requested, { model: "gpt-5.6-luna", effort: "max" });
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

test("carrier-neutral invariant work contracts keep seven closed presentation overlays", () => {
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
    ["gpt_sol", "codex-sol", "gpt-5.6-sol", "high", "lean, explicit, bounded brief"],
    ["opus", "claude-ce-review", "opus-current", "high", "complete task specification"],
    ["fable", "claude-ce-review", "fable-current", "high", "autonomy and pause boundaries"],
    ["sonnet", "claude-session", "sonnet", "medium", "bounded objective, relevant context"],
    ["haiku", "claude-session", "haiku", "low", "exact mechanical change"],
    ["glm", "glm-5-2-engineer", "glm-5.2", "xhigh", "repository standards and boundaries"],
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
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-sol", model: "gpt-5.6-sol", effort: "high", expectedInvariantDigest: invariantDigest }).reason, "work_contract_built");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, objectiveDigest: "2".repeat(64), carrierId: "codex-sol", model: "gpt-5.6-sol", effort: "high", expectedInvariantDigest: invariantDigest }).reason, "invariant_contract_mutation");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-sol", model: "unbound-model", effort: "high" }).reason, "presentation_overlay_mismatch");
  assert.equal(buildInvariantWorkContract({ ...invariantInput, carrierId: "codex-sol", model: "gpt-5.6-sol", effort: "high", prompt: "not metadata" }).reason, "invalid_work_contract");
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
    requestedModel: "chatgpt_current_pro", adapterModelControl: "gpt-5.6-sol", documentedProductLabel: "GPT-5.6 Sol + Pro thinking", observedModel: "unknown", executionSurface: "chatgpt_standard",
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
      toolVersion: "v1",
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
      model: "gpt-5.6-sol",
      browser: {
        config: { desiredModel: "GPT-5.6 Sol", modelStrategy: "select", thinkingTime: "pro" },
        modelSelection: {
          requestedModel: "GPT-5.6 Sol",
          resolvedLabel: "GPT-5.6 Sol",
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
      resolveCarrier: () => ({ binary: "/usr/bin/true", version: "0.17.3" }),
      revalidateCarrier: () => "/usr/bin/true",
      run: () => ({ status: 0, stdout: "Fixture finding.\n", stderr: "" }),
    });
    assert.equal(receipt.status, "settled");
    assert.equal(receipt.reason, null);
    assert.equal(receipt.observedModel, "gpt-5.6-sol");

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

    fs.writeFileSync(configPath, JSON.stringify(ownerPolicy()));
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
      carrierId: "codex-luna",
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

    const glmOnly = catalog();
    glmOnly.roles["implementation.mechanical"] = { tiers: [["glm"]] };
    fs.writeFileSync(configPath, JSON.stringify(glmOnly));
    fs.chmodSync(configPath, 0o600);
    const unsupported = publicCli({
      contractVersion: CONTRACT_VERSION,
      command: "admit",
      callerKind: "fleet",
      role: "implementation.mechanical",
      adapterId: "configured-profile-task-create",
      dispatchKind: "task_create",
      requestId: "glm-public-admit",
      frozenInputDigest: DIGEST_A,
      forecast: {},
      scopes: { task: "glm-public-task" },
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

function terraAttestor(model = "gpt-5.6-terra") {
  return () => ({
    attestorId: "railyard-runtime-attestor-v1",
    attestationDigest: DIGEST_A,
    lunaAvailability: "unavailable",
    hostScope: "local",
    accountScope: "codex-sub",
    terra: { verified: true, model, effort: "max" },
  });
}

function lunaAvailableAttestor() {
  return () => ({
    attestorId: "railyard-runtime-attestor-v1",
    attestationDigest: DIGEST_A,
    lunaAvailability: "available",
    hostScope: "local",
    accountScope: "codex-sub",
  });
}

test("configured Terra selection requires the fixed runtime attestor", () => {
  const policy = ownerPolicy();
  const requestFields = {
    role: "implementation.medium",
    harness: "codex",
    adapterId: "codex-task-create",
    dispatchKind: "task_create",
  };
  const state = attestedCapability(policy, {
    carrierId: "codex-terra-runtime",
    adapterId: "codex-task-create",
    accountScope: "codex-sub",
    observedModel: "unknown",
  });
  const missingCapability = handleRequest(request("resolve", requestFields), {
    catalog: policy,
    state: createEmptyState(),
    now: NOW,
    trustedRuntimeAttestor: terraAttestor(),
  });
  assert.equal(missingCapability.response.reason, "no_eligible_route", JSON.stringify(missingCapability.response));
  assert.equal(missingCapability.response.rejectedAlternatives.find((item) => item.modelAlias === "terra")?.reason, "runtime_attestation_required");

  const untrusted = handleRequest(request("resolve", requestFields), { catalog: policy, state, now: NOW });
  assert.equal(untrusted.response.reason, "resolved", JSON.stringify(untrusted.response));
  assert.equal(untrusted.response.decision.selected.modelAlias, "luna");
  assert.equal(untrusted.response.decision.rejectedAlternatives.find((item) => item.modelAlias === "terra")?.reason, "runtime_attestation_required");

  const trusted = handleRequest(request("resolve", requestFields), {
    catalog: policy,
    state,
    now: NOW,
    trustedRuntimeAttestor: terraAttestor(),
  });
  assert.equal(trusted.response.reason, "resolved", JSON.stringify(trusted.response));
  assert.equal(trusted.response.decision.selected.modelAlias, "terra");
  assert.equal(trusted.response.decision.fallback.reason, "implementation_model_substitute");
  assert.equal(trusted.response.decision.fallbackReceipt.reasonCode, "implementation_model_substitute");

  const admissionState = attestedCapability(policy, {
    carrierId: "codex-terra-runtime",
    adapterId: "native-subagent-create",
    accountScope: "codex-sub",
    observedModel: "unknown",
  });
  const admitted = handleRequest(request("admit", {
    ...requestFields,
    adapterId: "native-subagent-create",
    dispatchKind: "subagent_create",
    requestId: "terra-admission",
    frozenInputDigest: DIGEST_A,
    forecast: { marginalUsd: "1" },
    scopes: { task: "terra-task", run: "terra-run", project: "terra-project" },
  }), {
    catalog: policy,
    state: admissionState,
    now: NOW,
    trustedRuntimeAttestor: terraAttestor(),
  });
  assert.equal(admitted.response.reason, "admitted", JSON.stringify(admitted.response));
  assert.equal(admitted.response.decision.selected.modelAlias, "terra");
});

test("implementationEngine follows the implementation role, not one carrier descriptor", () => {
  // No-config default (the public model-routing.mjs CLI supplies no runtime
  // attestor): Codex availability is assumed, not proven, so delivery must be
  // able to proceed on a Claude-Code-only host. Strength is "prefer" — deliver
  // routes to Codex when preflight proves it callable, native Claude otherwise.
  const luna = handleRequest(request("resolve"), { state: createEmptyState(), now: NOW });
  assert.equal(luna.response.ok, true, JSON.stringify(luna.response));
  assert.equal(luna.response.reason, "resolved");
  assert.deepEqual(luna.response.decision.implementationEngine, {
    mode: "prefer", target: "codex", model: "gpt-5.6-luna", source: "deliver",
  });

  // A measured runtime attestation proving Luna present restores "require" —
  // Codex is proven, so the "must go to Codex" demand is honest.
  const provenLuna = handleRequest(request("resolve"), {
    state: createEmptyState(), now: NOW, trustedRuntimeAttestor: lunaAvailableAttestor(),
  });
  assert.equal(provenLuna.response.decision.selected.carrierId, "codex-luna");
  assert.deepEqual(provenLuna.response.decision.implementationEngine, {
    mode: "require", target: "codex", model: "gpt-5.6-luna", source: "deliver",
  });

  const runtimeScopes = [];
  const transportScopes = [];
  const scopedDefault = handleRequest(request("resolve"), {
    state: createEmptyState(), now: NOW,
    trustedRuntimeAttestor: (scope) => {
      runtimeScopes.push({ hostScope: scope.hostScope, accountScope: scope.accountScope });
      return { attestorId: "railyard-runtime-attestor-v1", attestationDigest: DIGEST_A, lunaAvailability: "available", hostScope: scope.hostScope, accountScope: scope.accountScope };
    },
    trustedTransportAttestor: (scope) => {
      transportScopes.push({ hostScope: scope.hostScope, accountScope: scope.accountScope });
      return { attestorId: "railyard-transport-attestor-v1", attestationDigest: DIGEST_A, compatibility: "native_compatible", bridgeAvailable: false };
    },
  });
  assert.equal(scopedDefault.response.decision.binding.accountScope, "codex-sub");
  assert.deepEqual(runtimeScopes, [{ hostScope: "local", accountScope: "codex-sub" }]);
  assert.deepEqual(transportScopes, [{ hostScope: "local", accountScope: "codex-sub" }]);

  // Sourcing the field from codex-luna alone dropped the "must go to Codex"
  // signal exactly when Luna degraded to the Terra substitute. Terra rides a
  // measured attestation, so it too keeps "require".
  const terra = handleRequest(request("resolve"), {
    state: createEmptyState(), now: NOW, trustedRuntimeAttestor: terraAttestor(),
  });
  assert.equal(terra.response.decision.selected.carrierId, "codex-terra-runtime");
  assert.equal(terra.response.decision.fallback.reason, "implementation_model_substitute");
  assert.deepEqual(terra.response.decision.implementationEngine, {
    mode: "require", target: "codex", model: "gpt-5.6-terra", source: "deliver",
  });

  for (const role of ["implementation.fix", "implementation.mechanical"]) {
    const subrole = handleRequest(request("resolve", { role }), { state: createEmptyState(), now: NOW });
    assert.equal(subrole.response.decision.implementationEngine.target, "codex");
    assert.equal(subrole.response.decision.implementationEngine.mode, "prefer");
  }

  // No other role ever carries it.
  for (const role of ["review", "review.deep", "orchestration"]) {
    const other = handleRequest(request("resolve", { role }), { state: createEmptyState(), now: NOW });
    assert.equal(other.response.ok, true, JSON.stringify(other.response));
    assert.equal(Object.hasOwn(other.response.decision, "implementationEngine"), false, role);
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
  const ready = handleRequest(request("resolve", { callerKind: "deliver", r52: r52Readiness() }), { state: createEmptyState(), now: NOW });
  assert.equal(ready.response.ok, true, JSON.stringify(ready.response));
  assert.ok(ready.response.decision.binding.r52.digest);
  assert.equal(handleRequest(request("resolve", { callerKind: "deliver" }), { state: createEmptyState(), now: NOW }).response.ok, true);
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
  const measured = measureFastPath(request("resolve"), { iterations: 9, now: NOW });
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
    carrierId: "codex-sol",
    model: "gpt-5.6-sol",
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
    carrierId: "codex-luna", adapterId: "codex-task-create", policyDigest: policyDigest(policy), destinationScope: "local", destinationClass: "visible_task",
    maxTaskCount: 1, currentTurn: "tamper-turn", expiresAt: "2026-08-05T12:00:00.000Z", explicitUserInstructionDigest: DIGEST_A,
  });
  const lease = {
    leaseId: "tamper-lease", issuerScope: "tamper-allocator", allocatorScopes: { project: "project-one" }, destinationScope: "tamper-child", destinationAccountScope: "local",
    epochId: "tamper-epoch-id", expiresAt: "2026-08-05T12:00:00.000Z", carrierId: "codex-luna", adapterId: "native-subagent-create",
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
    ["carrierVersion", "v9"],
    ["adapterVersion", "v9"],
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
