import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createEmptyState,
  handleRequest,
  stableDigest,
  validateCatalog,
  validateState,
} from "../../../scripts/model-routing.mjs";
import {
  bindExecutable,
  build,
  createTrustedReceiptImporter,
  dispatch,
  freezeInput,
  lifecycle,
  isObservedModelFailure,
  oracleSessionSlug,
  reattach,
  routeExitCode,
  revalidateExecutable,
  revalidateFrozen,
} from "./oracle-route.mjs";
import { evaluateBrowserSession } from "./oracle-observation.mjs";

const ROUTER_NOW = Date.now();
const ROUTER_POLICY = {
  schemaVersion: 1,
  discovery: { positiveTtlSeconds: 3_600, negativeTtlSeconds: 90, manualRefresh: true },
  providers: {
    oracle: { carrierId: "oracle-browser", executionSurface: "chatgpt_standard", account: "standard", locality: "external", retention: "provider_default" },
    lifecycle: { carrierId: "oracle-homebrew-lifecycle", executionSurface: "local_host", account: "standard", locality: "local_only", retention: "none" },
  },
  models: {
    oracle: { provider: "oracle", carrierId: "oracle-browser", requestedModel: "chatgpt_current_pro", efforts: ["high"], roles: ["review.deep"] },
    lifecycle: { provider: "lifecycle", carrierId: "oracle-homebrew-lifecycle", requestedModel: "oracle-homebrew-lifecycle", efforts: ["high"], roles: ["lifecycle.oracle"] },
  },
  roles: {
    "review.deep": { tiers: [["oracle"]] },
    "lifecycle.oracle": { tiers: [["lifecycle"]] },
  },
};
const VALIDATED_POLICY = validateCatalog(ROUTER_POLICY);
assert.equal(VALIDATED_POLICY.ok, true, JSON.stringify(VALIDATED_POLICY));
const POLICY_DIGEST = VALIDATED_POLICY.policy.digest;
let requestSequence = 0;

function routerRequest(command, fields = {}) {
  requestSequence += 1;
  const value = {
    contractVersion: "railyard/model-routing/v1",
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
    ...fields,
  };
  for (const [key, nested] of Object.entries(value)) if (nested === undefined) delete value[key];
  return value;
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
    capabilities: [],
    expiresAt: details.expiresAt,
  };
}

function refreshCapability(state, { carrierId, accountScope, observedModel }) {
  const refreshed = handleRequest(routerRequest("refresh", {
    capability: { carrierId, adapterId: carrierId, hostScope: "local", accountScope, state: "host_capability_attested" },
  }), {
    catalog: ROUTER_POLICY,
    state,
    now: ROUTER_NOW,
    trustedCapabilityAttestor: (record) => {
      const details = {
        observedModel,
        authState: "authenticated",
        expiresAt: new Date(ROUTER_NOW + 30 * 60_000).toISOString(),
      };
      return {
        attestorId: "railyard-host-attestor-v1",
        attestationDigest: "a".repeat(64),
        attestedAt: new Date(ROUTER_NOW).toISOString(),
        expiresAt: details.expiresAt,
        observedModel,
        authState: details.authState,
        capabilities: [],
        attestedFactsDigest: stableDigest(capabilityFacts(record, details)),
      };
    },
  });
  assert.equal(refreshed.response.ok, true, JSON.stringify(refreshed.response));
}

function admitRoute(state, { role, adapterId, dispatchKind, frozenInputDigest, accountScope, sessionId, postLifecycleRequirementId }) {
  const admitted = handleRequest(routerRequest("admit", {
    requestId: `oracle_route_test_${requestSequence}`,
    role,
    adapterId,
    dispatchKind,
    frozenInputDigest,
    forecast: {},
    scopes: { task: `oracle_route_scope_${requestSequence}` },
    hostScope: "local",
    accountScope,
  }), { catalog: ROUTER_POLICY, state, now: ROUTER_NOW });
  assert.equal(admitted.response.ok, true, JSON.stringify(admitted.response));
  const identity = {
    hostScope: "local",
    accountScope,
    dispatchKind,
    sessionId,
    toolId: adapterId,
    toolVersion: "v1",
  };
  const claimed = handleRequest(routerRequest("claim-dispatch", {
    reservationId: admitted.response.reservation.reservationId,
    frozenInputDigest,
    dispatchIdentity: identity,
    postLifecycleRequirementId,
  }), { catalog: ROUTER_POLICY, state, now: ROUTER_NOW });
  return { admitted: admitted.response, claimed: claimed.response, identity };
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "oracle-route-")));
  const file = path.join(root, "review.txt");
  fs.writeFileSync(file, "safe source\n");
  const input = {
    contractVersion: "railyard/model-routing/v1",
    route: { adapter: "oracle-browser", requestedModel: "chatgpt_current_pro", executionSurface: "chatgpt_standard" },
    authReadiness: "unknown",
    allowUnknownAuth: true,
    prompt: "Review only. Return findings, not commands.",
    files: [file],
    exclusions: ["!**/.env"],
    retainHours: 24,
  };
  return { root, stateRoot: path.join(root, "state"), input };
}

