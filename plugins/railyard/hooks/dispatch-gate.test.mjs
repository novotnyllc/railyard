import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";


const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "dispatch-gate.js");

// Hermetic CODEX_HOME: never read the developer's real ~/.codex/config.toml.
function fixtureCodexHome(toml) {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-codex-"));
  if (toml != null) writeFileSync(path.join(dir, "config.toml"), toml);
  return dir;
}

// Hermetic run log too: never append to the developer's real state dir.
function readLog(dir) {
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files.flatMap((f) =>
    readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
  );
}

function run(input, codexHome, logDir, envOverrides = {}) {
  const home = codexHome ?? fixtureCodexHome(null);
  const logs = logDir ?? mkdtempSync(path.join(tmpdir(), "gate-log-"));
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: home, RAILYARD_RUN_LOG_DIR: logs, RAILYARD_ROUTE_STATE_DIR: process.env.RAILYARD_ROUTE_STATE_DIR, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "", ...envOverrides },
  });
  if (!codexHome) rmSync(home, { recursive: true, force: true });
  const log = readLog(logs);
  if (!logDir) rmSync(logs, { recursive: true, force: true });
  return { code: r.status, err: r.stderr, out: r.stdout, log };
}

function runWithOpenStdin(input) {
  const home = fixtureCodexHome(null);
  const logs = mkdtempSync(path.join(tmpdir(), "gate-open-log-"));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, CODEX_HOME: home, RAILYARD_RUN_LOG_DIR: logs },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.write(JSON.stringify(input));
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { code, err, log: readLog(logs) };
      rmSync(home, { recursive: true, force: true });
      rmSync(logs, { recursive: true, force: true });
      resolve(result);
    });
  });
}

function runWithChunkedOpenStdin(input, delayMs = 10) {
  const home = fixtureCodexHome(null);
  const logs = mkdtempSync(path.join(tmpdir(), "gate-chunked-log-"));
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, CODEX_HOME: home, RAILYARD_RUN_LOG_DIR: logs },
    stdio: ["pipe", "ignore", "pipe"],
  });
  let err = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => (err += chunk));
  const raw = JSON.stringify(input);
  const midpoint = Math.ceil(raw.length / 2);
  child.stdin.write(raw.slice(0, midpoint));
  const secondChunk = setTimeout(() => child.stdin.write(raw.slice(midpoint)), delayMs);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(secondChunk);
      const result = { code, err, log: readLog(logs) };
      rmSync(home, { recursive: true, force: true });
      rmSync(logs, { recursive: true, force: true });
      resolve(result);
    });
  });
}

const native = (changes = {}, envelope = {}) => ({
  hook_event_name: "PreToolUse",
  tool_name: "agentsspawn_agent",
  tool_input: {
    task_name: "parser_review",
    message: "Review the parser for correctness and report actionable findings.",
    fork_turns: "none",
    model: "gpt-6-astra",
    reasoning_effort: "max",
    ...changes,
  },
  ...envelope,
});
const inheritBrief = "Allocation: inherit model and reasoning effort; the parent settings fit this review.\nReview the parser and report findings.";
const roleBrief = "Allocation: role configuration; use this specialist's fixed controls and inherit any unset controls.\nReview the parser and report findings.";

function inherited(changes = {}, envelope = {}) {
  const input = native({ message: inheritBrief, fork_turns: "all", ...changes }, envelope);
  delete input.tool_input.model;
  delete input.tool_input.reasoning_effort;
  return input;
}

test("captured Codex 0.154.0 PreToolUse envelope validates child controls", () => {
  // Sanitized from the isolated installed-binary canary on 2026-09-14.
  // The model-facing agents.spawn_agent name is not serialized with a dot.
  const payload = {
    session_id: "fixture-parent",
    turn_id: "fixture-turn",
    transcript_path: null,
    cwd: tmpdir(),
    hook_event_name: "PreToolUse",
    model: "gpt-6-astra",
    permission_mode: "bypassPermissions",
    tool_name: "agentsspawn_agent",
    tool_input: {
      task_name: "contract_probe",
      message: "Read-only synthetic contract canary. Reply with CHILD_FIXTURE_COMPLETE; perform no tools.",
      model: "gpt-6-astra",
      reasoning_effort: "high",
      fork_turns: "none",
    },
    tool_use_id: "fixture_spawn_call",
  };
  const result = run(payload);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.log[0].model, "gpt-6-astra");
  assert.equal(result.log[0].effort, "high");
  assert.equal(result.log[0].phase, "pre_tool_use");
  assert.equal(result.out, "");
});

test("native explicit pair passes with no-history and limited-history task briefs", () => {
  for (const fork_turns of ["none", "1", "3"]) {
    const r = run(native({ fork_turns }));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "");
    assert.equal(r.log[0].model, "gpt-6-astra");
    assert.equal(r.log[0].effort, "max");
    assert.equal(r.log[0].allocation, "explicit");
  }
});

test("native model and effort validation uses this tool's capability pairs", () => {
  for (const [model, reasoning_effort] of [
    ["gpt-6-astra", "ultra"], ["gpt-daybreak-blue-latest", "ultra"],
    ["gpt-6-astra", "low"], ["gpt-6-astra", "max"],
  ]) assert.equal(run(native({ model, reasoning_effort })).code, 0, model);
  for (const [model, reasoning_effort] of [
    ["gpt-6-astra", "none"], ["combo/grok-unified-4.6", "max"],
    ["gpt-6-astra", "turbo"], ["gpt-6-astra", 7], ["gpt-6-astra", {}],
    ["gpt-6-astra", " max "], ["unsupported-native-model", "max"], ["custom-external-model", "high"],
  ]) {
    const r = run(native({ model, reasoning_effort }));
    assert.equal(r.code, 2, `${model} ${JSON.stringify(reasoning_effort)}`);
    assert.match(r.err, /reasoning_effort|model/);
    assert.equal(r.log.length, 0);
  }
});

