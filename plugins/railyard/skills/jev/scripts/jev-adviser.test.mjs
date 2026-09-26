import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";
import { advise, DEFAULT_THRESHOLDS, ENDPOINT, LIMITS, MODEL, readInput } from "./jev-adviser.mjs";

const SCRIPT = fileURLToPath(new URL("./jev-adviser.mjs", import.meta.url));
const SECRET = "test-key-never-print-78542";
const PRIVATE_STATE = "Private caller summary that must never appear in output.";

function input(mode = "workflow") {
  const candidates = mode === "workflow" ? [
    { id: "native", workflow: "native", description: "Locally available native tools suffice for a bounded edit." },
    { id: "plan", workflow: "compound-engineering:ce-plan", description: "Available planning stage for unresolved design." },
  ] : mode === "allocation" ? [
    { id: "pair_a", model: "provider/model-a", reasoning_effort: "high", description: "Available pair; completed comparable accepted work in 3 minutes." },
    { id: "pair_b", model: "provider/model-b", reasoning_effort: "medium", description: "Available pair; completed comparable accepted work in 5 minutes." },
  ] : mode === "evidence-selection" ? [
    { id: "failure_log", description: "Available failure log covering the first rejected connection; inspect for timing evidence." },
    { id: "change_diff", description: "Available diff for the last passing revision; inspect for changed retry boundaries." },
  ] : mode === "work-priority" ? [
    { id: "reproduce", description: "Ready, authorized bounded task: reproduce the reported timeout; no dependencies remain." },
    { id: "check_contract", description: "Ready, authorized bounded check: compare timeout behavior with the documented contract." },
  ] : [
    { id: "reproduce", description: "Reproduce the reported failure with a minimal example for the CE review owner." },
    { id: "inspect", description: "Inspect the changed boundary and gather evidence for the CE review owner." },
  ];
  return { mode, state: PRIVATE_STATE, candidates };
}

function responseBody(ids = ["native", "plan", "no_match"], overrides = {}) {
  const choice = ids[0];
  return {
    model: "jev-1.13.0",
    answers: {
      selection: { type: "choice", choice, probabilities: Object.fromEntries(ids.map((id) => [id, id === choice ? 0.9 : 0.1 / (ids.length - 1)])), confidence: 0.91 },
      sufficient_context: { type: "noul", noul: 0.95 },
    },
    usage: { input_tokens: 250, output_tokens: 40 },
    ...overrides,
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" }, ...init });
}

function fakeProvider(transform = (body) => body) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const request = JSON.parse(options.body);
    const ids = Object.keys(request.questions.selection.criteria);
    return jsonResponse(transform(responseBody(ids), request));
  };
  return { calls, fetchImpl };
}

function assertEnvelope(result, status, reason) {
  assert.deepEqual(Object.keys(result), ["schema", "advisoryOnly", "status", "mode", "reason", "recommendation", "judgment", "provider"]);
  assert.equal(result.schema, "railyard/jev-advice/v1");
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.status, status);
  assert.equal(result.reason, reason);
  if (status !== "recommended") assert.equal(result.recommendation, null);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SECRET));
  assert.ok(!serialized.includes(PRIVATE_STATE));
}

test("every CE stage in Deliver's workflow table is accepted by Jev", async () => {
  const source = readFileSync(new URL("../../deliver/SKILL.md", import.meta.url), "utf8");
  const table = source.split("\n\n").find((block) => block.trimStart().startsWith("| Work") && block.includes("compound-engineering:"));
  assert.ok(table, "Deliver workflow table must be present");
  const workflows = [...new Set([...table.matchAll(/`(compound-engineering:[a-z-]+)`/g)].map((match) => match[1]))];
  assert.ok(workflows.length > 0, "Deliver must expose selectable CE stages");
  for (const workflow of workflows) {
    const provider = fakeProvider();
    const value = { mode: "workflow", state: "Choose this available workflow for the requested delivery stage.",
      candidates: [{ id: "stage", workflow, description: "Available delivery workflow checked by the caller." }] };
    const result = await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl });
    assert.equal(result.status, "recommended", `${workflow}: ${result.reason}`);
    assert.deepEqual(result.recommendation, { candidateId: "stage" });
    const wire = JSON.parse(provider.calls[0].options.body);
    assert.ok(wire.questions.selection.criteria.stage.includes(workflow));
  }
});