function claimPrepared(fixtureValue) {
  const prepared = build(fixtureValue.input, { root: fixtureValue.stateRoot });
  const state = createEmptyState();
  refreshCapability(state, { carrierId: "oracle-browser", accountScope: "standard", observedModel: "chatgpt_current_pro" });
  const route = admitRoute(state, {
    role: "review.deep",
    adapterId: "oracle-browser",
    dispatchKind: "subagent_create",
    frozenInputDigest: prepared.frozenInputDigest,
    accountScope: "standard",
    sessionId: prepared.sessionId,
  });
  assert.equal(route.claimed.ok, true, JSON.stringify(route.claimed));
  Object.assign(fixtureValue.input, {
    sessionId: prepared.sessionId,
    frozenInputDigest: prepared.frozenInputDigest,
    reservationId: route.admitted.reservation.reservationId,
    policyDigest: POLICY_DIGEST,
    claimed: { id: route.claimed.claimId, state: "claimed" },
  });
  fixtureValue.routerState = state;
  return prepared;
}

function privateInspector(fixtureValue, mutate = (value) => value) {
  const state = fixtureValue.routerState;
  assert.equal(validateState(state).ok, true, JSON.stringify(validateState(state)));
  const inspect = (request) => {
    const response = handleRequest(request, { catalog: ROUTER_POLICY, state, now: ROUTER_NOW }).response;
    assert.equal(response.ok, true, JSON.stringify(response));
    return response.ok ? { ...response, claim: mutate(response.claim) } : response;
  };
  inspect.state = state;
  return inspect;
}

function lifecycleInspector(input) {
  const state = createEmptyState();
  refreshCapability(state, { carrierId: "oracle-browser", accountScope: "standard", observedModel: "chatgpt_current_pro" });
  refreshCapability(state, { carrierId: "oracle-homebrew-lifecycle", accountScope: "standard", observedModel: "oracle-homebrew-lifecycle" });
  const route = admitRoute(state, {
    role: "lifecycle.oracle",
    adapterId: "oracle-homebrew-lifecycle",
    dispatchKind: "lifecycle_action",
    frozenInputDigest: input.frozenInputDigest,
    accountScope: "standard",
    sessionId: "lifecycle_session",
  });
  assert.equal(route.claimed.ok, true, JSON.stringify(route.claimed));
  input.lifecycleReservationId = route.admitted.reservation.reservationId;
  input.lifecycleClaim = { id: route.claimed.claimId };
  input.policyDigest = POLICY_DIGEST;
  const inspect = (request) => {
    const response = handleRequest(request, { catalog: ROUTER_POLICY, state, now: ROUTER_NOW }).response;
    assert.equal(response.ok, true, JSON.stringify(response));
    return response;
  };
  inspect.state = state;
  return inspect;
}

const fakeCarrier = { binary: "/fixed/oracle", version: "0.17.3", identity: {} };

function privateClaimPath(value, claim = value.input.claimed.id) {
  const digest = crypto.createHash("sha256").update(claim).digest("hex");
  return path.join(value.stateRoot, "claims", `${digest}.json`);
}

function writeBrowserSession(value, sessionId, {
  desiredModel = "GPT-5.6 Sol",
  modelStrategy = "select",
  thinkingTime = "pro",
  requestedModel = "GPT-5.6 Sol",
  resolvedLabel = "GPT-5.6 Sol",
  status = "switched",
  verified = true,
  source = "chatgpt-model-picker",
  output = "[browser] Thinking time: Pro (already selected)\nAnswer:\nFinding: keep this private.\n",
} = {}) {
  const sessions = path.join(value.stateRoot, "oracle-home", "sessions");
  const directory = path.join(sessions, oracleSessionSlug(sessionId));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(sessions, 0o700);
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(path.join(directory, "meta.json"), JSON.stringify({
    model: "gpt-5.6-sol",
    browser: {
      config: { desiredModel, modelStrategy, thinkingTime },
      modelSelection: { requestedModel, resolvedLabel, strategy: modelStrategy, status, verified, source },
    },
  }), { mode: 0o600 });
  fs.writeFileSync(path.join(directory, "output.log"), output, { mode: 0o600 });
}