test("retired model family cannot dispatch natively or through an external provider", () => {
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "openai/gpt-5.6-sol"]) {
    for (const input of [
      native({ model, reasoning_effort: "high" }),
      { tool_name: "Bash", tool_input: { command: `codex exec -m ${model} -c model_reasoning_effort=high -c model_provider=example` } },
    ]) {
      const result = run(input);
      assert.equal(result.code, 2, model);
      assert.match(result.err, /model .* is retired/);
      assert.deepEqual(result.log, []);
    }
  }
});

test("unsupported effort gives the supported choices without downgrading", () => {
  const r = run(native({ model: "gpt-6-astra", reasoning_effort: "none" }));
  assert.match(r.err, /low, medium, high, xhigh, max/);
  assert.match(r.err, /no fallback was applied/);
  assert.equal(r.out, "");
});

test("both fields are deliberately chosen rather than silently omitted", () => {
  for (const field of ["model", "reasoning_effort"]) {
    const input = native();
    delete input.tool_input[field];
    const r = run(input);
    assert.equal(r.code, 2);
    assert.match(r.err, new RegExp(field));
    assert.deepEqual(r.log, []);
  }
  const input = inherited({ message: "Review the parser." });
  const r = run(input);
  assert.equal(r.code, 2);
  assert.match(r.err, /model and reasoning_effort/);
});

test("full-history native forks reject any explicit model or effort override", () => {
  for (const fork_turns of ["all", undefined]) {
    for (const fields of [{ model: "gpt-6-astra" }, { reasoning_effort: "max" }, { model: null }]) {
      const input = inherited({ fork_turns });
      Object.assign(input.tool_input, fields);
      const r = run(input);
      assert.equal(r.code, 2);
      assert.match(r.err, /full-history/);
      assert.match(r.err, /none/);
      assert.match(r.err, /Allocation: inherit model and reasoning effort/);
      assert.deepEqual(r.log, []);
    }
  }
});

test("deliberate native inheritance is supported without invented resolved effort", () => {
  for (const fork_turns of ["all", undefined, "none", "2"]) {
    const r = run(inherited({ fork_turns }, { model: "gpt-6-astra", session_id: "parent-session" }));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.log[0].allocation, "inherit");
    assert.equal(r.log[0].model, "gpt-6-astra");
    assert.equal(r.log[0].effort, undefined);
    assert.equal(r.log[0].reasoning_effort, undefined);
    assert.equal(r.log[0].phase, "pre_tool_use");
    assert.doesNotMatch(JSON.stringify(r.log), /parent settings fit/);
  }
});

test("inheritance declaration requires a reason and cannot conflict with explicit controls", () => {
  assert.equal(run(inherited({ message: "Allocation: inherit model and reasoning effort;\n" })).code, 2);
  assert.equal(run(inherited({ message: "Allocation: inherit model and reasoning effort;\nReview the parser." })).code, 2);
  const r = run(native({ message: inheritBrief }));
  assert.equal(r.code, 2);
  assert.match(r.err, /inheritance conflicts/);
});

test("native fork values and task brief match the exposed schema", () => {
  for (const fork_turns of ["0", "-1", 3, "1.5", "everything", "01", true]) {
    const r = run(native({ fork_turns }));
    assert.equal(r.code, 2, JSON.stringify(fork_turns));
    assert.match(r.err, /fork_turns/);
  }
  for (const message of ["", " \n", null]) assert.equal(run(native({ message })).code, 2);
  assert.equal(run(native({ task_name: "" })).code, 2);
  for (const key of ["agent_type", "fork_context", "items", "service_tier", "model_provider", "plugins"]) {
    const r = run(native({ [key]: "unsupported" }));
    assert.equal(r.code, 2, key);
    assert.match(r.err, /has no/);
  }
});

test("bare and historical names enforce the same V2 payload rather than rewriting it", () => {
  for (const tool_name of ["spawn_agent", "agentsspawn_agent", "agents__spawn_agent"]) {
    const passed = run(native({}, { tool_name }));
    assert.equal(passed.code, 0, passed.err);
    const refused = run(native({ reasoning_effort: "invalid" }, { tool_name }));
    assert.equal(refused.code, 2, tool_name);
  }
});

test("CLI V1 without a named role deliberately chooses or inherits its pair", () => {
  const input = { tool_name: "spawn_agent", tool_input: { message: "Review the parser and report findings.", model: "gpt-6-astra", reasoning_effort: "max", fork_context: false } };
  assert.equal(run(input).code, 0);
  delete input.tool_input.model;
  delete input.tool_input.reasoning_effort;
  assert.equal(run(input).code, 2);
  input.tool_input.message = inheritBrief;
  assert.equal(run(input).code, 0);
});

test("even built-in CLI role names may resolve owner-defined fixed settings", () => {
  for (const agent_type of ["default", "worker", "explorer"]) {
    const input = { tool_name: "spawn_agent", tool_input: { agent_type, message: roleBrief, fork_context: false } };
    assert.equal(run(input).code, 0);
    input.tool_input.model = "gpt-6-astra";
    input.tool_input.reasoning_effort = "max";
    assert.equal(run(input).code, 2);
  }
});