test("CLI invocation through file or directory symlinks returns its JSON result", (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jev-cli-links-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fileLink = path.join(directory, "adviser.mjs");
  const directoryLink = path.join(directory, "scripts");
  symlinkSync(SCRIPT, fileLink);
  symlinkSync(path.dirname(SCRIPT), directoryLink, "dir");
  for (const entry of [fileLink, path.join(directoryLink, "jev-adviser.mjs")]) {
    const result = spawnSync(process.execPath, [entry, "--offline"], {
      encoding: "utf8", timeout: 5000, input: JSON.stringify(input()),
      env: { ...process.env, TYPESAFE_API_KEY: SECRET },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assertEnvelope(JSON.parse(result.stdout), "unavailable", "offline");
  }
});

for (const mode of ["workflow", "allocation", "review-triage", "evidence-selection", "work-priority"]) {
  test(`enabled ${mode} uses one fixed API request and returns only an existing candidate ID`, async () => {
    const value = input(mode);
    const provider = fakeProvider();
    const result = await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl });
    assertEnvelope(result, "recommended", "thresholds_met");
    assert.deepEqual(result.recommendation, { candidateId: value.candidates[0].id });
    assert.equal(result.judgment.selection.confidence, 0.91);
    assert.equal(result.judgment.selection.probabilities[value.candidates[0].id], 0.9);
    assert.equal(result.judgment.sufficientContext, 0.95);
    assert.deepEqual(result.provider, { model: "jev-1.13.0", usage: { input_tokens: 250, output_tokens: 40 } });
    assert.equal(provider.calls.length, 1);
    const { url, options } = provider.calls[0];
    assert.equal(url, ENDPOINT);
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "manual");
    assert.deepEqual(options.headers, { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", Accept: "application/json" });
    assert.ok(options.signal instanceof AbortSignal);
    const wire = JSON.parse(options.body);
    assert.deepEqual(Object.keys(wire), ["model", "state", "questions"]);
    assert.equal(wire.model, MODEL);
    assert.deepEqual(wire.state, { task: value.state, candidates: value.candidates });
    assert.deepEqual(Object.keys(wire.questions), ["selection", "sufficient_context"]);
    assert.equal(wire.questions.selection.type, "choice");
    assert.equal(wire.questions.sufficient_context.type, "noul");
    assert.match(wire.questions.selection.instructions, /Which candidate/);
    assert.match(wire.questions.sufficient_context.instructions, /independently/);
    if (mode !== "allocation") assert.match(wire.questions.sufficient_context.instructions, /unknown root cause or unresolved finding can justify investigating/);
    assert.deepEqual(Object.keys(wire.questions.selection.criteria), [...value.candidates.map(({ id }) => id), "no_match"]);
    assert.ok(!options.body.includes(SECRET));
    assert.ok(!options.body.includes("minConfidence"));
    assert.ok(!JSON.stringify(result).includes(value.candidates[0].description));
    if (mode === "allocation") {
      assert.match(wire.questions.selection.criteria.pair_a, /provider\/model-a.*high/);
      assert.ok(!JSON.stringify(result).includes("provider/model-a"));
      assert.match(wire.questions.sufficient_context.instructions, /applicable baseline policy support a defensible task-fit choice/);
      assert.match(wire.questions.sufficient_context.instructions, /absence of comparative benchmarks alone does not imply insufficient context/);
      assert.match(wire.questions.sufficient_context.instructions, /Do not require proof of the globally best or cheapest pair, or invent efficiency claims/);
    }
    if (mode === "review-triage") assert.match(wire.questions.selection.instructions, /never dismiss, accept, resolve, settle, downgrade, or close/);
    if (mode === "evidence-selection") assert.match(wire.questions.selection.instructions, /next relevant evidence or context item/);
    if (mode === "work-priority") assert.match(wire.questions.selection.instructions, /next ready, bounded subtask or check/);
  });
}

test("explicit candidate restriction sends only that candidate plus abstention", async () => {
  const value = { ...input("allocation"), requiredCandidateId: "pair_b" };
  const provider = fakeProvider();
  const result = await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl });
  assertEnvelope(result, "recommended", "thresholds_met");
  assert.deepEqual(result.recommendation, { candidateId: "pair_b" });
  const wire = JSON.parse(provider.calls[0].options.body);
  assert.deepEqual(wire.state.candidates, [value.candidates[1]]);
  assert.deepEqual(Object.keys(wire.questions.selection.criteria), ["pair_b", "no_match"]);
  assert.ok(!provider.calls[0].options.body.includes("provider/model-a"));
});