test("browser observation evaluator accepts only one pre-answer Pro control record", () => {
  const metadata = {
    browser: {
      config: { desiredModel: "GPT-5.6 Sol", modelStrategy: "select", thinkingTime: "pro" },
      modelSelection: { requestedModel: "GPT-5.6 Sol", resolvedLabel: "GPT-5.6 Sol", strategy: "select", status: "switched", verified: true, source: "chatgpt-model-picker" },
    },
  };
  const cases = [
    ["one record", "[browser] Thinking time: Pro (already selected)\nAnswer:\n", { observedModel: "gpt-5.6-sol", reason: null }],
    ["duplicate record", "[browser] Thinking time: Pro\n[browser] Thinking time: Pro\nAnswer:\n", { observedModel: "gpt-5.6-sol", reason: "oracle_observed_pro_effort_unavailable" }],
    ["answer-only record", "Answer:\n[browser] Thinking time: Pro\n", { observedModel: "gpt-5.6-sol", reason: "oracle_observed_pro_effort_unavailable" }],
    ["missing metadata", "[browser] Thinking time: Pro\nAnswer:\n", { observedModel: "unknown", reason: "oracle_observed_model_unavailable" }],
  ];
  for (const [name, output, expected] of cases) assert.deepEqual(evaluateBrowserSession(name === "missing metadata" ? null : metadata, output), expected, name);
});

test("CLI receipt writer prints a mismatch receipt before exiting nonzero", () => {
  const receipt = { producer: "oracle-browser", status: "settled", reason: "oracle_observed_model_mismatch", observedModel: "gpt-5.5", authReadiness: "unknown" };
  const moduleUrl = new URL("./oracle-route.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `import { writeCliResult } from ${JSON.stringify(moduleUrl)}; writeCliResult(${JSON.stringify(receipt)});`], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), receipt);
});

test("CLI receipt writer fails closed for uncompleted receipts", () => {
  const moduleUrl = new URL("./oracle-route.mjs", import.meta.url).href;
  for (const receipt of [
    { producer: "oracle-browser", status: "no_start", reason: "oracle_dry_run_failed" },
    { producer: "oracle-browser", status: "ambiguous", reason: "claim_already_in_progress" },
    { status: "blocked", reason: "invalid_request" },
  ]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `import { writeCliResult } from ${JSON.stringify(moduleUrl)}; writeCliResult(${JSON.stringify(receipt)});`], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), receipt);
  }
});

test("build freezes bounded input without trusting a caller claim or invoking a carrier", () => {
  const value = fixture();
  const result = build(value.input, { root: value.stateRoot });
  assert.equal(result.status, "prepared");
  assert.match(result.frozenInputDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.fileCount, 1);
});

test("dispatch requires an exact private resolver claim binding before carrier work", () => {
  const value = fixture();
  claimPrepared(value);
  let calls = 0;
  assert.throws(() => dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim: privateInspector(value, (claim) => ({ ...claim, binding: { ...claim.binding, adapterId: "codex-task-create" } })),
    resolveCarrier: () => { calls += 1; return fakeCarrier; },
  }), /claim_unverified/);
  assert.equal(calls, 0);
});

test("settled review writes a private bounded finding artifact and router receipt, then removes the bundle", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  writeBrowserSession(value, prepared.sessionId);
  const calls = [];
  let revalidations = 0;
  const inspectClaim = privateInspector(value);
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => { revalidations += 1; },
    run: (binary, args) => {
      calls.push({ binary, args });
      return args[0] === "--dry-run"
        ? { status: 0, stdout: "dry", stderr: "" }
        : { status: 0, stdout: "Finding: keep this private.\n", stderr: "" };
    },
  });
  assert.equal(result.status, "settled");
  assert.equal(result.producer, "oracle-browser");
  assert.equal(result.adapterVersion, "v1");
  assert.equal(result.claimId, value.input.claimed.id);
  assert.equal(result.frozenInputDigest, prepared.frozenInputDigest);
  assert.equal(result.observedModel, "gpt-5.6-sol");
  assert.equal(routeExitCode(result), 0);
  assert.equal(result.resultArtifact.sha256, crypto.createHash("sha256").update("Finding: keep this private.\n").digest("hex"));
  assert.equal(fs.readFileSync(result.resultArtifact.path, "utf8"), "Finding: keep this private.\n");
  assert.equal(JSON.stringify(result).includes("Finding:"), false);
  assert.equal(fs.existsSync(path.join(value.stateRoot, "bundles", prepared.sessionId)), false);
  assert.equal(calls.length, 2);
  assert.equal(revalidations, 2);
  assert.deepEqual(calls[1].args.slice(0, 8), ["--engine", "browser", "--model", "gpt-5.6-sol", "--browser-model-strategy", "select", "--browser-thinking-time", "pro"]);
  assert.match(calls[1].args[calls[1].args.indexOf("--slug") + 1], /^oracle-route-[a-f0-9]{10}-[a-f0-9]{10}$/);
  const forged = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "reconcile",
    reservationId: value.input.reservationId,
    frozenInputDigest: prepared.frozenInputDigest,
    receipt: { ...result, hostScope: "forged" },
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW, trustedReceiptImporter: createTrustedReceiptImporter(value.stateRoot) });
  assert.equal(forged.response.ok, false);
  assert.equal(forged.response.reason, "trusted_receipt_importer_failed");
  const reconciled = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "reconcile",
    reservationId: value.input.reservationId,
    frozenInputDigest: prepared.frozenInputDigest,
    receipt: result,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW, trustedReceiptImporter: createTrustedReceiptImporter(value.stateRoot) });
  assert.equal(reconciled.response.ok, true, JSON.stringify(reconciled.response));
  assert.equal(reconciled.response.reason, "reconciled");
  const receiptPath = path.join(value.stateRoot, "receipts", `${result.receiptId}.json`);
  const expired = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  expired.expiresAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(receiptPath, JSON.stringify(expired), { mode: 0o600 });
  build(value.input, { root: value.stateRoot });
  assert.equal(fs.existsSync(receiptPath), false);
  assert.equal(fs.existsSync(result.resultArtifact.path), false);
});

