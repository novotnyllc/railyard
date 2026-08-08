import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function run(input, codexHome, logDir) {
  const home = codexHome ?? fixtureCodexHome(null);
  const logs = logDir ?? mkdtempSync(path.join(tmpdir(), "gate-log-"));
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, CODEX_HOME: home, RAILYARD_RUN_LOG_DIR: logs },
  });
  if (!codexHome) rmSync(home, { recursive: true, force: true });
  const log = readLog(logs);
  if (!logDir) rmSync(logs, { recursive: true, force: true });
  return { code: r.status, err: r.stderr, log };
}

test("Agent with explicit model passes", () => {
  const r = run({ tool_name: "Agent", tool_input: { model: "opus", prompt: "x" } });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

test("Agent with explicit session-tier model passes (named escalation)", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { model: "fable" } }).code, 0);
});

test("Agent without model is refused with guidance", () => {
  const r = run({ tool_name: "Agent", tool_input: { prompt: "x" } });
  assert.equal(r.code, 2);
  assert.match(r.err, /explicit model/);
  assert.match(r.err, /opus/);
});

test("Task without model is refused", () => {
  assert.equal(run({ tool_name: "Task", tool_input: {} }).code, 2);
});

test("Agent with empty model string is refused", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { model: "  " } }).code, 2);
});

test("Agent onto an OpenAI/Codex-family model is refused without an opt-in marker", () => {
  const r = run({ tool_name: "Agent", tool_input: { model: "gpt-5.6-luna", prompt: "do the thing" } });
  assert.equal(r.code, 2);
  assert.match(r.err, /cross-harness/i);
  assert.match(r.err, /'gpt-5\.6-luna'/);
});

test("Agent onto a codex/o-series model is refused without opt-in", () => {
  assert.equal(run({ tool_name: "Agent", tool_input: { model: "o3", prompt: "x" } }).code, 2);
  assert.equal(run({ tool_name: "Agent", tool_input: { model: "codex-mini", prompt: "x" } }).code, 2);
});

test("Agent cross-harness dispatch passes when the prompt opts in", () => {
  const r = run({
    tool_name: "Agent",
    tool_input: { model: "gpt-5.6-luna", prompt: "cross-harness: needs the Codex-only importer" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

test("Agent cross-harness opt-in is honored from the description too", () => {
  assert.equal(
    run({
      tool_name: "Agent",
      tool_input: { model: "gpt-5.6-luna", description: "cross-harness scout", prompt: "x" },
    }).code,
    0,
  );
});

test("refused cross-harness dispatch is never recorded", () => {
  assert.deepEqual(
    run({ tool_name: "Agent", tool_input: { model: "gpt-5.6-luna", prompt: "x" } }).log,
    [],
  );
});

test("spawn_agent with model and effort passes", () => {
  const r = run({
    tool_name: "spawn_agent",
    tool_input: { model: "gpt-5.6-luna", reasoning_effort: "high", message: "x", task_name: "t" },
  });
  assert.equal(r.code, 0);
});

const spawnGlm = {
  tool_name: "spawn_agent",
  tool_input: { model: "glm-5.2", reasoning_effort: "high", message: "x", task_name: "t" },
};

test("spawn_agent non-OpenAI child is refused when no [model_providers.*] exists", () => {
  const home = fixtureCodexHome('model = "gpt-5.6-luna"\n# [model_providers.zai_litellm] chezmoi\n');
  const r = run(spawnGlm, home);
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot switch providers/);
  assert.match(r.err, /modelProvider/);
  rmSync(home, { recursive: true, force: true });
});

test("spawn_agent non-OpenAI child passes when a provider section exists under any id", () => {
  // Provider ids are unrelated to model families: zai_litellm serves glm-*.
  // The gate must not claim "no provider for glm" from a model-string grep.
  const home = fixtureCodexHome(
    '[model_providers.zai_litellm]\nname = "Z.ai"\nbase_url = "http://127.0.0.1:4000"\n',
  );
  assert.equal(run(spawnGlm, home).code, 0);
  rmSync(home, { recursive: true, force: true });
});

test("spawn_agent refusal is well-formed with no session model field in the payload", () => {
  const home = fixtureCodexHome("model = \"gpt-5.6-luna\"\n");
  const r = run(spawnGlm, home);
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.err, /''/); // never renders an empty quoted model
  assert.doesNotMatch(r.err, /This session runs/);
  assert.match(r.err, /'glm-5\.2'/);
  rmSync(home, { recursive: true, force: true });
});

test("spawn_agent non-OpenAI child fails open when config.toml is unreadable", () => {
  assert.equal(run(spawnGlm).code, 0);
});

test("spawn_agent missing reasoning_effort is refused naming the field", () => {
  const r = run({ tool_name: "spawn_agent", tool_input: { model: "gpt-5.6-luna" } });
  assert.equal(r.code, 2);
  assert.match(r.err, /reasoning_effort/);
});

test("spawn_agent missing both names both", () => {
  const r = run({ tool_name: "spawn_agent", tool_input: { message: "x" } });
  assert.equal(r.code, 2);
  assert.match(r.err, /model and reasoning_effort/);
});

test("unrelated tools pass untouched", () => {
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "ls" } }).code, 0);
});

test("allowed dispatch records one metadata line, no prompt", () => {
  const r = run({
    tool_name: "Agent",
    session_id: "sess-1",
    tool_input: {
      model: "opus",
      subagent_type: "general-purpose",
      description: "extract the parser",
      prompt: "SECRET PROMPT BODY",
    },
  });
  assert.equal(r.code, 0);
  assert.equal(r.log.length, 1);
  assert.deepEqual(
    { ...r.log[0], ts: undefined },
    {
      ts: undefined,
      event: "dispatch",
      harness: "claude-code",
      tool: "Agent",
      model: "opus",
      role: "general-purpose",
      label: "extract the parser",
      session_id: "sess-1",
    },
  );
  assert.doesNotMatch(JSON.stringify(r.log), /SECRET PROMPT BODY/);
});

test("labels are truncated, never unbounded", () => {
  const r = run({
    tool_name: "Agent",
    tool_input: { model: "opus", description: "x".repeat(500) },
  });
  assert.equal(r.log[0].label.length, 120);
});

test("spawn_agent records model and effort", () => {
  const r = run({
    tool_name: "spawn_agent",
    tool_input: { model: "gpt-5.6-luna", reasoning_effort: "high", task_name: "importer" },
  });
  assert.deepEqual(
    { model: r.log[0].model, effort: r.log[0].effort, label: r.log[0].label, harness: r.log[0].harness },
    { model: "gpt-5.6-luna", effort: "high", label: "importer", harness: "codex" },
  );
});

test("refused dispatches are never recorded", () => {
  assert.deepEqual(run({ tool_name: "Agent", tool_input: { prompt: "x" } }).log, []);
  assert.deepEqual(run({ tool_name: "spawn_agent", tool_input: { model: "gpt-5.6-luna" } }).log, []);
  const home = fixtureCodexHome('model = "gpt-5.6-luna"\n');
  assert.deepEqual(run(spawnGlm, home).log, []);
  rmSync(home, { recursive: true, force: true });
});

test("unrelated tools are not recorded", () => {
  assert.deepEqual(run({ tool_name: "Bash", tool_input: { command: "ls" } }).log, []);
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