test("custom CLI role owns fixed controls and explicitly inherits any unset controls", () => {
  const input = { tool_name: "spawn_agent", tool_input: { agent_type: "specialist", message: roleBrief, fork_context: false } };
  const r = run(input);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.log[0].allocation, "role");
  assert.equal(r.log[0].role, "specialist");
  assert.equal(r.log[0].model, undefined);
  assert.equal(r.log[0].effort, undefined);
  assert.equal(r.log[0].capability, "runtime_unverified");
  for (const controls of [{ model: "gpt-6-astra" }, { reasoning_effort: "max" }, { model: "gpt-6-astra", reasoning_effort: "max" }]) {
    const refused = run({ ...input, tool_input: { ...input.tool_input, ...controls } });
    assert.equal(refused.code, 2);
    assert.match(refused.err, /Omit both overrides/);
  }
  assert.equal(run({ ...input, tool_input: { ...input.tool_input, message: "Review this task." } }).code, 2);
  assert.equal(run({ ...input, tool_input: { ...input.tool_input, fork_context: true } }).code, 2);
});

test("Claude allocation uses only its exposed model control", () => {
  for (const model of ["opus", "sonnet", "haiku", "fable"]) {
    const r = run({ tool_name: "Agent", tool_input: { model, prompt: "Review this task." } });
    assert.equal(r.code, 0, r.err);
    assert.equal(r.log[0].model, model);
    assert.equal(r.log[0].effort, undefined);
  }
  for (const tool_name of ["Agent", "Task"]) {
    assert.equal(run({ tool_name, tool_input: {} }).code, 2);
    assert.equal(run({ tool_name, tool_input: { prompt: inheritBrief } }).code, 0);
    const invalid = run({ tool_name, tool_input: { model: "gpt-6-astra", prompt: "cross-harness requested" } });
    assert.equal(invalid.code, 2);
    assert.match(invalid.err, /supported CLI or adapter/);
    assert.equal(run({ tool_name, tool_input: { model: "opus", reasoning_effort: "max" } }).code, 2);
  }
});

test("Claude full model IDs and context aliases require a definition or CLI", () => {
  for (const model of ["claude-fable-5-1", "claude-fable-5", "claude-opus-5", "fable[1m]", "opus[1m]"]) {
    const result = run({ tool_name: "Agent", tool_input: { model, prompt: "Review this task." } });
    assert.equal(result.code, 2, model);
    assert.match(result.err, /configured subagent definition/);
    assert.deepEqual(result.log, []);
  }
  for (const field of ["effort", "reasoning_effort"]) {
    const result = run({ tool_name: "Agent", tool_input: { model: "fable", [field]: "max", prompt: "Review this task." } });
    assert.equal(result.code, 2);
    assert.match(result.err, /does not expose a per-call effort parameter/);
  }
});

test("Claude forks inherit and cannot claim an ignored model override", () => {
  const input = { tool_name: "Agent", tool_input: { subagent_type: "fork", prompt: inheritBrief } };
  const inherited = run(input);
  assert.equal(inherited.code, 0, inherited.err);
  assert.equal(inherited.log[0].allocation, "inherit");
  assert.equal(inherited.log[0].model, undefined);
  for (const overrides of [{ model: "fable" }, { prompt: roleBrief }, { prompt: "Review this task." }]) {
    const result = run({ ...input, tool_input: { ...input.tool_input, ...overrides } });
    assert.equal(result.code, 2);
    assert.match(result.err, /fork subagents/);
    assert.deepEqual(result.log, []);
  }
});

test("a forced Claude model cannot be advertised as a caller override", () => {
  for (const value of ["1", "true", "yes", "on", " TRUE ", "\tYes\n", "On"]) {
    const env = { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: value };
    const explicit = run({ tool_name: "Agent", tool_input: { model: "opus", prompt: "Review this task." } }, undefined, undefined, env);
    assert.equal(explicit.code, 2, JSON.stringify(value));
    assert.match(explicit.err, /runtime forces subagent model selection/);
    assert.deepEqual(explicit.log, []);
    const inherited = run({ tool_name: "Agent", tool_input: { prompt: inheritBrief } }, undefined, undefined, env);
    assert.equal(inherited.code, 0, inherited.err);
    assert.equal(inherited.log[0].allocation, "inherit");
  }
});

test("disabled or unrecognized Claude force values preserve the model override", () => {
  for (const value of [undefined, "", "0", "false", "no", "off", " FALSE ", "\tNo\n", "Off", "fable", "2"]) {
    const result = run({ tool_name: "Agent", tool_input: { model: "fable", prompt: "Review this task." } }, undefined, undefined,
      { CLAUDE_CODE_SUBAGENT_MODEL_FORCE: value });
    assert.equal(result.code, 0, `${JSON.stringify(value)}: ${result.err}`);
    assert.equal(result.log[0].allocation, "explicit");
    assert.equal(result.log[0].model, "fable");
  }
});

test("Claude caller effort and omitted model do not verify the child's allocation", () => {
  const result = run({ tool_name: "Agent", model: "claude-fable-5-1", effort: { level: "max" }, tool_input: { subagent_type: "general-purpose", prompt: inheritBrief } });
  assert.equal(result.code, 0, result.err);
  assert.equal(result.log[0].allocation, "inherit");
  assert.equal(result.log[0].capability, "runtime_unverified");
  assert.equal(result.log[0].model, undefined);
  assert.equal(result.log[0].effort, undefined);
});

test("Claude fixed role selection does not require forbidden overrides", () => {
  const input = { tool_name: "Agent", tool_input: { subagent_type: "configured-reviewer", prompt: roleBrief } };
  const r = run(input);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.log[0].allocation, "role");
  assert.equal(r.log[0].model, undefined);
  assert.equal(run({ ...input, tool_input: { ...input.tool_input, model: "opus" } }).code, 2);
});