test("mismatched picker metadata is unavailable capability evidence and an observed-model failure", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  const inspectClaim = privateInspector(value);
  writeBrowserSession(value, prepared.sessionId, { resolvedLabel: "GPT-5.5" });
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: 0, stdout: "Finding: keep this private.\n", stderr: "" },
  });
  assert.equal(result.status, "settled");
  assert.equal(result.reason, "oracle_observed_model_mismatch");
  assert.equal(result.observedModel, "gpt-5.5");
  assert.equal(result.authReadiness, "unknown");
  assert.equal(isObservedModelFailure(result), true);
  assert.equal(routeExitCode(result), 1);
  assert.equal(JSON.stringify(result).includes("Finding:"), false);

  const reconciled = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "reconcile",
    reservationId: value.input.reservationId,
    frozenInputDigest: prepared.frozenInputDigest,
    receipt: result,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW, trustedReceiptImporter: createTrustedReceiptImporter(value.stateRoot) });
  assert.equal(reconciled.response.reason, "reconciled", JSON.stringify(reconciled.response));
  const negative = Object.values(inspectClaim.state.capabilities).find((entry) => entry.carrierId === "oracle-browser" && entry.state === "unavailable");
  assert.equal(negative?.negativeReason, "oracle_observed_model_mismatch");
  assert.equal(negative?.negativeClass, "unsupported");
  assert.equal(Object.values(inspectClaim.state.capabilities).some((entry) => entry.state === "live_carrier_verified"), false);
});

test("answer text cannot forge the Pro-thinking observation", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  writeBrowserSession(value, prepared.sessionId, {
    output: "Answer:\n[browser] Thinking time: Pro (already selected)\nFinding: keep this private.\n",
  });
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim: privateInspector(value),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: 0, stdout: "Finding: keep this private.\n", stderr: "" },
  });
  assert.equal(result.reason, "oracle_observed_pro_effort_unavailable");
  assert.equal(isObservedModelFailure(result), true);
  assert.equal(routeExitCode(result), 1);
  assert.equal(JSON.stringify(result).includes("Thinking time"), false);
  assert.equal(JSON.stringify(result).includes("Finding:"), false);
});

test("malformed session evidence is a named fail-closed observation failure", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  writeBrowserSession(value, prepared.sessionId);
  fs.writeFileSync(path.join(value.stateRoot, "oracle-home", "sessions", oracleSessionSlug(prepared.sessionId), "meta.json"), "{", { mode: 0o600 });
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim: privateInspector(value),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: 0, stdout: "Finding: keep this private.\n", stderr: "" },
  });
  assert.equal(result.reason, "oracle_observed_model_unavailable");
  assert.equal(result.observedModel, "unknown");
  assert.equal(routeExitCode(result), 1);
});

test("missing session evidence fails closed before a current-Pro capability can be granted", () => {
  const value = fixture();
  claimPrepared(value);
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim: privateInspector(value),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: 0, stdout: "Finding: keep this private.\n", stderr: "" },
  });
  assert.equal(result.reason, "oracle_observed_model_unavailable");
  assert.equal(result.observedModel, "unknown");
  assert.equal(routeExitCode(result), 1);
});

