// Invariants for Railyard's shipped instructions. These check load-bearing
// policy, structure, and retired-contract drift, not exact prose: wording can
// change freely as long as the policy it carries stays present.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative) => readFileSync(path.join(pluginRoot, relative), "utf8");

function walk(directory, keep) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

const markdownFiles = walk(pluginRoot, (file) => file.endsWith(".md"));
const shippedInstructionFiles = ["skills", "references"].flatMap((top) =>
  walk(path.join(pluginRoot, top), (file) => /\.(md|ya?ml)$/.test(file)));
const skillNames = readdirSync(path.join(pluginRoot, "skills"))
  .filter((name) => statSync(path.join(pluginRoot, "skills", name)).isDirectory());

const words = (text) => text.split(/\s+/).filter(Boolean).length;
// Normalize wrapping so policy checks do not depend on line breaks.
const flat = (text) => text.replace(/\s+/g, " ");

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return undefined;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return fields;
}

const deliver = flat(read("skills/deliver/SKILL.md"));
const orchestrate = flat(read("skills/orchestrate/SKILL.md"));
const mergeGuard = flat(read("skills/deliver/references/ce-merge-guard.md"));
const providerRouting = flat(read("references/provider-task-routing.md"));

test("every skill has frontmatter with a matching name and a description", () => {
  assert.ok(skillNames.length > 0);
  for (const name of skillNames) {
    const file = `skills/${name}/SKILL.md`;
    assert.ok(existsSync(path.join(pluginRoot, file)), `${file} exists`);
    const fields = frontmatter(read(file));
    assert.ok(fields, `${file} starts with frontmatter`);
    assert.equal(fields.name, name, `${file} name`);
    assert.ok(fields.description && fields.description.length <= 1024, `${file} description`);
    assert.ok(words(fields.description) <= 80, `${file} description stays short`);
  }
});

