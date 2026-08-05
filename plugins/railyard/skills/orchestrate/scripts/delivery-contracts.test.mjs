import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const orchestrator = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const delivery = readFileSync(
  new URL("../../deliver/SKILL.md", import.meta.url),
  "utf8",
);
const thermos = readFileSync(new URL("../../thermos/SKILL.md", import.meta.url), "utf8");
const modelRoutingSkill = readFileSync(new URL("../../model-routing/SKILL.md", import.meta.url), "utf8");
const modelRoutingReference = readFileSync(
  new URL("../../../references/model-routing.md", import.meta.url),
  "utf8",
);
const oracle = readFileSync(new URL("../../oracle/SKILL.md", import.meta.url), "utf8");
const providerRouting = readFileSync(
  new URL("../../../references/provider-task-routing.md", import.meta.url),
  "utf8",
);
const fableReceipt = fileURLToPath(
  new URL("../../../scripts/claude-fable-review-receipt.mjs", import.meta.url),
);
const workflows = readFileSync(
  new URL("../../../../../docs/delivery-workflows.md", import.meta.url),
  "utf8",
);
const codexManifest = JSON.parse(
  readFileSync(new URL("../../../.codex-plugin/plugin.json", import.meta.url), "utf8"),
);
const claudeManifest = JSON.parse(
  readFileSync(new URL("../../../.claude-plugin/plugin.json", import.meta.url), "utf8"),
);

test("dispatches explicit software-delivery authorization to visible execution tasks", () => {
  assert.match(orchestrator, /explicit instruction to perform delivery work/);
  assert.match(orchestrator, /`go do`, `implement`,\s+`fix`, `ship`/);
  assert.match(orchestrator, /consume one task-authority use per destination and dispatch fresh visible\s+execution tasks/);
  assert.match(orchestrator, /one-lane fast path still creates one fresh\s+visible Goal Driven Delivery child/);
  assert.match(orchestrator, /Do not satisfy the instruction with[\s\S]{0,40}analysis, a plan, a status response, or internal-subagent output alone/);
  assert.match(orchestrator, /software implementation and PR delivery\s+use Goal Driven Delivery/);
  assert.match(orchestrator, /never\s+implementing, testing, committing, pushing, or merging child work/);
  assert.match(orchestrator, /Bounded subagents are\s+for controller-scoped research\/review only/);
  assert.doesNotMatch(orchestrator, /bounded subagents for contained research, review, or execution/);
});

test("keeps answer, status, planning, and read-only turns non-work-starting", () => {
  assert.match(orchestrator, /request for an answer, status, explanation, planning, or bounded read-only\s+inspection is \*\*non-work-starting\*\*/);
  assert.match(orchestrator, /without consuming task authority or creating a task/);
  assert.match(orchestrator, /"Plan and implement" is work-starting/);
  assert.match(orchestrator, /bounded internal subagents only for controller-scoped research or review; they\s+are not substitutes for visible execution tasks/);
  assert.match(orchestrator, /later work-starting instruction is\s+a new classification/);
});