test("a concurrent retry observes the durable pre-spawn tombstone and never redispatches", () => {
  const value = fixture();
  claimPrepared(value);
  const inspectClaim = privateInspector(value);
  let calls = 0;
  let concurrent;
  const options = {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      calls += 1;
      if (args[0] === "--dry-run") {
        concurrent = dispatch(value.input, options);
        return { status: 0, stdout: "dry", stderr: "" };
      }
      return { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } };
    },
  };
  const first = dispatch(value.input, options);
  assert.equal(concurrent.status, "ambiguous");
  assert.equal(first.status, "started");
  assert.equal(first.reason, "detached");
  assert.equal(calls, 2);
  const retry = dispatch(value.input, options);
  assert.equal(retry.receiptId, first.receiptId);
  assert.equal(calls, 2);
  assert.throws(() => dispatch(value.input, { ...options, inspectClaim: () => ({ ok: false }) }), /claim_unverified/);

  const ambiguousPath = path.join(value.stateRoot, "receipts", `${concurrent.receiptId}.json`);
  const ambiguous = JSON.parse(fs.readFileSync(ambiguousPath, "utf8"));
  ambiguous.expiresAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(ambiguousPath, JSON.stringify(ambiguous), { mode: 0o600 });
  const claimPath = privateClaimPath(value);
  const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  Object.assign(claim, { state: "ambiguous", receiptId: concurrent.receiptId, expiresAt: ambiguous.expiresAt });
  fs.writeFileSync(claimPath, JSON.stringify(claim), { mode: 0o600 });
  build(value.input, { root: value.stateRoot });
  assert.equal(fs.existsSync(ambiguousPath), false);
  assert.equal(fs.existsSync(path.join(value.stateRoot, "bundles", value.input.sessionId)), false);
  assert.equal(JSON.parse(fs.readFileSync(claimPath, "utf8")).state, "expired");
});

test("expired detached state removes private content and leaves a terminal redispatch tombstone", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  let calls = 0;
  const options = {
    root: value.stateRoot,
    inspectClaim: privateInspector(value),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      calls += 1;
      return args[0] === "--dry-run"
        ? { status: 0, stdout: "dry", stderr: "" }
        : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } };
    },
  };
  const started = dispatch(value.input, options);
  const receiptPath = path.join(value.stateRoot, "receipts", `${started.receiptId}.json`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.expiresAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(receiptPath, JSON.stringify(receipt), { mode: 0o600 });

  build(value.input, { root: value.stateRoot });

  assert.equal(fs.existsSync(receiptPath), false);
  assert.equal(fs.existsSync(path.join(value.stateRoot, "bundles", prepared.sessionId)), false);
  const tombstone = JSON.parse(fs.readFileSync(privateClaimPath(value), "utf8"));
  assert.deepEqual(Object.keys(tombstone).sort(), ["claimId", "expiredAt", "kind", "producer", "reason", "receiptId", "state", "version"]);
  assert.equal(tombstone.state, "expired");
  assert.equal(JSON.stringify(tombstone).includes(prepared.frozenInputDigest), false);
  assert.throws(() => dispatch(value.input, options), /session_expired/);
  assert.throws(() => reattach(value.input, options), /session_expired/);
  assert.equal(calls, 2);
});

test("expired and substituted reattach locks are handled without following links", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  const inspectClaim = privateInspector(value);
  const options = {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } },
  };
  const started = dispatch(value.input, options);
  const lock = `${privateClaimPath(value)}.reattach`;
  fs.writeFileSync(lock, JSON.stringify({
    version: 1,
    kind: "oracle_reattach_lock",
    claimId: value.input.claimed.id,
    sessionId: prepared.sessionId,
    frozenInputDigest: prepared.frozenInputDigest,
    createdAt: "1999-01-01T00:00:00.000Z",
    expiresAt: "2000-01-01T00:00:00.000Z",
  }), { mode: 0o600 });
  writeBrowserSession(value, prepared.sessionId);
  const settled = reattach(value.input, {
    ...options,
    run: () => ({ status: 0, stdout: "Recovered.\n", stderr: "" }),
  });
  assert.equal(settled.status, "settled");
  assert.equal(fs.existsSync(lock), false);

  const linked = fixture();
  claimPrepared(linked);
  const linkedOptions = {
    root: linked.stateRoot,
    inspectClaim: privateInspector(linked),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } },
  };
  const linkedStarted = dispatch(linked.input, linkedOptions);
  assert.equal(linkedStarted.status, "started");
  const target = path.join(linked.root, "lock-target.json");
  fs.writeFileSync(target, JSON.stringify({ claimId: linked.input.claimed.id }), { mode: 0o600 });
  const linkedLock = `${privateClaimPath(linked)}.reattach`;
  fs.symlinkSync(target, linkedLock);
  assert.throws(() => reattach(linked.input, linkedOptions), /unsafe_private_state/);
  assert.equal(fs.existsSync(target), true);
  assert.equal(fs.lstatSync(linkedLock).isSymbolicLink(), true);
});

test("dispatch uses the frozen retention argument rather than mutable caller input", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  writeBrowserSession(value, prepared.sessionId);
  value.input.retainHours = 1;
  let invocation;
  const result = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim: privateInspector(value),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      if (args[0] !== "--dry-run") invocation = args;
      return { status: 0, stdout: args[0] === "--dry-run" ? "dry" : "Finding.\n", stderr: "" };
    },
  });
  assert.equal(result.retentionClass, "local-private-24h");
  assert.equal(invocation[invocation.indexOf("--retain-hours") + 1], "24");
});