test("a provider cannot choose an excluded explicit-choice alternative", async () => {
  const value = { ...input(), requiredCandidateId: "plan" };
  const provider = fakeProvider(() => responseBody());
  assertEnvelope(await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl }), "error", "invalid_response");
});

for (const [name, options, reason] of [
  ["offline with key", { offline: true, apiKey: SECRET }, "offline"],
  ["missing key", { apiKey: "" }, "missing_api_key"],
  ["invalid key", { apiKey: `${SECRET}\n` }, "invalid_api_key"],
]) {
  test(`${name} never invokes fetch`, async () => {
    let calls = 0;
    const result = await advise(input(), { ...options, fetchImpl: () => { calls++; throw new Error(SECRET); } });
    assertEnvelope(result, "unavailable", reason);
    assert.equal(calls, 0);
  });
}

const invalidInputs = [
  ["null", () => null],
  ["array", () => []],
  ["unknown mode", () => ({ ...input(), mode: "dispatch" })],
  ["endpoint override", () => ({ ...input(), endpoint: "https://example.invalid" })],
  ["generic questions", () => ({ ...input(), questions: {} })],
  ["model override", () => ({ ...input(), model: "other" })],
  ["body key", () => ({ ...input(), apiKey: SECRET })],
  ["missing state", () => { const value = input(); delete value.state; return value; }],
  ["empty state", () => ({ ...input(), state: "  " })],
  ["object state", () => ({ ...input(), state: { text: "context" } })],
  ["control state", () => ({ ...input(), state: "bad\0state" })],
  ["overlong state", () => ({ ...input(), state: "é".repeat(LIMITS.stateBytes) })],
  ["no candidates", () => ({ ...input(), candidates: [] })],
  ["too many candidates", () => ({ ...input(), candidates: Array.from({ length: 17 }, (_, i) => ({ id: `option_${i}`, workflow: "native", description: "available" })) })],
  ["sparse candidates", () => ({ ...input(), candidates: new Array(2) })],
  ["unknown candidate field", () => { const value = input(); value.candidates[0].command = "run"; return value; }],
  ["unknown workflow", () => { const value = input(); value.candidates[0].workflow = "shell:anything"; return value; }],
  ["duplicate candidate ID", () => { const value = input(); value.candidates[1].id = "native"; return value; }],
  ["reserved no_match", () => { const value = input(); value.candidates[0].id = "no_match"; return value; }],
  ["reserved constructor", () => { const value = input(); value.candidates[0].id = "constructor"; return value; }],
  ["reserved prototype", () => { const value = input(); value.candidates[0].id = "prototype"; return value; }],
  ["reserved proto", () => { const value = input(); value.candidates[0].id = "__proto__"; return value; }],
  ["unsafe ID", () => { const value = input(); value.candidates[0].id = "bad\noption"; return value; }],
  ["overlong description", () => { const value = input(); value.candidates[0].description = "a".repeat(LIMITS.descriptionBytes + 1); return value; }],
  ["allocation missing effort", () => { const value = input("allocation"); delete value.candidates[0].reasoning_effort; return value; }],
  ["unsupported effort token", () => { const value = input("allocation"); value.candidates[0].reasoning_effort = "inherit"; return value; }],
  ["unsafe model", () => { const value = input("allocation"); value.candidates[0].model = "bad\nmodel"; return value; }],
  ["review authorization field", () => { const value = input("review-triage"); value.candidates[0].approve = true; return value; }],
  ["nonexistent required ID", () => ({ ...input(), requiredCandidateId: "unknown" })],
  ["null required ID", () => ({ ...input(), requiredCandidateId: null })],
  ["unknown threshold", () => ({ ...input(), thresholds: { maxCost: 10 } })],
  ["NaN threshold", () => ({ ...input(), thresholds: { minConfidence: NaN } })],
  ["infinite threshold", () => ({ ...input(), thresholds: { minConfidence: Infinity } })],
  ["negative threshold", () => ({ ...input(), thresholds: { minProbability: -0.1 } })],
  ["excess threshold", () => ({ ...input(), thresholds: { minSufficientContext: 1.1 } })],
  ["string threshold", () => ({ ...input(), thresholds: { minConfidence: "0.8" } })],
  ["prototype root", () => Object.assign(Object.create({ inherited: true }), input())],
  ["proto root key", () => JSON.parse('{"mode":"workflow","state":"context","candidates":[],"__proto__":{}}')],
  ["non-enumerable field", () => Object.defineProperty(input(), "hidden", { value: true })],
  ["symbol field", () => Object.assign(input(), { [Symbol("x")]: true })],
];
for (const [name, make] of invalidInputs) {
  test(`invalid caller input: ${name}`, async () => {
    let calls = 0;
    const result = await advise(make(), { apiKey: SECRET, fetchImpl: () => { calls++; throw new Error("unreachable"); } });
    assertEnvelope(result, "error", "invalid_input");
    assert.equal(calls, 0);
  });
}