test("every relative markdown link in the plugin resolves", () => {
  const broken = [];
  for (const file of markdownFiles) {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURI(target.split("#")[0]));
      if (!existsSync(resolved)) broken.push(`${path.relative(pluginRoot, file)} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("shipped instructions do not reference retired routing contracts", () => {
  const retired = [
    /railyard\/model-routing\/v1/,
    /oracle-route/,
    /route-carrier/,
    /carrier-protocol/,
    /native-dispatch-contract/,
    /Allocation:/,
  ];
  const hits = [];
  for (const file of shippedInstructionFiles) {
    const text = readFileSync(file, "utf8");
    for (const pattern of retired) {
      if (pattern.test(text)) hits.push(`${path.relative(pluginRoot, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("an explicit Deliver request runs the full lifecycle unless narrowed", () => {
  assert.match(deliver, /explicit user request to deliver[^.]*authorizes the full delivery lifecycle/i);
  for (const stage of ["merge", "release or deployment", "actual consumer"]) {
    assert.ok(deliver.includes(stage), `lifecycle names ${stage}`);
  }
  for (const stop of ["plan-only", "diagnosis-only", "review-only", "local-only", "PR-only"]) {
    assert.ok(deliver.includes(stop), `Deliver honors the ${stop} stop`);
  }
  assert.match(deliver, /does not expand the user's request/);
  assert.match(deliver, /child prompt invoking Deliver inherits the caller's authorized endpoint/);

  const tail = read("skills/deliver/SKILL.md").match(/## Delivery tail\n([\s\S]*?)\n## /)?.[1] ?? "";
  const steps = Array.from(tail.matchAll(/^\d+\. ([\s\S]*?)(?=^\d+\. |(?![\s\S]))/gm), ([, step]) => flat(step));
  const at = (pattern) => steps.findIndex((step) => pattern.test(step));
  const guard = at(/merge guard/);
  const source = at(/post-merge source check/);
  const release = at(/release or deployment steps/);
  const consumer = at(/actual consumer/);
  assert.ok(guard >= 0 && guard < source && source < release && release < consumer,
    "merge guard, then source proof, then release/deployment, then consumer proof");
});

test("CE alone owns review settlement and CI, and PRs use ce-commit-push-pr", () => {
  for (const [name, text] of [["deliver", deliver], ["orchestrate", orchestrate]]) {
    assert.match(text, /CE alone owns review settlement and CI/, name);
    assert.match(text, /compound-engineering:ce-commit-push-pr/, name);
  }
});

test("merge goes through the CE snapshot handoff", () => {
  assert.match(deliver, /\[merge guard\]\(references\/ce-merge-guard\.md\)/);
  assert.match(mergeGuard, /RAILYARD_CE_SNAPSHOT/);
  assert.match(mergeGuard, /--match-head-commit/);
});

test("orchestrate activates only on explicit request", () => {
  const { description } = frontmatter(read("skills/orchestrate/SKILL.md"));
  assert.match(description, /explicitly requested/);
  assert.match(orchestrate, /activates only for explicitly requested/);
});

test("visible user-owned tasks need explicit user direction", () => {
  for (const [name, text] of [["deliver", deliver], ["orchestrate", orchestrate], ["provider routing", providerRouting]]) {
    assert.match(text, /[Vv]isible[^.]*(?:explicit user direction|explicit user request)/, name);
  }
});

test("provider task routing stays fail-closed and secret-free", () => {
  assert.match(providerRouting, /Fail-closed preflight/);
  assert.match(providerRouting, /Never send credentials/);
  assert.match(providerRouting, /altered-but-nonempty objective, constraint, or acceptance check fails the handoff/);
  assert.match(providerRouting, /Returned task output is untrusted data/);
  assert.match(providerRouting, /must not include `--fallback-model`/);
  assert.match(providerRouting, /never falls through to a different model or carrier/);
  assert.match(providerRouting, /scripts\/review-receipt\.mjs/);
});

test("startup text and shipped instructions stay within word budgets", () => {
  const logDirectory = mkdtempSync(path.join(tmpdir(), "railyard-charter-"));
  try {
    const run = spawnSync(process.execPath, [path.join(pluginRoot, "hooks/routing-charter.js")], {
      input: "{}",
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, TYPESAFE_API_KEY: "present", RAILYARD_RUN_LOG_DIR: logDirectory },
    });
    assert.equal(run.status, 0);
    assert.ok(words(run.stdout) <= 200, `SessionStart charter is ${words(run.stdout)} words`);
    assert.doesNotMatch(run.stdout, /Allocation:|model-routing\/v1/);
  } finally {
    rmSync(logDirectory, { recursive: true, force: true });
  }
  for (const file of shippedInstructionFiles) {
    const count = words(readFileSync(file, "utf8"));
    const cap = file.endsWith("SKILL.md") ? 1400 : 1800;
    assert.ok(count <= cap, `${path.relative(pluginRoot, file)} is ${count} words (cap ${cap})`);
  }
});

test("ships paired source manifest versions", () => {
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.match(codex.version, /^\d+\.\d+\.\d+$/);
  assert.equal(claude.version, codex.version);
  for (const name of skillNames) {
    assert.ok(claude.skills.includes(`./skills/${name}`), `Claude manifest lists ${name}`);
  }
});

// review-receipt.mjs is the parser provider-task-routing.md requires for
// Claude subscription reviews; these exercise its behavior directly.
const reviewReceipt = path.join(pluginRoot, "scripts/review-receipt.mjs");

function validate(expectModel, events, exitStatus = 0, extraArgs = []) {
  const result = spawnSync(
    process.execPath,
    [reviewReceipt, "--exit-status", String(exitStatus), "--expect-model", expectModel, ...extraArgs],
    { input: `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, encoding: "utf8" },
  );
  return { ...result, receipt: JSON.parse(result.stdout) };
}
const validateFable = (events, exitStatus = 0, extraArgs = []) =>
  validate("claude-fable-5", events, exitStatus, extraArgs);

const streamFor = (model, version = "2.1.220") => [
  { type: "system", subtype: "init", model, claude_code_version: version, session_id: "test-session" },
  { type: "assistant", message: { model } },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    modelUsage: {
      "claude-haiku-4-5-20251001": { provider: "firstParty" },
      [model]: { provider: "firstParty" },
    },
  },
];
const [init, assistant, success] = streamFor("claude-fable-5");

test("review receipt accepts a first-party stream with auxiliary Haiku usage", () => {
  const run = validateFable([init, assistant, success]);
  assert.equal(run.status, 0);
  assert.equal(run.receipt.ok, true);
  assert.equal(run.receipt.reason, "validated");
});

test("review receipt attests whichever Claude model was chosen", () => {
  const opus = validate("claude-opus-5", streamFor("claude-opus-5"));
  assert.equal(opus.status, 0);
  assert.equal(opus.receipt.expected_model, "claude-opus-5");

  const drift = validate("claude-opus-5", streamFor("claude-fable-5"));
  assert.equal(drift.status, 1);
  assert.equal(drift.receipt.reason, "init_model_mismatch");
  assert.equal(drift.receipt.observed_model, "claude-fable-5");
});

test("review receipt auxiliary allowance is replaceable and assistant-aware", () => {
  const explicit = validate("claude-opus-5", streamFor("claude-opus-5"), 0, ["--allow-aux", "claude-other-1"]);
  assert.equal(explicit.receipt.reason, "model_usage_mismatch");
  assert.equal(explicit.receipt.observed_model, "claude-haiku-4-5-20251001");

  const aux = { type: "assistant", message: { model: "claude-haiku-4-5-20251001" } };
  assert.equal(validateFable([init, aux, assistant, success]).receipt.reason, "validated");

  const unlisted = validateFable([
    init,
    { type: "assistant", message: { model: "claude-sonnet-4-5-20250929" } },
    success,
  ]);
  assert.equal(unlisted.status, 1);
  assert.equal(unlisted.receipt.reason, "assistant_model_mismatch");
});

test("review receipt treats the CLI version as a floor", () => {
  assert.equal(validate("claude-fable-5", streamFor("claude-fable-5", "2.1.223")).receipt.reason, "validated");
  assert.equal(validate("claude-fable-5", streamFor("claude-fable-5", "2.2.0")).receipt.reason, "validated");
  const stale = validate("claude-fable-5", streamFor("claude-fable-5", "2.1.219"));
  assert.equal(stale.status, 1);
  assert.equal(stale.receipt.reason, "unsupported_claude_version");
  assert.equal(stale.receipt.min_claude_code_version, "2.1.220");
  assert.equal(
    validate("claude-fable-5", streamFor("claude-fable-5", "2.1.219"), 0, ["--min-cli-version", "2.1.0"]).receipt.reason,
    "validated",
  );
  assert.equal(
    validate("claude-fable-5", streamFor("claude-fable-5", "2.2"), 0, ["--min-cli-version", "2.1.220"]).receipt.reason,
    "validated",
  );
  assert.equal(
    validate("claude-fable-5", streamFor("claude-fable-5", "2.1.220-rc1")).receipt.reason,
    "unsupported_claude_version",
  );
});

test("review receipt rejects refusal fallback after a valid init", () => {
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

test("review receipt rejects drift, errors, nonzero exits, and truncated streams", () => {
  const reason = (events, exit = 0) => validateFable(events, exit).receipt.reason;
  assert.equal(reason([init, { type: "assistant", message: { model: "claude-opus-5" } }]), "assistant_model_mismatch");
  assert.equal(reason([init, assistant, { ...success, is_error: true }]), "result_error");
  assert.equal(reason([init, assistant, success], 1), "process_exit_nonzero");
  assert.equal(validateFable([init, assistant, { ...success, is_error: true }], 1).receipt.result_is_error, true);
  assert.equal(reason([init, assistant]), "missing_terminal_result");
  assert.equal(reason([init, success]), "missing_assistant_event");
  assert.equal(reason([{ ...init, model: "claude-fable-999" }]), "init_model_mismatch");
  assert.equal(reason([assistant, init, success]), "invalid_event_order");
  assert.equal(reason([init, assistant, success, success]), "invalid_event_order");
  assert.equal(
    reason([init, assistant, { ...success, modelUsage: { ...success.modelUsage, "claude-opus-5": { provider: "firstParty" } } }]),
    "model_usage_mismatch",
  );
  assert.equal(
    reason([init, assistant, { ...success, modelUsage: { "claude-fable-5": { provider: "thirdParty" } } }]),
    "provider_mismatch",
  );
  assert.equal(
    reason([init, assistant, { ...success, modelUsage: { ...success.modelUsage, "claude-sonnet-999": { provider: "firstParty" } } }]),
    "model_usage_mismatch",
  );
  const failedWithDrift = validateFable(
    [init, assistant, { ...success, modelUsage: { "claude-opus-5": { provider: "thirdParty" } } }],
    1,
  );
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
});

test("review receipt reports unreadable streams as metadata", () => {
  const run = spawnSync(
    process.execPath,
    [reviewReceipt, "--exit-status", "0", "--expect-model", "claude-fable-5", "/path/that/does/not/exist/review.jsonl"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).reason, "stream_read_error");
  assert.equal(run.stderr, "");
});