test("reattach uses the same verified claim and stores findings without a new dispatch", () => {
  const value = fixture();
  const prepared = claimPrepared(value);
  const inspectClaim = privateInspector(value);
  let calls = 0;
  const started = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      calls += 1;
      return args[0] === "--dry-run"
        ? { status: 0, stdout: "dry", stderr: "" }
        : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } };
    },
  });
  assert.equal(started.status, "started");
  writeBrowserSession(value, prepared.sessionId, { output: "[browser] Thinking time: Pro (already selected)\nAnswer:\nReattached finding.\n" });
  const result = reattach(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      calls += 1;
      assert.deepEqual(args, ["session", oracleSessionSlug(prepared.sessionId), "--render"]);
      return { status: 0, stdout: "Reattached finding.\n", stderr: "" };
    },
  });
  assert.equal(result.status, "settled");
  assert.equal(result.reattached, true);
  assert.equal(fs.readFileSync(result.resultArtifact.path, "utf8"), "Reattached finding.\n");
  assert.equal(fs.existsSync(path.join(value.stateRoot, "bundles", prepared.sessionId)), false);
  assert.equal(calls, 3);
});

test("reattach fails closed when its session lacks durable Pro evidence", () => {
  const value = fixture();
  claimPrepared(value);
  const inspectClaim = privateInspector(value);
  const started = dispatch(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } },
  });
  assert.equal(started.status, "started");
  const result = reattach(value.input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: () => ({ status: 0, stdout: "Reattached finding.\n", stderr: "" }),
  });
  assert.equal(result.status, "settled");
  assert.equal(result.reason, "oracle_observed_model_unavailable");
  assert.equal(result.observedModel, "unknown");
  assert.equal(routeExitCode(result), 1);
});

test("O_NOFOLLOW input and private-state checks reject symlinks and frozen mutation", () => {
  const value = fixture();
  const frozen = freezeInput(value.input, value.stateRoot);
  fs.appendFileSync(frozen.promptPath, "changed");
  assert.throws(() => revalidateFrozen(frozen), /frozen_input_changed/);
  const link = path.join(value.root, "link.txt");
  fs.symlinkSync(value.input.files[0], link);
  value.input.files = [link];
  assert.throws(() => build(value.input, { root: path.join(value.root, "other") }), /non_regular_input/);
  const linkedDirectory = path.join(value.root, "linked-directory");
  fs.symlinkSync(value.root, linkedDirectory);
  value.input.files = [path.join(linkedDirectory, "review.txt")];
  assert.throws(() => build(value.input, { root: path.join(value.root, "other-ancestor") }), /non_regular_input/);
  const badState = path.join(value.root, "bad-state");
  fs.mkdirSync(badState, { mode: 0o700 });
  fs.symlinkSync(value.root, path.join(badState, "bundles"));
  assert.throws(() => build({ ...value.input, files: [path.join(value.root, "review.txt")] }, { root: badState }), /unsafe_route_home/);
});

test("Homebrew-style executable symlinks canonicalize and identity drift blocks", () => {
  const value = fixture();
  const cellar = path.join(value.root, "Cellar", "oracle", "0.17.0", "bin");
  fs.mkdirSync(cellar, { recursive: true });
  const actual = path.join(cellar, "oracle");
  fs.writeFileSync(actual, "#!/bin/sh\n", { mode: 0o755 });
  const linked = path.join(value.root, "oracle");
  fs.symlinkSync(actual, linked);
  const binding = bindExecutable(linked);
  assert.equal(binding.binary, fs.realpathSync(actual));
  assert.ok(binding.ancestors.length > 0);
  revalidateExecutable(binding);
  fs.chmodSync(path.join(value.root, "Cellar"), 0o750);
  assert.throws(() => revalidateExecutable(binding), /oracle_executable_changed/);
  fs.chmodSync(path.join(value.root, "Cellar"), 0o755);
  revalidateExecutable(binding);
  fs.appendFileSync(actual, "# changed\n");
  assert.throws(() => revalidateExecutable(binding), /oracle_executable_changed/);
  fs.chmodSync(actual, 0o775);
  assert.throws(() => bindExecutable(actual), /unsafe_oracle_executable/);

  const unsafeAncestor = path.join(value.root, "unsafe-ancestor");
  fs.mkdirSync(unsafeAncestor, { mode: 0o777 });
  fs.chmodSync(unsafeAncestor, 0o777);
  const unsafeBinary = path.join(unsafeAncestor, "oracle");
  fs.writeFileSync(unsafeBinary, "#!/bin/sh\n", { mode: 0o755 });
  assert.throws(() => bindExecutable(unsafeBinary), /unsafe_oracle_executable/);

  const arbitraryGroupWritable = path.join(value.root, "arbitrary-group-write");
  fs.mkdirSync(arbitraryGroupWritable, { mode: 0o775 });
  fs.chmodSync(arbitraryGroupWritable, 0o775);
  const arbitraryBinary = path.join(arbitraryGroupWritable, "oracle");
  fs.writeFileSync(arbitraryBinary, "#!/bin/sh\n", { mode: 0o755 });
  assert.throws(() => bindExecutable(arbitraryBinary), /unsafe_oracle_executable/);
});