test("request validation never executes property getters", async () => {
  let reads = 0;
  const value = Object.defineProperty(input(), "state", { enumerable: true, get() { reads++; return PRIVATE_STATE; } });
  assertEnvelope(await advise(value, { offline: true }), "error", "invalid_input");
  assert.equal(reads, 0);
});

test("the total encoded request is bounded before fetch", async () => {
  const value = {
    mode: "review-triage", state: "a".repeat(LIMITS.stateBytes),
    candidates: Array.from({ length: 16 }, (_, index) => ({ id: `option_${index}`, description: "b".repeat(LIMITS.descriptionBytes) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < LIMITS.inputBytes);
  let calls = 0;
  const result = await advise(value, { apiKey: SECRET, fetchImpl: () => { calls++; } });
  assertEnvelope(result, "error", "input_too_large");
  assert.equal(calls, 0);
});

const invalidResponses = [
  ["null response", () => null],
  ["additional top-level key", (body) => ({ ...body, message: SECRET })],
  ["missing answer", (body) => { delete body.answers.sufficient_context; return body; }],
  ["additional answer", (body) => { body.answers.authorized = { type: "noul", noul: 1 }; return body; }],
  ["choice/noul type mismatch", (body) => { body.answers.selection.type = "noul"; return body; }],
  ["noul/choice type mismatch", (body) => { body.answers.sufficient_context.type = "choice"; return body; }],
  ["unknown selection", (body) => { body.answers.selection.choice = "synthesized"; return body; }],
  ["proto selection", (body) => { body.answers.selection.choice = "__proto__"; return body; }],
  ["missing probability", (body) => { delete body.answers.selection.probabilities.plan; return body; }],
  ["additional probability", (body) => { body.answers.selection.probabilities.new_option = 0; return body; }],
  ["inherited probability name", (body) => { body.answers.selection.probabilities.constructor = 0; return body; }],
  ["probabilities array", (body) => { body.answers.selection.probabilities = [0.9, 0.05, 0.05]; return body; }],
  ["NaN probability", (body) => { body.answers.selection.probabilities.native = NaN; return body; }],
  ["infinite probability", (body) => { body.answers.selection.probabilities.native = Infinity; return body; }],
  ["string probability", (body) => { body.answers.selection.probabilities.native = "0.9"; return body; }],
  ["negative probability", (body) => { body.answers.selection.probabilities.plan = -0.05; return body; }],
  ["over-one probability", (body) => { body.answers.selection.probabilities.native = 1.1; return body; }],
  ["distribution sum", (body) => { body.answers.selection.probabilities.native = 0.8; return body; }],
  ["choice is not argmax", (body) => { body.answers.selection.choice = "plan"; return body; }],
  ["missing confidence", (body) => { delete body.answers.selection.confidence; return body; }],
  ["over-one confidence", (body) => { body.answers.selection.confidence = 2; return body; }],
  ["string confidence", (body) => { body.answers.selection.confidence = "0.95"; return body; }],
  ["infinite confidence", (body) => { body.answers.selection.confidence = Infinity; return body; }],
  ["extra choice output", (body) => { body.answers.selection.explanation = PRIVATE_STATE; return body; }],
  ["boolean noul", (body) => { body.answers.sufficient_context.noul = true; return body; }],
  ["negative noul", (body) => { body.answers.sufficient_context.noul = -0.1; return body; }],
  ["noul separate confidence", (body) => { body.answers.sufficient_context.confidence = 1; return body; }],
  ["missing model", (body) => { delete body.model; return body; }],
  ["unexpected provider model", (body) => { body.model = "other-provider-model"; return body; }],
  ["unsafe provider model", (body) => { body.model = `jev-${SECRET}`; return body; }],
  ["missing usage", (body) => { delete body.usage; return body; }],
  ["extra usage field", (body) => { body.usage.prompt = PRIVATE_STATE; return body; }],
  ["negative usage", (body) => { body.usage.input_tokens = -1; return body; }],
  ["fractional usage", (body) => { body.usage.output_tokens = 0.5; return body; }],
  ["unsafe usage integer", (body) => { body.usage.input_tokens = Number.MAX_SAFE_INTEGER + 1; return body; }],
];
for (const [name, transform] of invalidResponses) {
  test(`rejects provider response: ${name}`, async () => {
    const provider = fakeProvider(transform);
    const result = await advise(input(), { apiKey: SECRET, fetchImpl: provider.fetchImpl });
    assertEnvelope(result, "error", "invalid_response");
    assert.equal(result.judgment, null);
    assert.equal(result.provider, null);
    assert.equal(provider.calls.length, 1);
  });
}

for (const [name, transform, reason] of [
  ["abstention", (body) => { body.answers.selection.choice = "no_match"; body.answers.selection.probabilities = { native: 0.05, plan: 0.05, no_match: 0.9 }; }, "no_match"],
  ["insufficient context", (body) => { body.answers.sufficient_context.noul = 0.79; }, "insufficient_context"],
  ["low confidence", (body) => { body.answers.selection.confidence = 0.79; }, "low_confidence"],
  ["low selected probability", (body) => { body.answers.selection.probabilities = { native: 0.79, plan: 0.11, no_match: 0.1 }; }, "low_probability"],
]) {
  test(`${name} keeps raw judgments separate and returns no recommendation`, async () => {
    const provider = fakeProvider((body) => { transform(body); return body; });
    const result = await advise(input(), { apiKey: SECRET, fetchImpl: provider.fetchImpl });
    assertEnvelope(result, "deferred", reason);
    assert.ok(result.judgment);
    assert.ok(result.provider);
  });
}

test("threshold overrides are local guards, inclusive at the boundary, not reported correctness", async () => {
  assert.deepEqual(DEFAULT_THRESHOLDS, { minConfidence: 0.8, minProbability: 0.8, minSufficientContext: 0.8 });
  const provider = fakeProvider((body) => {
    body.answers.selection.probabilities = { native: 0.7, plan: 0.2, no_match: 0.1 };
    body.answers.selection.confidence = 0.7;
    body.answers.sufficient_context.noul = 0.7;
    return body;
  });
  const value = { ...input(), thresholds: { minConfidence: 0.7, minProbability: 0.7, minSufficientContext: 0.7 } };
  assertEnvelope(await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl }), "recommended", "thresholds_met");
});

test("tied maximum probabilities abstain even with permissive thresholds", async () => {
  const provider = fakeProvider((body) => { body.answers.selection.probabilities = { native: 0.5, plan: 0.5, no_match: 0 }; return body; });
  const value = { ...input(), thresholds: { minProbability: 0.4 } };
  assertEnvelope(await advise(value, { apiKey: SECRET, fetchImpl: provider.fetchImpl }), "deferred", "ambiguous_selection");
});

for (const [status, reason] of [[301, "redirect_blocked"], [302, "redirect_blocked"], [307, "redirect_blocked"], [401, "authentication_failed"], [403, "authentication_failed"], [429, "rate_limited"], [500, "provider_unavailable"], [503, "provider_unavailable"], [529, "provider_unavailable"], [422, "http_error"]]) {
  test(`HTTP ${status} never retries or exposes the provider error body`, async () => {
    let calls = 0;
    const result = await advise(input(), { apiKey: SECRET, fetchImpl: async () => { calls++; return new Response(`${SECRET} ${PRIVATE_STATE}`, { status, headers: { Location: "https://example.invalid/leak" } }); } });
    assertEnvelope(result, "unavailable", reason);
    assert.equal(result.judgment, null);
    assert.equal(calls, 1);
  });
}

test("a response already redirected by an injected fetch is rejected", async () => {
  const response = jsonResponse(responseBody());
  Object.defineProperty(response, "redirected", { value: true });
  assertEnvelope(await advise(input(), { apiKey: SECRET, fetchImpl: async () => response }), "unavailable", "redirect_blocked");
});

test("a response from a different final URL is rejected", async () => {
  const response = jsonResponse(responseBody());
  Object.defineProperty(response, "url", { value: "https://example.invalid" });
  assertEnvelope(await advise(input(), { apiKey: SECRET, fetchImpl: async () => response }), "unavailable", "redirect_blocked");
});

test("network exception text is never printed", async () => {
  const result = await advise(input(), { apiKey: SECRET, fetchImpl: async () => { throw new Error(`${SECRET} ${PRIVATE_STATE}`); } });
  assertEnvelope(result, "unavailable", "network_error");
});

test("deadline covers a fetch that ignores abort", async () => {
  let signal;
  const started = Date.now();
  const result = await advise(input(), { apiKey: SECRET, timeoutMs: 15, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  assertEnvelope(result, "unavailable", "timeout");
  assert.equal(signal.aborted, true);
  assert.ok(Date.now() - started < 2000);
});

test("deadline also covers a stalled response body and cancels its stream", async () => {
  let cancelled = false;
  let signal;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"model":')); }, cancel() { cancelled = true; } });
  const result = await advise(input(), { apiKey: SECRET, timeoutMs: 15, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Response(stream, { headers: { "Content-Type": "application/json" } });
  } });
  assertEnvelope(result, "unavailable", "timeout");
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
});

test("input acquisition has its own deadline for a producer that never closes", async () => {
  assert.equal(LIMITS.inputTimeoutMs, 10_000);
  const stream = new PassThrough();
  stream.write('{"mode":');
  await assert.rejects(readInput(stream, 15), { reason: "input_timeout" });
  assert.equal(stream.destroyed, true);
});

for (const [name, response, reason] of [
  ["malformed JSON", () => new Response(`not json ${SECRET}`, { headers: { "Content-Type": "application/json" } }), "invalid_response"],
  ["invalid UTF-8", () => new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }), "invalid_response"],
  ["wrong content type", () => new Response(JSON.stringify(responseBody()), { headers: { "Content-Type": "text/html" } }), "invalid_response"],
  ["oversized content length", () => new Response("{}", { headers: { "Content-Type": "application/json", "Content-Length": String(LIMITS.responseBytes + 1) } }), "response_too_large"],
  ["oversized actual body", () => new Response("a".repeat(LIMITS.responseBytes + 1), { headers: { "Content-Type": "application/json" } }), "response_too_large"],
  ["lying content length", () => new Response("a".repeat(LIMITS.responseBytes + 1), { headers: { "Content-Type": "application/json", "Content-Length": "2" } }), "response_too_large"],
]) {
  test(`${name} returns sanitized failure`, async () => {
    assertEnvelope(await advise(input(), { apiKey: SECRET, fetchImpl: async () => response() }), "error", reason);
  });
}

