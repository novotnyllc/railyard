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

test("Bash-launched codex exec records the actual model, reasoning effort, and label", () => {
  const r = run({
    tool_name: "Bash",
    session_id: "sess-codex-exec",
    tool_input: {
      command: "codex exec -m gpt-5.6-luna -c model_reasoning_effort=max --label lane-railyard-cycle 'bounded work'",
    },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(
    { ...r.log[0], ts: undefined },
    {
      ts: undefined,
      event: "dispatch",
      harness: "codex",
      tool: "Bash",
      model: "gpt-5.6-luna",
      effort: "max",
      reasoning_effort: "max",
      label: "lane-railyard-cycle",
      session_id: "sess-codex-exec",
    },
  );
});

test("codex exec parsing requires explicit model and effort", () => {
  const parsed = run({
    tool_name: "exec_command",
    tool_input: { cmd: "/usr/local/bin/codex exec --model=glm-5.2 --reasoning_effort=high" },
  });
  assert.equal(parsed.code, 0);
  assert.equal(parsed.log[0].model, "glm-5.2");
  assert.equal(parsed.log[0].reasoning_effort, "high");

  const incomplete = run({ tool_name: "shell", tool_input: { command: "codex exec 'no explicit flags'" } });
  assert.equal(incomplete.code, 2);
  assert.match(incomplete.err, /model/);
  assert.match(incomplete.err, /reasoning_effort/);
  assert.deepEqual(incomplete.log, []);

  const redirected = run({
    tool_name: "Bash",
    tool_input: { command: "codex exec >worker.log -m gpt-5.6-luna -c model_reasoning_effort=max" },
  });
  assert.equal(redirected.code, 0);
  assert.equal(redirected.log[0].model, "gpt-5.6-luna");
  assert.equal(redirected.log[0].reasoning_effort, "max");
});

test("codex exec parsing recognizes environment and command wrappers", () => {
  const prefixed = run({
    tool_name: "Bash",
    tool_input: { command: "CODEX_HOME=/tmp env -i CODEX_HOME=/tmp codex exec -m gpt-5.6-luna -c model_reasoning_effort=max" },
  });
  assert.equal(prefixed.code, 0);
  assert.equal(prefixed.log[0].model, "gpt-5.6-luna");
  assert.equal(prefixed.log[0].reasoning_effort, "max");

  const commandWrapper = run({
    tool_name: "Bash",
    tool_input: { command: "command codex exec --model=gpt-5.6-sol --reasoning-effort=high" },
  });
  assert.equal(commandWrapper.code, 0);
  assert.equal(commandWrapper.log[0].model, "gpt-5.6-sol");
  assert.equal(commandWrapper.log[0].reasoning_effort, "high");

  const windowsPath = run({
    tool_name: "Bash",
    tool_input: { command: "C:\\Tools\\codex.exe exec -m gpt-5.6-luna -c model_reasoning_effort=max" },
  });
  assert.equal(windowsPath.code, 0);
  assert.equal(windowsPath.log[0].model, "gpt-5.6-luna");
});

test("codex exec parsing recognizes shell substitutions and groups", () => {
  for (const command of [
    "result=$(codex exec 'no explicit flags')",
    "result=\"$(codex exec 'no explicit flags')\"",
    "(codex exec 'no explicit flags')",
    "result=`codex exec 'no explicit flags'`",
    "result=\"`codex exec 'no explicit flags'`\"",
  ]) {
    const refused = run({ tool_name: "Bash", tool_input: { command } });
    assert.equal(refused.code, 2, command);
    assert.match(refused.err, /model/, command);
    assert.match(refused.err, /reasoning_effort/, command);
    assert.deepEqual(refused.log, [], command);
  }
});

test("codex exec parsing recognizes standard process launchers", () => {
  for (const command of [
    "timeout 60 codex exec 'no explicit flags'",
    "nohup codex exec 'no explicit flags'",
    "time codex exec 'no explicit flags'",
    "nice -n 5 codex exec 'no explicit flags'",
    "nice --adjustment=5 codex exec 'no explicit flags'",
    "env -C /tmp codex exec 'no explicit flags'",
    "env --chdir=/tmp codex exec 'no explicit flags'",
    "env --unset=FOO codex exec 'no explicit flags'",
    "env -uFOO codex exec 'no explicit flags'",
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
  ]) {
    const refused = run(input);
    assert.equal(refused.code, 2, JSON.stringify(input));
    assert.match(refused.err, /model/, JSON.stringify(input));
    assert.match(refused.err, /reasoning_effort/, JSON.stringify(input));
    assert.deepEqual(refused.log, [], JSON.stringify(input));
  }

  const allowed = run({
    tool_name: "shell",
    tool_input: { command: ["codex", "exec", "--model=gpt-5.6-luna", "--reasoning-effort=max"] },
  });
  assert.equal(allowed.code, 0);
  assert.equal(allowed.log[0].model, "gpt-5.6-luna");
  assert.equal(allowed.log[0].reasoning_effort, "max");
});

test("codex exec parsing recognizes string shell wrappers", () => {
  for (const command of [
    `bash -c "codex exec 'no explicit flags'"`,
    `sh -lc "codex exec 'no explicit flags'"`,
    `zsh --command "bash -c 'codex exec no-flags'"`,
    `env -i RAILYARD_TEST=1 bash -c "codex exec 'no explicit flags'"`,
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
      command: "codex exec -m gpt-5.6-sol -c 'model_reasoning_effort=\"high\"' && echo codex exec -m stale",
    },
  });
  assert.equal(parsed.log.length, 1);
  assert.equal(parsed.log[0].model, "gpt-5.6-sol");
  assert.equal(parsed.log[0].reasoning_effort, "high");
});

test("the Bash hook exits when its runner leaves stdin open", async () => {
  const r = await runWithOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-open-stdin",
    tool_input: { cmd: "codex exec -m gpt-5.6-luna -c model_reasoning_effort=max" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-5.6-luna");
  assert.equal(r.log[0].reasoning_effort, "max");
});

test("the Bash hook waits for a chunked JSON payload before parsing", async () => {
  const r = await runWithChunkedOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-chunked-stdin",
    tool_input: { cmd: "codex exec -m gpt-5.6-luna -c model_reasoning_effort=max" },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-5.6-luna");
  assert.equal(r.log[0].reasoning_effort, "max");
});

test("the Bash hook does not finalize an incomplete payload after a timer gap", async () => {
  const r = await runWithChunkedOpenStdin({
    tool_name: "exec_command",
    session_id: "sess-gapped-chunked-stdin",
    tool_input: { cmd: "codex exec -m gpt-5.6-luna -c model_reasoning_effort=max" },
  }, 80);
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.log[0].model, "gpt-5.6-luna");
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