test("the installed canonical Homebrew brew executable satisfies the fixed attestation", {
  skip: !fs.existsSync("/opt/homebrew/bin/brew"),
}, () => {
  const binding = bindExecutable("/opt/homebrew/bin/brew");
  assert.equal(binding.binary, fs.realpathSync("/opt/homebrew/bin/brew"));
  assert.ok(binding.ancestors.some((entry) => entry.path === "/opt/homebrew"));
  revalidateExecutable(binding);
});

test("dry-run no-start and auth settlement clean bundles without leaking diagnostics", () => {
  const first = fixture();
  claimPrepared(first);
  const noStart = dispatch(first.input, {
    root: first.stateRoot,
    inspectClaim: privateInspector(first),
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: () => ({ status: 1, stdout: "", stderr: "local validation failed" }),
  });
  assert.equal(noStart.status, "no_start");
  assert.equal(fs.existsSync(path.join(first.stateRoot, "bundles", first.input.sessionId)), false);

  const second = fixture();
  claimPrepared(second);
  const inspectClaim = privateInspector(second);
  const auth = dispatch(second.input, {
    root: second.stateRoot,
    inspectClaim,
    resolveCarrier: () => fakeCarrier,
    revalidateCarrier: () => {},
    run: (_binary, args) => args[0] === "--dry-run"
      ? { status: 0, stdout: "dry", stderr: "" }
      : { status: 1, stdout: "Choose an account to log in", stderr: "" },
  });
  assert.equal(auth.status, "settled");
  assert.equal(auth.reason, "auth_context_unavailable");
  assert.equal(JSON.stringify(auth).includes("Choose an account"), false);
  const reconciled = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "reconcile",
    reservationId: second.input.reservationId,
    frozenInputDigest: second.input.frozenInputDigest,
    receipt: auth,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW, trustedReceiptImporter: createTrustedReceiptImporter(second.stateRoot) });
  assert.equal(reconciled.response.ok, true, JSON.stringify(reconciled.response));
  const negative = Object.values(inspectClaim.state.capabilities).find((entry) => entry.carrierId === "oracle-browser" && entry.state === "unavailable");
  assert.equal(negative?.state, "unavailable");
  assert.equal(negative?.negativeReason, "auth_context_unavailable");
  assert.equal(negative?.negativeClass, "auth");
});

test("claimed Homebrew lifecycle is fixed, idempotent, and requires a fresh review", () => {
  const value = fixture();
  const input = {
    contractVersion: "railyard/model-routing/v1",
    lifecycleClaim: { id: "claim_lifecycle" },
    lifecycleReservationId: "reservation_lifecycle",
    policyDigest: POLICY_DIGEST,
    frozenInputDigest: "d".repeat(64),
  };
  const inspectClaim = lifecycleInspector(input);
  let carrierCalls = 0;
  let brewRuns = 0;
  let revalidations = 0;
  const options = {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => {
      carrierCalls += 1;
      return { ...fakeCarrier, version: carrierCalls === 1 ? "0.17.0" : "0.18.0" };
    },
    resolveBrew: () => ({ binary: "/fixed/brew", identity: {} }),
    revalidateCarrier: () => { revalidations += 1; },
    run: (binary, args, spawnOptions) => {
      brewRuns += 1;
      assert.equal(binary, "/fixed/brew");
      assert.deepEqual(args, ["upgrade", "steipete/tap/oracle"]);
      assert.deepEqual(Object.keys(spawnOptions.env), ["PATH"]);
      assert.equal(args.includes("sudo"), false);
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  const result = lifecycle(input, options);
  assert.equal(result.status, "settled");
  assert.equal(result.reason, null);
  assert.equal(result.producer, "oracle-homebrew-lifecycle");
  assert.equal(result.dispatchKind, "lifecycle_action");
  assert.equal(result.sessionId, "lifecycle_session");
  assert.equal(result.beforeVersion, "0.17.0");
  assert.equal(result.afterVersion, "0.18.0");
  assert.equal(result.formula, "steipete/tap/oracle");
  assert.equal(result.freshReviewRequired, true);
  assert.deepEqual(result.chargedMeters, { marginalUsd: 0, codexCredits: 0, openaiApiSpend: 0 });
  assert.equal(brewRuns, 1);
  assert.equal(revalidations, 1);

  const cached = lifecycle(input, options);
  assert.equal(cached.receiptId, result.receiptId);
  assert.equal(brewRuns, 1);

  const reconciled = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "reconcile",
    reservationId: input.lifecycleReservationId,
    frozenInputDigest: input.frozenInputDigest,
    receipt: result,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW, trustedReceiptImporter: createTrustedReceiptImporter(value.stateRoot) });
  assert.equal(reconciled.response.ok, true, JSON.stringify(reconciled.response));
  const requirementId = Object.keys(inspectClaim.state.lifecycleReviewRequirements)[0];
  assert.match(requirementId, /^fresh-review_/);
  assert.equal(inspectClaim.state.lifecycleReviewRequirements[requirementId].fulfilled, false);

  const reviewAdmission = handleRequest(routerRequest("admit", {
    requestId: `oracle_route_test_${requestSequence}`,
    role: "review.deep",
    adapterId: "oracle-browser",
    dispatchKind: "subagent_create",
    frozenInputDigest: "e".repeat(64),
    forecast: {},
    scopes: { task: "fresh_review_scope" },
    hostScope: "local",
    accountScope: "standard",
  }), { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW });
  assert.equal(reviewAdmission.response.ok, true, JSON.stringify(reviewAdmission.response));
  const review = reviewAdmission.response.reservation;
  const identity = {
    hostScope: "local",
    accountScope: "standard",
    dispatchKind: "subagent_create",
    sessionId: "review_session",
    toolId: "oracle-browser",
    toolVersion: "v1",
  };
  const withoutRequirement = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "claim-dispatch",
    reservationId: review.reservationId,
    frozenInputDigest: review.frozenInputDigest,
    dispatchIdentity: identity,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW });
  assert.equal(withoutRequirement.response.reason, "fresh_post_lifecycle_review_required");
  const withRequirement = handleRequest({
    contractVersion: "railyard/model-routing/v1",
    command: "claim-dispatch",
    reservationId: review.reservationId,
    frozenInputDigest: review.frozenInputDigest,
    dispatchIdentity: identity,
    postLifecycleRequirementId: requirementId,
  }, { catalog: ROUTER_POLICY, state: inspectClaim.state, now: ROUTER_NOW });
  assert.equal(withRequirement.response.ok, true, JSON.stringify(withRequirement.response));
  assert.equal(withRequirement.response.claimed.postLifecycleRequirementId, requirementId);
});