function cli(args, stdin = JSON.stringify(input()), key = "") {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdin, encoding: "utf8", timeout: 15_000, maxBuffer: 256 * 1024,
    env: { ...process.env, TYPESAFE_API_KEY: key },
  });
}

test("CLI help explains default key activation and offline override", () => {
  const result = cli(["--help"], "", SECRET);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /TYPESAFE_API_KEY enables/);
  assert.match(result.stdout, /--offline prevents network/);
  assert.match(result.stdout, /uncalibrated/);
  assert.ok(!result.stdout.includes(SECRET));
});

test("CLI without a configured key safely declines", () => {
  const result = cli([]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assertEnvelope(JSON.parse(result.stdout), "unavailable", "missing_api_key");
});

test("CLI offline overrides a configured key without network", () => {
  const result = cli(["--offline"], JSON.stringify(input()), SECRET);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assertEnvelope(JSON.parse(result.stdout), "unavailable", "offline");
});

for (const [name, args, stdin, reason] of [
  ["unknown argument", [`--endpoint=${SECRET}`], "", "invalid_arguments"],
  ["duplicate flag", ["--offline", "--offline"], "", "invalid_arguments"],
  ["help with other flags", ["--help", "--offline"], "", "invalid_arguments"],
  ["invalid JSON", ["--offline"], `${SECRET}{`, "invalid_input"],
  ["empty stdin", ["--offline"], "", "invalid_input"],
  ["multiple JSON values", ["--offline"], "{}{}", "invalid_input"],
  ["invalid UTF-8 stdin", ["--offline"], Buffer.from([0xff]), "invalid_input"],
  ["wrong schema", ["--offline"], "{}", "invalid_input"],
  ["oversized stdin", ["--offline"], " ".repeat(LIMITS.inputBytes + 1), "input_too_large"],
]) {
  test(`CLI ${name} is nonzero with a fixed sanitized envelope`, () => {
    const result = cli(args, stdin, SECRET);
    assert.equal(result.status, 2);
    assert.equal(result.stderr, "");
    assertEnvelope(JSON.parse(result.stdout), "error", reason);
  });
}