test("allowed native requests log bounded metadata, never a prompt or completion claim", () => {
  const r = run(native({ task_name: "x".repeat(500), message: "SECRET PROMPT BODY" }, { session_id: "sess-1" }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  assert.equal(r.log.length, 1);
  assert.equal(r.log[0].label.length, 120);
  assert.equal(r.log[0].session_id, "sess-1");
  assert.equal(r.log[0].phase, "pre_tool_use");
  assert.equal(r.log[0].capability, "known_pair");
  assert.doesNotMatch(JSON.stringify(r.log), /SECRET PROMPT BODY|started|completed/);
});

test("unrelated tool calls and malformed envelopes pass without dispatch records", () => {
  for (const input of [null, [], {}, { tool_name: "Read" }, { tool_name: "something_spawn_agent" }, { hook_event_name: "PostToolUse", tool_name: "agentsspawn_agent" }, { tool_name: "Bash", tool_input: { command: "ls" } }]) {
    const r = run(input);
    assert.equal(r.code, 0);
    assert.deepEqual(r.log, []);
    assert.equal(r.out, "");
  }
});

test("CLI dispatch records explicit controls and separates unverified external capability", () => {
  const local = run({ tool_name: "Bash", session_id: "cli-parent", tool_input: { command: "codex exec -m gpt-6-astra -c model_reasoning_effort=max 'review parser'" } });
  assert.equal(local.code, 0, local.err);
  assert.deepEqual({ ...local.log[0], ts: undefined }, {
    ts: undefined, event: "dispatch", phase: "pre_tool_use", tool: "Bash", session_id: "cli-parent",
    harness: "codex", allocation: "explicit", model: "gpt-6-astra", effort: "max", reasoning_effort: "max", capability: "known_pair",
  });
  const external = run({ tool_name: "Bash", tool_input: { command: "codex exec -m custom-external-model -c model_reasoning_effort=xhigh -c model_provider=example" } });
  assert.equal(external.code, 0, external.err);
  assert.equal(external.log[0].capability, "runtime_unverified");
  assert.equal(external.log[0].provider, "example");
  assert.equal(external.log[0].model, "custom-external-model");
  const missingProvider = run({ tool_name: "Bash", tool_input: { command: "codex exec -m custom-external-model -c model_reasoning_effort=xhigh" } });
  assert.equal(missingProvider.code, 2);
  assert.match(missingProvider.err, /model_provider/);
  assert.deepEqual(missingProvider.log, []);
});

test("CLI known effort mismatch blocks, including with an external provider selected", () => {
  for (const extra of ["", " -c model_provider=example"]) {
    const r = run({ tool_name: "Bash", tool_input: { command: "codex exec -m gpt-6-astra -c model_reasoning_effort=none" + extra } });
    assert.equal(r.code, 2);
    assert.match(r.err, /low, medium, high, xhigh, max/);
  }
});

test("CLI model flag wins over config.model in either order and across exec", () => {
  for (const command of [
    'codex exec -m gpt-6-astra -c model="custom-model" -c model_reasoning_effort="none"',
    'codex exec -c model="custom-model" --model=gpt-6-astra -c model_reasoning_effort="none"',
    "codex -m gpt-6-astra exec -c model=custom-model -c model_reasoning_effort=none",
    "codex -c model=custom-model exec -m gpt-6-astra -c model_reasoning_effort=none",
    "codex -m gpt-6-astra -c model=custom-model exec -c model_reasoning_effort=none",
    "codex -c model=custom-model --model=gpt-6-astra exec -c model_reasoning_effort=none",
    "codex -m custom-model exec -m gpt-6-astra -c model=custom-model -c model_reasoning_effort=none",
  ]) {
    const result = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(result.code, 2, command);
    assert.match(result.err, /reasoning_effort for 'gpt-6-astra'/, command);
    assert.match(result.err, /low, medium, high, xhigh, max/, command);
    assert.deepEqual(result.log, [], command);
  }
});

test("CLI logs the effective model flag rather than a later config.model", () => {
  for (const command of [
    "codex exec --model=gpt-6-astra -c model=custom-model -c model_reasoning_effort=ultra",
    "codex exec -c model=custom-model -m gpt-6-astra -c model_reasoning_effort=ultra",
    "codex -m gpt-6-astra exec -c model=custom-model -c model_reasoning_effort=ultra",
    "codex -c model=custom-model exec -m gpt-6-astra -c model_reasoning_effort=ultra",
    "codex -m custom-model exec -m gpt-6-astra -c model=custom-model -c model_reasoning_effort=ultra",
  ]) {
    const result = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(result.code, 0, `${command}: ${result.err}`);
    assert.equal(result.log[0].model, "gpt-6-astra", command);
    assert.equal(result.log[0].effort, "ultra", command);
  }
});

test("CLI uses real config flags before or after exec and does not accept invented effort flags", () => {
  for (const command of [
    "codex --config=model=gpt-6-astra --config=model_reasoning_effort=max exec",
    "codex exec --config=model=gpt-6-astra --config=model_reasoning_effort=max",
    "codex -c model_provider=example exec -m custom-model -c model_reasoning_effort=high",
    "codex exec -m custom-model --local-provider=ollama -c model_reasoning_effort=high",
    "codex --local-provider=ollama exec -m custom-model -c model_reasoning_effort=high",
  ]) assert.equal(run({ tool_name: "Bash", tool_input: { command } }).code, 0, command);
  for (const flag of ["--reasoning-effort=max", "--reasoning_effort=max"]) {
    const r = run({ tool_name: "Bash", tool_input: { command: "codex exec -m gpt-6-astra " + flag } });
    assert.equal(r.code, 2);
    assert.match(r.err, /-c model_reasoning_effort/);
  }
});

test("a refused compound CLI invocation records no allowed dispatches", () => {
  const r = run({ tool_name: "Bash", tool_input: { command: "codex exec -m gpt-6-astra -c model_reasoning_effort=max; codex exec 'missing controls'" } });
  assert.equal(r.code, 2);
  assert.deepEqual(r.log, []);
});

test("codex exec parsing requires explicit model and effort", () => {
  const parsed = run({
    tool_name: "exec_command",
    tool_input: { cmd: "/usr/local/bin/codex exec --model=custom-external-model -c model_reasoning_effort=high -c model_provider=test-provider" },
  });
  assert.equal(parsed.code, 0);
  assert.equal(parsed.log[0].model, "custom-external-model");
  assert.equal(parsed.log[0].reasoning_effort, "high");

  const incomplete = run({ tool_name: "shell", tool_input: { command: "codex exec 'no explicit flags'" } });
  assert.equal(incomplete.code, 2);
  assert.match(incomplete.err, /model/);
  assert.match(incomplete.err, /reasoning_effort/);
  assert.deepEqual(incomplete.log, []);

  const redirected = run({
    tool_name: "Bash",
    tool_input: { command: "codex exec >worker.log -m gpt-6-astra -c model_reasoning_effort=max" },
  });
  assert.equal(redirected.code, 0);
  assert.equal(redirected.log[0].model, "gpt-6-astra");
  assert.equal(redirected.log[0].reasoning_effort, "max");

  const globalOptions = run({
    tool_name: "Bash",
    tool_input: { command: "codex -c model_reasoning_effort=max exec -m gpt-6-astra" },
  });
  assert.equal(globalOptions.code, 0);
  assert.equal(globalOptions.log[0].model, "gpt-6-astra");
  assert.equal(globalOptions.log[0].reasoning_effort, "max");

  const promptOptions = run({
    tool_name: "Bash",
    tool_input: { command: "codex exec -c model_reasoning_effort=max -- --model=gpt-6-astra" },
  });
  assert.equal(promptOptions.code, 2);
  assert.match(promptOptions.err, /model/);
  assert.deepEqual(promptOptions.log, []);
});

test("codex exec parsing recognizes environment and command wrappers", () => {
  const prefixed = run({
    tool_name: "Bash",
    tool_input: { command: "CODEX_HOME=/tmp env -i CODEX_HOME=/tmp codex exec -m gpt-6-astra -c model_reasoning_effort=max" },
  });
  assert.equal(prefixed.code, 0);
  assert.equal(prefixed.log[0].model, "gpt-6-astra");
  assert.equal(prefixed.log[0].reasoning_effort, "max");

  const commandWrapper = run({
    tool_name: "Bash",
    tool_input: { command: "command codex exec --model=gpt-6-astra -c model_reasoning_effort=high" },
  });
  assert.equal(commandWrapper.code, 0);
  assert.equal(commandWrapper.log[0].model, "gpt-6-astra");
  assert.equal(commandWrapper.log[0].reasoning_effort, "high");

  const windowsPath = run({
    tool_name: "Bash",
    tool_input: { command: "C:\\Tools\\codex.exe exec -m gpt-6-astra -c model_reasoning_effort=max" },
  });
  assert.equal(windowsPath.code, 0);
  assert.equal(windowsPath.log[0].model, "gpt-6-astra");
});

test("codex exec parsing recognizes shell substitutions and groups", () => {
  for (const command of [
    "result=$(codex exec 'no explicit flags')",
    "result=\"$(codex exec 'no explicit flags')\"",
    "(codex exec 'no explicit flags')",
    "result=`codex exec 'no explicit flags'`",
    "result=\"`codex exec 'no explicit flags'`\"",
    "echo \"$(echo $(echo x); codex exec 'no explicit flags')\"",
    "echo \"$( (echo x); codex exec 'no explicit flags' )\"",
    String.raw`echo "$(echo \); codex exec 'no explicit flags')"`,
    String.raw`echo "$(case x in x) codex exec 'no explicit flags';; esac)"`,
    "eval \"codex exec 'no explicit flags'\"",
    "''#notcomment; codex exec 'no explicit flags'",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing ignores uninvoked function bodies", () => {
  const definition = run({
    tool_name: "Bash",
    tool_input: { command: "worker() { codex exec 'no explicit flags'; }; echo defined" },
  });
  assert.equal(definition.code, 0);
  assert.deepEqual(definition.log, []);

  const invocation = run({
    tool_name: "Bash",
    tool_input: { command: "worker() { codex exec 'no explicit flags'; }; worker" },
  });
  assert.equal(invocation.code, 2);
  assert.match(invocation.err, /model/);
  assert.match(invocation.err, /reasoning_effort/);
  assert.deepEqual(invocation.log, []);

  for (const command of [
    "worker() { codex exec 'no explicit flags'; }; if worker; then true; fi",
    "worker() { codex exec 'no explicit flags'; }; while worker; do break; done",
    "worker() { codex exec 'no explicit flags'; }; ! worker",
  ]) {
    const controlInvocation = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(controlInvocation.code, 2, command);
    assert.match(controlInvocation.err, /model/, command);
    assert.match(controlInvocation.err, /reasoning_effort/, command);
    assert.deepEqual(controlInvocation.log, [], command);
  }
});

test("codex exec parsing recognizes standard process launchers", () => {
  for (const command of [
    "timeout 60 codex exec 'no explicit flags'",
    "nohup codex exec 'no explicit flags'",
    "time codex exec 'no explicit flags'",
    "nice -n 5 codex exec 'no explicit flags'",
    "nice --adjustment=5 codex exec 'no explicit flags'",
    "coproc codex exec 'no explicit flags'",
    "env -C /tmp codex exec 'no explicit flags'",
    "env --chdir=/tmp codex exec 'no explicit flags'",
    "env --unset=FOO codex exec 'no explicit flags'",
    "env -uFOO codex exec 'no explicit flags'",
    "env --block-signal=PIPE codex exec 'no explicit flags'",
    "env -v codex exec 'no explicit flags'",
    "env --debug codex exec 'no explicit flags'",
    "setsid -cfw codex exec 'no explicit flags'",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing recognizes the exec launcher", () => {
  for (const command of [
    "exec codex exec 'no explicit flags'",
    "exec -cl codex exec 'no explicit flags'",
    "exec -a child-process codex exec 'no explicit flags'",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing recognizes argv shell payloads", () => {
  for (const input of [
    { tool_name: "shell", tool_input: { command: ["bash", "-lc", "codex exec 'no explicit flags'"] } },
    { tool_name: "local_shell", tool_input: { command: ["bash", "-lc", "result=\"$(codex exec 'no explicit flags')\""] } },
    { tool_name: "unified_exec", tool_input: { input: ["bash", "-lc", "codex exec 'no explicit flags'"] } },
    { tool_name: "shell", tool_input: { command: ["env", "-S", "codex exec 'no explicit flags'"] } },
    { tool_name: "shell", tool_input: { command: ["env", "--block-signal=PIPE", "codex", "exec", "no explicit flags"] } },
    { tool_name: "shell", tool_input: { command: ["env", "--debug", "codex", "exec", "no explicit flags"] } },
    { tool_name: "shell", tool_input: { command: ["stdbuf", "-oL", "codex", "exec", "no explicit flags"] } },
    { tool_name: "shell", tool_input: { command: ["setsid", "-c", "-f", "-w", "codex", "exec", "no explicit flags"] } },
    { tool_name: "shell", tool_input: { command: ["xargs", "--eof", "codex", "exec", "no explicit flags"] } },
    { tool_name: "shell", tool_input: { command: ["xargs", "bash", "-c", "codex exec 'no explicit flags'"] } },
    { tool_name: "shell", tool_input: { command: ["builtin", "exec", "codex", "exec", "no explicit flags"] } },
  ]) {
    const refused = run(input);
    assert.equal(refused.code, 2, JSON.stringify(input));
    assert.match(refused.err, /model/, JSON.stringify(input));
    assert.match(refused.err, /reasoning_effort/, JSON.stringify(input));
    assert.deepEqual(refused.log, [], JSON.stringify(input));
  }

  const allowed = run({
    tool_name: "shell",
    tool_input: { command: ["codex", "exec", "--model=gpt-6-astra", "-c", "model_reasoning_effort=max"] },
  });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.log[0].model, "gpt-6-astra");
  assert.equal(allowed.log[0].reasoning_effort, "max");
});

test("codex exec parsing recognizes string shell wrappers", () => {
  for (const command of [
    `bash -c "codex exec 'no explicit flags'"`,
    `sh -lc "codex exec 'no explicit flags'"`,
    `zsh --command "bash -c 'codex exec no-flags'"`,
    `env -i RAILYARD_TEST=1 bash -c "codex exec 'no explicit flags'"`,
    `env -S "codex exec 'no explicit flags'"`,
    `nice -n 5 bash -c "codex exec 'no explicit flags'"`,
    `timeout 60 bash -c "codex exec 'no explicit flags'"`,
    `nohup bash -c "codex exec 'no explicit flags'"`,
    `time bash -c "codex exec 'no explicit flags'"`,
    "builtin command codex exec 'no explicit flags'",
    "builtin exec codex exec 'no explicit flags'",
    "stdbuf -oL codex exec 'no explicit flags'",
    "stdbuf --output=L codex exec 'no explicit flags'",
    "setsid -c -f -w codex exec 'no explicit flags'",
    `true && bash -c "codex exec 'no explicit flags'"`,
    `printf work | xargs codex exec 'no explicit flags'`,
    `printf work | xargs --eof codex exec 'no explicit flags'`,
    `printf work | xargs bash -c "codex exec 'no explicit flags'"`,
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
  const suffix = run({ tool_name: "Bash", tool_input: { command: "bash -c 'echo ok'; codex exec 'no explicit flags'" } });
  assert.equal(suffix.code, 2);
  assert.match(suffix.err, /model/);
  assert.match(suffix.err, /reasoning_effort/);
  assert.deepEqual(suffix.log, []);

  const positional = run({ tool_name: "Bash", tool_input: { command: "bash -c 'echo ok' codex exec 'no explicit flags'" } });
  assert.equal(positional.code, 0);
  assert.deepEqual(positional.log, []);
});

test("codex exec parsing recognizes find exec actions", () => {
  for (const command of [
    String.raw`find . -maxdepth 0 -exec codex exec 'no explicit flags' \;`,
    String.raw`find . -maxdepth 0 -execdir codex exec 'no explicit flags' +`,
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
  const argv = run({
    tool_name: "shell",
    tool_input: { command: ["find", ".", "-exec", "codex", "exec", "no explicit flags", ";"] },
  });
  assert.equal(argv.code, 2);
  assert.match(argv.err, /model/);
  assert.match(argv.err, /reasoning_effort/);
  assert.deepEqual(argv.log, []);

  const decoy = run({
    tool_name: "Bash",
    tool_input: { command: String.raw`find . -exec echo codex exec 'no explicit flags' \;` },
  });
  assert.equal(decoy.code, 0);
  assert.deepEqual(decoy.log, []);
});

test("codex exec parsing recognizes line continuations and ignores heredoc bodies", () => {
  const continued = run({
    tool_name: "Bash",
    tool_input: { command: String.raw`codex \
exec 'no explicit flags'` },
  });
  assert.equal(continued.code, 2);
  assert.match(continued.err, /model/);
  assert.match(continued.err, /reasoning_effort/);
  assert.deepEqual(continued.log, []);

  const arithmeticShift = run({
    tool_name: "Bash",
    tool_input: { command: "echo $((1 << 2))\ncodex exec 'no explicit flags'" },
  });
  assert.equal(arithmeticShift.code, 2);
  assert.match(arithmeticShift.err, /model/);
  assert.match(arithmeticShift.err, /reasoning_effort/);
  assert.deepEqual(arithmeticShift.log, []);

  const heredoc = run({
    tool_name: "Bash",
    tool_input: { command: "cat <<'EOF'\ncodex exec 'no explicit flags'\nEOF" },
  });
  assert.equal(heredoc.code, 0);
  assert.deepEqual(heredoc.log, []);

  const literalUnquotedHeredoc = run({
    tool_name: "Bash",
    tool_input: { command: "cat <<EOF\ncodex exec 'no explicit flags'\nEOF" },
  });
  assert.equal(literalUnquotedHeredoc.code, 0);
  assert.deepEqual(literalUnquotedHeredoc.log, []);

  const expandedUnquotedHeredoc = run({
    tool_name: "Bash",
    tool_input: { command: "cat <<EOF\n$(codex exec 'no explicit flags')\nEOF" },
  });
  assert.equal(expandedUnquotedHeredoc.code, 2);
  assert.match(expandedUnquotedHeredoc.err, /model/);
  assert.match(expandedUnquotedHeredoc.err, /reasoning_effort/);
  assert.deepEqual(expandedUnquotedHeredoc.log, []);

  const multilineExpandedHeredoc = run({
    tool_name: "Bash",
    tool_input: { command: "cat <<EOF\n$(\ncodex exec 'no explicit flags'\n)\nEOF" },
  });
  assert.equal(multilineExpandedHeredoc.code, 2);
  assert.match(multilineExpandedHeredoc.err, /model/);
  assert.match(multilineExpandedHeredoc.err, /reasoning_effort/);
  assert.deepEqual(multilineExpandedHeredoc.log, []);

  const quotedSubstitutionHeredoc = run({
    tool_name: "Bash",
    tool_input: { command: "echo \"$(cat <<EOF\ncodex exec 'no explicit flags'\nEOF\n)\"" },
  });
  assert.equal(quotedSubstitutionHeredoc.code, 0);
  assert.deepEqual(quotedSubstitutionHeredoc.log, []);

  const caseExpandedHeredoc = run({
    tool_name: "Bash",
    tool_input: { command: "cat <<EOF\n$(case x in x) codex exec 'no explicit flags';; esac)\nEOF" },
  });
  assert.equal(caseExpandedHeredoc.code, 2);
  assert.match(caseExpandedHeredoc.err, /model/);
  assert.match(caseExpandedHeredoc.err, /reasoning_effort/);
  assert.deepEqual(caseExpandedHeredoc.log, []);

  const escapedDelimiter = run({
    tool_name: "Bash",
    tool_input: { command: String.raw`cat <<\EOF
codex exec 'no explicit flags'
EOF
codex exec 'no explicit flags'` },
  });
  assert.equal(escapedDelimiter.code, 2);
  assert.match(escapedDelimiter.err, /model/);
  assert.match(escapedDelimiter.err, /reasoning_effort/);
  assert.deepEqual(escapedDelimiter.log, []);

  const continuedDelimiter = run({
    tool_name: "Bash",
    tool_input: { command: String.raw`cat <<EO\
F
codex exec 'no explicit flags'
EOF
codex exec 'no explicit flags'` },
  });
  assert.equal(continuedDelimiter.code, 2);
  assert.match(continuedDelimiter.err, /model/);
  assert.match(continuedDelimiter.err, /reasoning_effort/);
  assert.deepEqual(continuedDelimiter.log, []);
});

test("codex exec parsing recognizes brace groups and oversized payloads", () => {
  for (const command of [
    "{ codex exec 'no explicit flags'; }",
    `${"x".repeat(32769)}; codex exec 'no explicit flags'`,
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command.slice(-80));
    assert.match(refused.err, /model/, command.slice(-80));
    assert.match(refused.err, /reasoning_effort/, command.slice(-80));
    assert.deepEqual(refused.log, [], command.slice(-80));
  }
});

test("codex exec parsing recognizes shell control words", () => {
  for (const command of [
    "if codex exec 'no explicit flags'; then true; fi",
    "if true; then codex exec 'no explicit flags'; fi",
    "while codex exec 'no explicit flags'; do break; done",
    "until codex exec 'no explicit flags'; do break; done",
    "! codex exec 'no explicit flags'",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing recognizes leading redirections", () => {
  for (const command of [
    ">audit.log codex exec 'no explicit flags'",
    "> audit.log codex exec 'no explicit flags'",
    "2>errors codex exec 'no explicit flags'",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing ignores comments, prose, and later shell commands", () => {
  const noise = run({
    tool_name: "Bash",
    tool_input: { command: "echo codex exec -m stale\n# codex exec -m commented" },
  });
  assert.deepEqual(noise.log, []);

  const parsed = run({
    tool_name: "Bash",
    tool_input: {
      command: "codex exec -m gpt-6-astra -c 'model_reasoning_effort=\"high\"' && echo codex exec -m stale",
    },
  });
  assert.equal(parsed.log.length, 1);
  assert.equal(parsed.log[0].model, "gpt-6-astra");
  assert.equal(parsed.log[0].reasoning_effort, "high");
});

test("the Bash hook exits when its runner leaves stdin open", async () => {
  const r = await runWithOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-open-stdin",
    tool_input: { cmd: "codex exec -m gpt-6-astra -c model_reasoning_effort=max" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-6-astra");
  assert.equal(r.log[0].reasoning_effort, "max");
});

test("the Bash hook waits for a chunked JSON payload before parsing", async () => {
  const r = await runWithChunkedOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-chunked-stdin",
    tool_input: { cmd: "codex exec -m gpt-6-astra -c model_reasoning_effort=max" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-6-astra");
  assert.equal(r.log[0].reasoning_effort, "max");
});

test("the Bash hook does not finalize an incomplete payload after a timer gap", async () => {
  const r = await runWithChunkedOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-gapped-chunked-stdin",
    tool_input: { cmd: "codex exec -m gpt-6-astra -c model_reasoning_effort=max" },
  }, 80);
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-6-astra");
  assert.equal(r.log[0].reasoning_effort, "max");
});

test("an unwritable log dir never blocks or errors the dispatch", () => {
  const blocked = path.join(fixtureCodexHome(""), "config.toml", "nope");
  const r = run({ tool_name: "Agent", tool_input: { model: "opus" } }, undefined, blocked);
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.log, []);
});

test("garbage stdin fails open", () => {
  assert.equal(run("not json").code, 0);
});

test("missing tool_input fails safe by refusing dispatch tools", () => {
  assert.equal(run({ tool_name: "Agent" }).code, 2);
});


test("ordinary delegation never injects LFG or creates delivery receipts", () => {
  const routeDir = mkdtempSync(path.join(tmpdir(), "gate-no-routes-"));
  const prior = process.env.RAILYARD_ROUTE_STATE_DIR;
  process.env.RAILYARD_ROUTE_STATE_DIR = routeDir;
  try {
    const r = run(native({ task_name: "lfg_delivery", message: "Run ce-babysit-pr and ce-resolve-pr-feedback for the requested PR." }));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "");
    assert.deepEqual(readdirSync(routeDir), []);
    assert.equal(r.log.length, 1);
    assert.equal(r.log[0].event, "dispatch");
  } finally {
    if (prior === undefined) delete process.env.RAILYARD_ROUTE_STATE_DIR;
    else process.env.RAILYARD_ROUTE_STATE_DIR = prior;
    rmSync(routeDir, { recursive: true, force: true });
  }
});

test("git and PR commands do not require a parallel delivery settlement protocol", () => {
  for (const command of [
    "git push origin feature", "gh pr create --title change", "gh pr merge 10 --squash",
    "gh pr comment 10 --body reviewed", "git commit -m fix && git push && gh pr create",
    "echo 'gh pr merge later'", "bash -lc 'git push origin feature'",
  ]) {
    const r = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.log, []);
  }
});

test("default hook manifests keep startup, dispatch, and CE merge enforcement", () => {
  for (const file of ["../codex/hooks.json", "./claude-hooks.json"]) {
    const manifest = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(manifest.hooks).sort(), ["PreToolUse", "SessionStart"]);
    assert.equal(manifest.hooks.PreToolUse.length, 3);
    for (const rule of manifest.hooks.PreToolUse.slice(0, 2)) assert.match(rule.hooks[0].command, /dispatch-gate\.js/);
    assert.match(manifest.hooks.PreToolUse[2].hooks[0].command, /merge-settlement-gate\.js/);
    assert.ok(new RegExp(`^(?:${manifest.hooks.PreToolUse[2].matcher})$`).test("Bash"));
    assert.match(manifest.hooks.SessionStart[0].hooks[0].command, /routing-charter\.js/);
    assert.doesNotMatch(JSON.stringify(manifest), /cleanup-codex|railyard-retro|routing-nudge|route-lifecycle/);
  }
  const codex = JSON.parse(readFileSync(new URL("../codex/hooks.json", import.meta.url), "utf8"));
  assert.ok(new RegExp(codex.hooks.PreToolUse[1].matcher).test("Bash"));
});

test("Codex manifest routes every supported native spelling through the gate", () => {
  const codex = JSON.parse(readFileSync(new URL("../codex/hooks.json", import.meta.url), "utf8"));
  // Require an explicit whole-name alternative, including the compatibility
  // alias; only agentsspawn_agent was observed in the current V2 binary.
  for (const tool_name of ["agentsspawn_agent", "spawn_agent", "agents__spawn_agent"]) {
    const matchedRule = codex.hooks.PreToolUse.find(({ matcher }) => new RegExp(`^(?:${matcher})$`).test(tool_name));
    assert.ok(matchedRule, `No dispatch hook registered for ${tool_name}`);
    assert.equal(matchedRule.hooks[0].command, 'node "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch-gate.js"');
    const result = run(native({ reasoning_effort: "invalid" }, { tool_name }));
    assert.equal(result.code, 2, tool_name);
    assert.match(result.err, /reasoning_effort/, tool_name);
    assert.deepEqual(result.log, [], tool_name);
  }
});
