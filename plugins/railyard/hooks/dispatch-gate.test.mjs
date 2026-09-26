import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "dispatch-gate.js");

// Hermetic run log: never append to the developer's real state dir.
function readLog(dir) {
  let files = [];
  try { files = readdirSync(dir); } catch { return []; }
  return files.flatMap((f) =>
    readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

function run(input, logDir) {
  const logs = logDir ?? mkdtempSync(path.join(tmpdir(), "gate-log-"));
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, RAILYARD_RUN_LOG_DIR: logs, CLAUDE_PLUGIN_ROOT: "" },
  });
  const log = readLog(logs);
  if (!logDir) rmSync(logs, { recursive: true, force: true });
  return { code: r.status, err: r.stderr, out: r.stdout, log };
}

const codex = (args = {}, extra = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: "agentsspawn_agent",
  session_id: "codex-session",
  model: "gpt-6-sol",
  tool_input: { task_name: "worker", message: "Fix the parser and report.", ...args },
  ...extra,
});
const claude = (args = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Agent",
  session_id: "claude-session",
  tool_input: { description: "review parser", prompt: "Review the parser.", ...args },
});

test("Claude dispatches are logged with the requested model or as inheritance", () => {
  const explicit = run(claude({ model: "opus", subagent_type: "general-purpose" }));
  assert.equal(explicit.code, 0, explicit.err);
  assert.equal(explicit.out, "");
  assert.equal(explicit.log.length, 1);
  assert.deepEqual(
    { ...explicit.log[0], ts: undefined },
    {
      ts: undefined, event: "dispatch", phase: "pre_tool_use", tool: "Agent", harness: "claude-code",
      session_id: "claude-session", allocation: "explicit", model: "opus",
      role: "general-purpose", label: "review parser",
    },
  );
  for (const args of [{}, { subagent_type: "fork" }]) {
    const inherited = run(claude(args));
    assert.equal(inherited.code, 0, inherited.err);
    assert.equal(inherited.log[0].allocation, "inherit");
    assert.equal(inherited.log[0].model, undefined);
  }
  // Model names are not validated locally; the tool schema is authoritative.
  assert.equal(run(claude({ model: "some-future-model" })).code, 0);
  assert.equal(run({ tool_name: "Task" }).code, 0);
});

test("Codex dispatches log explicit pairs and inheritance", () => {
  const explicit = run(codex({ model: "gpt-6-luna", reasoning_effort: "low", fork_turns: "none" }));
  assert.equal(explicit.code, 0, explicit.err);
  const [entry] = explicit.log;
  assert.equal(entry.harness, "codex");
  assert.equal(entry.tool, "agentsspawn_agent");
  assert.equal(entry.allocation, "explicit");
  assert.equal(entry.model, "gpt-6-luna");
  assert.equal(entry.effort, "low");
  assert.equal(entry.reasoning_effort, "low");
  assert.equal(entry.label, "worker");
  assert.equal(entry.fork_turns, "none");
  assert.equal(entry.session_id, "codex-session");

  const inherited = run(codex());
  assert.equal(inherited.code, 0, inherited.err);
  assert.equal(inherited.log[0].allocation, "inherit");
  assert.equal(inherited.log[0].model, "gpt-6-sol", "inheritance records the parent model");
  assert.equal(inherited.log[0].effort, undefined);

  const limited = run(codex({ model: "gpt-6-astra", reasoning_effort: "xhigh", fork_turns: "3" }));
  assert.equal(limited.code, 0, limited.err);
});

test("a Codex full-history fork refuses model or effort overrides", () => {
  for (const args of [
    { model: "gpt-6-luna" },
    { reasoning_effort: "high" },
    { model: "gpt-6-luna", reasoning_effort: "low", fork_turns: "all" },
  ]) {
    const r = run(codex(args));
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.err, /full-history fork/);
    assert.match(r.err, /fork_turns/);
    assert.deepEqual(r.log, [], "a refused dispatch is not logged");
  }
  // V1 CLI spelling uses fork_context.
  const v1 = run({ tool_name: "spawn_agent", tool_input: { message: "Fix it.", model: "gpt-6-luna", fork_context: true } });
  assert.equal(v1.code, 2);
  assert.match(v1.err, /fork_context/);
  const v1Limited = run({
    tool_name: "spawn_agent",
    tool_input: { message: "Fix it.", model: "gpt-6-luna", reasoning_effort: "low", fork_context: false },
  });
  assert.equal(v1Limited.code, 0, v1Limited.err);
  // Full-history inheritance is fine.
  assert.equal(run(codex({ fork_turns: "all" })).code, 0);
});

test("other tools, events, and malformed input pass without logging", () => {
  for (const input of [
    { tool_name: "Bash", tool_input: { command: "codex exec -m gpt-6-sol 'do it'" } },
    { tool_name: "agents__spawn_agent", tool_input: { model: "x" } },
    { hook_event_name: "PostToolUse", tool_name: "Agent", tool_input: {} },
    "not json", "", "[]",
  ]) {
    const r = run(input);
    assert.equal(r.code, 0, JSON.stringify(input));
    assert.equal(r.err, "");
    assert.deepEqual(r.log, []);
  }
});

test("an unwritable run log never blocks a dispatch", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-blocked-"));
  const blocker = path.join(dir, "file");
  writeFileSync(blocker, "x");
  try {
    const r = run(claude({ model: "opus" }), path.join(blocker, "logs"));
    assert.equal(r.code, 0);
    assert.equal(r.err, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a complete payload is handled while stdin stays open", async () => {
  const logs = mkdtempSync(path.join(tmpdir(), "gate-open-"));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, RAILYARD_RUN_LOG_DIR: logs },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (chunk) => (err += chunk));
  const payload = JSON.stringify(codex({ model: "gpt-6-luna" }));
  child.stdin.write(payload.slice(0, 25));
  await new Promise((resolve) => setTimeout(resolve, 30));
  child.stdin.write(payload.slice(25));
  const started = Date.now();
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.ok(Date.now() - started < 1500);
  assert.equal(code, 2);
  assert.match(err, /full-history fork/);
  rmSync(logs, { recursive: true, force: true });
});

test("hook manifests register one dispatch hook and one merge guard", () => {
  for (const [file, tools] of [
    ["../codex/hooks.json", ["agentsspawn_agent", "spawn_agent"]],
    ["./claude-hooks.json", ["Agent", "Task"]],
  ]) {
    const manifest = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(manifest.hooks).sort(), ["PreToolUse", "SessionStart"]);
    const [dispatch, merge] = manifest.hooks.PreToolUse;
    assert.equal(manifest.hooks.PreToolUse.length, 2);
    assert.match(dispatch.hooks[0].command, /dispatch-gate\.js/);
    for (const tool of tools) assert.match(tool, new RegExp(`^(?:${dispatch.matcher})$`), `${file}: ${tool}`);
    assert.doesNotMatch("agents__spawn_agent", new RegExp(`^(?:${dispatch.matcher})$`));
    assert.doesNotMatch("Bash", new RegExp(`^(?:${dispatch.matcher})$`), "no shell parsing in the dispatch gate");
    assert.match(merge.hooks[0].command, /merge-settlement-gate\.js/);
    assert.match("Bash", new RegExp(`^(?:${merge.matcher})$`));
    assert.match(manifest.hooks.SessionStart[0].hooks[0].command, /routing-charter\.js/);
    const commands = JSON.stringify(manifest);
    assert.doesNotMatch(commands, /route-lifecycle|route-state|cleanup-codex|railyard-retro|routing-nudge/);
  }
});