test("claimed lifecycle upgrades a securely resolved outdated Oracle", () => {
  const value = fixture();
  const input = {
    contractVersion: "railyard/model-routing/v1",
    lifecycleClaim: { id: "claim_outdated_lifecycle" },
    lifecycleReservationId: "reservation_outdated_lifecycle",
    policyDigest: POLICY_DIGEST,
    frozenInputDigest: "9".repeat(64),
  };
  const inspectClaim = lifecycleInspector(input);
  let calls = 0;
  const result = lifecycle(input, {
    root: value.stateRoot,
    inspectClaim,
    resolveCarrier: () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("oracle_version_unsupported");
        error.code = "oracle_version_unsupported";
        error.installedVersion = "0.16.9";
        throw error;
      }
      return { ...fakeCarrier, version: "0.18.0" };
    },
    resolveBrew: () => ({ binary: "/fixed/brew", identity: {} }),
    revalidateCarrier: () => {},
    run: (_binary, args) => {
      assert.deepEqual(args, ["upgrade", "steipete/tap/oracle"]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "settled");
  assert.equal(result.beforeVersion, "0.16.9");
  assert.equal(result.afterVersion, "0.18.0");
  assert.equal(result.freshReviewRequired, true);
});

test("oracle API and lifecycle without a resolver descriptor fail before mutation", () => {
  const value = fixture();
  value.input.route.adapter = "oracle-api";
  assert.throws(() => build(value.input, { root: value.stateRoot }), /unsupported_adapter/);
  let calls = 0;
  assert.throws(() => lifecycle({
    contractVersion: "railyard/model-routing/v1",
    allowLifecycleMutation: true,
    lifecycleClaim: { id: "claim_lifecycle" },
    lifecycleReservationId: "reservation_lifecycle",
    policyDigest: POLICY_DIGEST,
    frozenInputDigest: "b".repeat(64),
  }, {
    root: value.stateRoot,
    inspectClaim: () => ({ ok: false, reason: "claim_binding_not_found" }),
    run: () => { calls += 1; return { status: 0 }; },
  }), /lifecycle_claim_unverified/);
  assert.equal(calls, 0);

  const review = fixture();
  claimPrepared(review);
  assert.throws(() => lifecycle({
    contractVersion: "railyard/model-routing/v1",
    lifecycleClaim: { id: review.input.claimed.id },
    lifecycleReservationId: review.input.reservationId,
    policyDigest: review.input.policyDigest,
    frozenInputDigest: review.input.frozenInputDigest,
  }, {
    root: path.join(review.root, "lifecycle-state"),
    inspectClaim: privateInspector(review),
    run: () => { calls += 1; return { status: 0 }; },
  }), /lifecycle_claim_unverified/);
  assert.equal(calls, 0);
});