test("freezes shared ownership and hash-bound test evidence", () => {
  assert.match(orchestrator, /one canonical writer per shared\s+file/);
  assert.match(orchestrator, /require both sides to acknowledge it before dependent dispatch/);
  assert.match(orchestrator, /component gate only when that component's\s+content hash changes/);
  assert.match(orchestrator, /one full integration gate after all writers acknowledge\s+the frozen seams, rerun only when a relevant fix invalidates it/);
  assert.match(orchestrator, /hash-bound receipts, doing focused reproductions/);
  assert.match(orchestrator, /one independent reviewer per frozen lane/i);
  assert.match(orchestrator, /command, toolchain, input hashes, result, timestamp/);
});

test("bounds delegation and freezes expansion", () => {
  assert.match(orchestrator, /no inherited context when supported/);
  assert.match(orchestrator, /for mutable seams, exact owned files and frozen hashes/);
  assert.match(orchestrator, /thinnest end-to-end seam canary/);
  assert.match(orchestrator, /line growth,[\s\S]*execution time,[\s\S]*fixture cost/);
  assert.match(orchestrator, /freeze scope: reject adjacent abstractions/);
});

test("parents use fresh children and safely close their lifecycle", () => {
  assert.match(orchestrator, /child task is single-use: never resume, unarchive, or\s+repurpose/);
  assert.match(orchestrator, /report its registered identity, path, HEAD, and owned ref for parent removal and absence verification/);
  assert.match(orchestrator, /prove the child is\s+terminal and has not resumed[\s\S]*Bind the cleanup\s+target to the registered worktree identity[\s\S]*host-owned cleanup claim that keeps the child non-startable[\s\S]*Re-read the child's activity revision and target binding immediately\s+before each mutation[\s\S]*transient execution state/);
  assert.match(orchestrator, /gone from both the registered worktree inventory and the\s+filesystem/);
  assert.match(orchestrator, /require the bound path absent from inventory and\s+filesystem and delete or transfer the owned ref/);
  assert.match(orchestrator, /run only read-only local-head\/tracking\/remote equality checks[\s\S]*After cleanup succeeds[\s\S]*invoke native archive\s+promptly where the harness has those operations/);
  assert.match(orchestrator, /drift\s+blocks completion and never authorizes a switch, reset, or rewrite/);
  assert.match(orchestrator, /the child\s+resumed, a binding changed[\s\S]*mark the child blocked\s+\(`⏸️` where titles exist\)/);
  assert.match(orchestrator, /dirty\/unintegrated without a\s+transferred ref[\s\S]*do not archive or force\s+cleanup/);
  assert.match(orchestrator, /any continuing ref transferred to a named owner/);
  assert.match(orchestrator, /parent closes it out \(native archive where one exists\) in the same monitoring\s+pass/);
  assert.match(workflows, /Every visible child is a[\s\S]*fresh, single-use task/);
  assert.match(workflows, /a clean worktree is evidence, not cleanup authority/);
  assert.match(workflows, /bound path must be[\s\S]*absent from both the repository's registered worktree inventory and filesystem/);
  assert.match(workflows, /A conflict leaves the child visible and retitled\s+`⏸️` with an explicit blocker/);
});

test("classifies capability and native gates once", () => {
  assert.match(orchestrator, /Capability discovery before dispatch/);
  assert.match(orchestrator, /absent from the eagerly\s+listed surface is unknown, not unavailable/);
  assert.match(orchestrator, /when a deferred catalog exists/);
  assert.match(orchestrator, /search it for the\s+exact capability/);
  assert.match(orchestrator, /call its read-only discovery operation before falling\s+back or blocking/);
  assert.match(orchestrator, /`capability_discovery_unavailable` when the catalog or\s+search is missing/);
  assert.match(orchestrator, /a required route then blocks; an explicitly optional\s+capability selects its one disclosed fallback/);
  assert.match(orchestrator, /Record `capability_ready` only when discovery\s+confirms the route/);
  assert.match(orchestrator, /tool_surface_missing[\s\S]*host_offline[\s\S]*saved_project_missing[\s\S]*task_creation_failed[\s\S]*executor_mismatch/);
  assert.match(orchestrator, /WSL-only evidence for native Windows is\s+`native_evidence_unavailable` and cannot satisfy the route/);
  assert.match(orchestrator, /disclosed to all affected\s+children and kept stable/);
  assert.match(orchestrator, /Never silently\s+relabel a fallback as the preferred route/);
  assert.match(orchestrator, /hosted, locally runnable native,\s+interactive-elevation, or recoverable-host/);
  assert.match(orchestrator, /never infer one class from another/);
  assert.match(orchestrator, /Verify local toolchain\s+and CI parity once/);
});

test("routes explicit boundaries without changing external carriers", () => {
  assert.match(delivery, /`ce-plan` \+ `ce-work mode:return-to-caller`/);
  assert.match(delivery, /Generic implement, fix, or ship \| `compound-engineering:lfg`/);
  assert.match(delivery, /CE stays an unchanged external carrier/);
  assert.match(delivery, /later\s+local\/return-to-caller stop halts shipping/);
  assert.match(delivery, /later authorized ship\s+instruction replaces an earlier local stop/);
  assert.match(delivery, /unless a higher-priority boundary\s+still applies/);
  assert.match(delivery, /the orchestrator owns the\s+plan-boundary routing decision/);
  assert.match(delivery, /rather\s+than inferring one from transcript history/);
});

test("enforces the frozen cadence inside a standalone delivery lane", () => {
  assert.match(delivery, /one canonical writer per shared file/i);
  assert.match(delivery, /thinnest real seam canary/);
  assert.match(delivery, /component gate only when its input\s+hash changes/);
  assert.match(delivery, /one full integration gate after all writers freeze/);
  assert.match(delivery, /reviewers reuse receipts\s+instead of rerunning suites/);
  assert.match(delivery, /rerun only\s+evidence a relevant shared-code fix invalidated/);
  assert.match(delivery, /not a substitute for tests, React Doctor, CE review, or CI/);
  assert.match(delivery, /one class never proves another/);
  assert.match(delivery, /verify the carrier\/model and exact CI-parity toolchain once/);
  assert.match(delivery, /disproportionate line\s+growth, execution time, or fixture cost/);
});

test("proactively classifies provider transport before any native spawn", () => {
  assert.match(providerRouting, /source and target transport trust domains, source and target\s+model-serving providers, and destination execution capabilities/);
  assert.match(providerRouting, /A gateway label, a model-provider label, or matching model names alone\s+does not prove a shared trust domain or decryption capability/);
  assert.match(providerRouting, /Use declared collaboration-transport metadata first[\s\S]*current task's configured\s+provider second[\s\S]*provider, model, and\s+task identifiers returned by task creation/);
  assert.match(providerRouting, /same verified transport trust domain[\s\S]*Eligible/);
  assert.match(providerRouting, /Cross-provider plaintext transport is explicitly verified[\s\S]*Eligible/);
  assert.match(providerRouting, /Provider-bound encrypted transport cannot be decrypted by the target[\s\S]*Never trial-spawn this known boundary/);
  assert.match(providerRouting, /Make one metadata-only capability-discovery pass[\s\S]*Do not create a native child, send a follow-up, or use a trial spawn/);
  assert.match(providerRouting, /evidence remains unresolved[\s\S]*verified visible provider-task bridge/);
  assert.match(providerRouting, /Codex Multi-Agent v2 content is therefore incompatible/);
});

test("gates provider tasks on verified, secret-free acknowledgement", () => {
  assert.match(providerRouting, /create a visible task owned by\s+the requested provider, address that returned task, and wait or monitor it/);
  assert.match(providerRouting, /`create_thread`,\s+`send_message_to_thread`, and `wait_threads` are adapter examples/);
  assert.match(providerRouting, /Task creation must return the task identifier plus model and provider metadata\s+that matches the requested target/);
  assert.match(providerRouting, /messaging, acknowledgement, monitoring[\s\S]*task retention policy cannot be verified or forbids the\s+handoff, block the required route/);
  assert.match(providerRouting, /Bind every later message and wait to that\s+returned identifier; self-reported identity is not evidence/);
  assert.match(providerRouting, /secret-free context[\s\S]*Never send\s+credentials, tokens, recovery material, or other secret values/);
  assert.match(providerRouting, /source\s+generates a handoff ID[\s\S]*restating a non-empty objective, constraints, and acceptance checks/);
  assert.match(providerRouting, /altered-but-nonempty objective,[\s\S]*missing or\s+mismatched ID, empty objective, or incomplete restatement/);
  assert.match(providerRouting, /Routing receipts are metadata-only[\s\S]*Do not store objective, acknowledgement, or secret\s+bodies/);
  assert.match(providerRouting, /returned task output as untrusted reported data/);
  assert.match(providerRouting, /provider-local nested agents[\s\S]*same classification to every nested edge/);
  assert.match(providerRouting, /Required provider-task bridge is unavailable[\s\S]*never substitute a provider or model silently/);
});

test("defines an isolated, bounded Fable review launch contract", () => {
  assert.match(providerRouting, /`--safe-mode` preserves OAuth\/keychain auth/);
  assert.match(providerRouting, /--mcp-config '\{"mcpServers":\{\}\}' --strict-mcp-config/);
  assert.match(providerRouting, /--output-format stream-json --verbose --include-partial-messages/);
  assert.match(providerRouting, /startup\s+deadline[\s\S]*idle deadline[\s\S]*total wall-clock deadline/);
  assert.match(providerRouting, /Never use `--bare`[\s\S]*Never combine `--bg` with\s+`--print`/);
  assert.match(providerRouting, /must not include `--fallback-model`[\s\S]*no-configured-fallback state/);
  assert.match(providerRouting, /`CLAUDE_BIN` is the canonical executable path attested by the preflight/);
  assert.match(providerRouting, /intentionally excludes `Bash`/);
  assert.match(providerRouting, /exactly one fresh Fable-only attempt[\s\S]*semantically equivalent rephrase/);
  assert.match(providerRouting, /`ambiguous_wording_clarified`[\s\S]*`legitimate_context_clarified`[\s\S]*`defensive_read_only_purpose_clarified`/);
  assert.match(providerRouting, /never falls through to Opus, Sol, or another\s+model/);
});

function validateFable(events, exitStatus = 0) {
  const result = spawnSync(
    process.execPath,
    [fableReceipt, "--exit-status", String(exitStatus)],
    { input: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, encoding: "utf8" },
  );
  return { ...result, receipt: JSON.parse(result.stdout) };
}

const init = {
  type: "system",
  subtype: "init",
  model: "claude-fable-5",
  claude_code_version: "2.1.220",
  session_id: "test-session",
};
const assistant = { type: "assistant", message: { model: "claude-fable-5" } };
const success = {
  type: "result",
  subtype: "success",
  is_error: false,
  modelUsage: {
    "claude-haiku-4-5-20251001": { provider: "firstParty" },
    "claude-fable-5": { provider: "firstParty" },
  },
};

test("accepts a first-party Fable stream with auxiliary Haiku usage", () => {
  const run = validateFable([init, assistant, success]);
  assert.equal(run.status, 0);
  assert.equal(run.receipt.ok, true);
  assert.equal(run.receipt.reason, "validated");
});

test("rejects refusal fallback after a valid Fable init", () => {
  const run = validateFable([
    init,
    {
      type: "system",
      subtype: "model_refusal_fallback",
      trigger: "refusal",
      api_refusal_category: "cyber",
      original_model: "claude-fable-5",
      fallback_model: "claude-opus-5",
    },
  ]);
  assert.equal(run.status, 1);
  assert.equal(run.receipt.reason, "model_refusal_fallback");
  assert.equal(run.receipt.api_refusal_category, "cyber");
});

test("rejects model drift, error results, nonzero exits, and truncated streams", () => {
  assert.equal(
    validateFable([init, { type: "assistant", message: { model: "claude-opus-5" } }]).receipt.reason,
    "assistant_model_mismatch",
  );
  assert.equal(validateFable([init, assistant, { ...success, is_error: true }]).receipt.reason, "result_error");
  assert.equal(validateFable([init, assistant, success], 1).receipt.reason, "process_exit_nonzero");
  assert.equal(
    validateFable([init, assistant, { ...success, is_error: true }], 1).receipt.result_is_error,
    true,
  );
  assert.equal(validateFable([init, assistant]).receipt.reason, "missing_terminal_result");
  assert.equal(validateFable([init, success]).receipt.reason, "missing_assistant_event");
  assert.equal(
    validateFable([{ ...init, model: "claude-fable-999" }]).receipt.reason,
    "init_model_mismatch",
  );
  assert.equal(validateFable([assistant, init, success]).receipt.reason, "invalid_event_order");
  assert.equal(validateFable([init, assistant, success, success]).receipt.reason, "invalid_event_order");
  assert.equal(
    validateFable([
      init,
      assistant,
      { ...success, modelUsage: { ...success.modelUsage, "claude-opus-5": { provider: "firstParty" } } },
    ]).receipt.reason,
    "model_usage_mismatch",
  );
  assert.equal(
    validateFable([
      init,
      assistant,
      { ...success, modelUsage: { "claude-fable-5": { provider: "thirdParty" } } },
    ]).receipt.reason,
    "provider_mismatch",
  );
  assert.equal(
    validateFable([
      init,
      assistant,
      { ...success, modelUsage: { ...success.modelUsage, "claude-haiku-999": { provider: "firstParty" } } },
    ]).receipt.reason,
    "model_usage_mismatch",
  );
  const failedWithDrift = validateFable([
    init,
    assistant,
    { ...success, modelUsage: { "claude-opus-5": { provider: "thirdParty" } } },
  ], 1);
  assert.equal(failedWithDrift.receipt.reason, "process_exit_nonzero");
  assert.equal(failedWithDrift.receipt.evidence_reason, "model_usage_mismatch");
  assert.equal(failedWithDrift.receipt.observed_provider, "thirdParty");
  const erroredWithDrift = validateFable([
    init,
    assistant,
    { ...success, is_error: true, modelUsage: { "claude-opus-5": { provider: "thirdParty" } } },
  ]);
  assert.equal(erroredWithDrift.receipt.reason, "result_error");
  assert.equal(erroredWithDrift.receipt.evidence_reason, "model_usage_mismatch");
  assert.equal(erroredWithDrift.receipt.observed_provider, "thirdParty");
});

test("reports unreadable Fable streams as metadata", () => {
  const run = spawnSync(
    process.execPath,
    [fableReceipt, "--exit-status", "0", "/path/that/does/not/exist/fable.jsonl"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).reason, "stream_read_error");
  assert.equal(run.stderr, "");
});

test("rejects altered non-empty provider handoffs", () => {
  assert.match(providerRouting, /source orchestrator must compare each restated field against\s+its source-held handoff contract/);
  assert.match(providerRouting, /An altered-but-nonempty objective,\s+constraint, or acceptance check fails the handoff/);
  assert.match(providerRouting, /acknowledgement comparison pass\/fail and reason/);
  assert.match(orchestrator, /altered-but-nonempty\s+content fails/i);
});

test("all model-launch workflows consume one model-routing entrypoint", () => {
  for (const consumer of [orchestrator, delivery, thermos]) {
    assert.match(consumer, /railyard:model-routing/);
  }
  for (const consumer of [orchestrator, delivery]) {
    assert.match(consumer, /railyard\/model-routing\/v1/);
    assert.match(consumer, /second router|the only model, effort, budget, and\s+transport router|only public model/i);
  }
  assert.match(providerRouting, /normative internal transport phase/);
  assert.match(providerRouting, /never this reference as a second router/);
  assert.match(workflows, /exact contract `railyard\/model-routing\/v1`/);
  assert.match(workflows, /consumers never call a second router/);
  assert.match(modelRoutingSkill, /contractVersion/);
  assert.match(modelRoutingReference, /provider-task-routing\.md/);
});

test("delivery workflows apply the invariant work contract and closed carrier overlay", () => {
  for (const text of [delivery, orchestrator]) {
    assert.match(text, /build-work-contract/);
    assert.match(text, /objective\/source-of-truth\/scope\//);
    assert.match(text, /stop\s*digests|stop-condition/);
    assert.match(text, /[Dd]irect user and[\s\S]{0,40}repository instructions outrank/);
  }
  assert.match(orchestrator, /catalog prompt text is\s+never an input/);
});

test("centralizes the no-config implementation binding and fallback", () => {
  assert.match(modelRoutingReference, /gpt-5\.6-luna/);
  assert.match(modelRoutingReference, /implementation_model_substitute/);
  assert.match(modelRoutingReference, /unavailable(?: or |\/)unselectable[\s\S]*Terra/);
  assert.doesNotMatch(orchestrator, /gpt-5\.6-luna/);
  assert.doesNotMatch(delivery, /gpt-5\.6-luna/);
});

test("overrides only named CE execution stages without modifying CE", () => {
  assert.match(delivery, /Stage-scoped overrides for unchanged Compound Engineering/);
  assert.match(delivery, /GLM scout\/engineer\s+seams remain\s+fail-closed/);
  assert.match(delivery, /codex exec`?\s*\n?route|`codex exec`/);
  assert.match(delivery, /Codex host reaches Claude only through CE\'s existing attested read-only\s+Claude `-p` adapter/);
  assert.match(delivery, /never the workflow, persona,\s+legitimacy gate, artifact schema, writer ownership/);
  assert.match(workflows, /Compound Engineering is not modified/);
});

test("adds objective, artifact, cadence, and terminal-ledger controls", () => {
  assert.match(delivery, /objective\/artifact admission receipt/);
  assert.match(delivery, /producer-to-consumer chain/);
  assert.match(delivery, /write a simplification\s+receipt/);
  assert.match(delivery, /coherent vertical chunk/);
  assert.match(delivery, /one instrumented\s+diagnostic push/);
  assert.match(delivery, /executionHost/);
  assert.match(delivery, /terminal-gate ledger/);
  assert.match(orchestrator, /admitted → oriented → active → frozen →\s+consumed\|superseded\|blocked → terminal/);
  assert.match(orchestrator, /one bounded\s+redirect/);
  assert.match(orchestrator, /output consumer/);
  assert.match(orchestrator, /critical-path duration/);
});

test("Thermos freezes one packet and reuses matching concern coverage", () => {
  assert.match(thermos, /Freeze one deterministic review packet/);
  assert.match(thermos, /one correctness\/security disposition and one code-quality disposition/);
  assert.match(thermos, /matching independent CE or Sol review may satisfy a disposition only when/);
  assert.match(thermos, /review is a concern-coverage portfolio, not an additive swarm/);
});

test("Oracle exposes a routed browser-only mode without changing manual use", () => {
  assert.match(oracle, /railyard\/model-routing\/v1/);
  assert.match(oracle, /oracle-route\.mjs/);
  assert.match(oracle, /routed Oracle API|oracle-api/);
  assert.match(oracle, /manual commands below remain outside routed v1/);
});

test("ships paired source manifest versions", () => {
  assert.match(codexManifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(claudeManifest.version, codexManifest.version);
  assert.ok(claudeManifest.skills.includes("./skills/model-routing"));
});
