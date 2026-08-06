import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "dispatch-gate.js");

function run(input) {
  const r = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
  return { code: r.status, err: r.stderr };
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

test("spawn_agent with model and effort passes", () => {
  const r = run({
    tool_name: "spawn_agent",
    tool_input: { model: "gpt-5.6-luna", reasoning_effort: "high", message: "x", task_name: "t" },
  });
  assert.equal(r.code, 0);
});

test("spawn_agent non-OpenAI child on mismatched-family session is refused", () => {
  const r = run({
    tool_name: "spawn_agent",
    model: "gpt-5.6-sol",
    tool_input: { model: "glm-5.2", reasoning_effort: "high", message: "x", task_name: "t" },
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /cannot switch providers/);
  assert.match(r.err, /modelProvider/);
});

test("spawn_agent non-OpenAI child on same-family session passes when provider configured", () => {
  // fail-open on unreadable config.toml means sameFamily alone suffices here
  const r = run({
    tool_name: "spawn_agent",
    model: "glm-5.2",
    tool_input: { model: "glm-5.2", reasoning_effort: "high", message: "x", task_name: "t" },
  });
  // config.toml on this machine configures zai_litellm with glm -> allowed
  assert.equal(r.code, 0);
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

test("garbage stdin fails open", () => {
  assert.equal(run("not json").code, 0);
});

test("missing tool_input fails safe by refusing dispatch tools", () => {
  assert.equal(run({ tool_name: "Agent" }).code, 2);
});
