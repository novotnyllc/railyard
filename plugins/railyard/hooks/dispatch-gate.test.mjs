import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";


const rs = await import("./route-state.js");
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
    env: { ...process.env, CODEX_HOME: home, RAILYARD_RUN_LOG_DIR: logs, RAILYARD_ROUTE_STATE_DIR: process.env.RAILYARD_ROUTE_STATE_DIR },
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

test("agents__spawn_agent alias is gated exactly like spawn_agent", () => {
  // Codex Desktop multi-agent v2 renames the spawn tool; the gate must not
  // let a missing model/effort through under the namespaced spelling.
  const missing = run({
    tool_name: "agents__spawn_agent",
    tool_input: { message: "x" },
  });
  assert.equal(missing.code, 2);
  assert.match(missing.err, /model and reasoning_effort/);
  const complete = run({
    tool_name: "agents__spawn_agent",
    tool_input: { model: "gpt-5.6-luna", reasoning_effort: "medium", message: "x", task_name: "t" },
  });
  assert.equal(complete.code, 0);
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

  const globalOptions = run({
    tool_name: "Bash",
    tool_input: { command: "codex -c model_reasoning_effort=max exec -m gpt-5.6-luna" },
  });
  assert.equal(globalOptions.code, 0);
  assert.equal(globalOptions.log[0].model, "gpt-5.6-luna");
  assert.equal(globalOptions.log[0].reasoning_effort, "max");

  const promptOptions = run({
    tool_name: "Bash",
    tool_input: { command: "codex exec -c model_reasoning_effort=max -- --model=gpt-5.6-luna" },
  });
  assert.equal(promptOptions.code, 2);
  assert.match(promptOptions.err, /model/);
  assert.deepEqual(promptOptions.log, []);
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

test("non-mutation shell commands pass the route gate", () => {
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "ls -la && git status" } });
  assert.equal(r.code, 0);
});

test("spawn_agent with lfg in task records route_carrier entry", () => {
  const logs = mkdtempSync(path.join(tmpdir(), "gate-rc-"));
  const home = fixtureCodexHome(null);
  const r = run(
    { tool_name: "agents__spawn_agent", tool_input: { model: "gpt-5.6-sol", reasoning_effort: "high", task_name: "lfg_delivery_worker", message: "Run the LFG pipeline for feature X. Use ce-babysit-pr after push." } },
    home, logs
  );
  assert.equal(r.code, 0);
  const rc = readLog(logs).filter((e) => e.event === "route_carrier");
  assert.ok(rc.length > 0, "expected at least one route_carrier entry");
  rmSync(home, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

// === Route-carrier gate tests (route-state based, not run-log) ===

test("git push without any delivery candidate or route passes", () => {
  process.env.RAILYARD_ROUTE_STATE_DIR = mkdtempSync(path.join(tmpdir(), "gate-clean-"));
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "git push origin main" } });
  assert.equal(r.code, 0);
});

test("gh pr create with no active route is refused", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gate-pr-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  // No route created
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: "cd /tmp && gh pr create --title x" } }),
    encoding: "utf8",
    env: { ...process.env, RAILYARD_ROUTE_STATE_DIR: dir },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Route carrier required/);
  rmSync(dir, { recursive: true, force: true });
});

test("gh pr create with pending_spawn route is refused", () => {

  const dir = mkdtempSync(path.join(tmpdir(), "gate-pr-pending-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const route = rs.createRoute({});
  // Route is in pending_spawn — no SubagentStart has fired
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ tool_name: "exec_command", tool_input: { cmd: "gh pr create --title x" } }),
    encoding: "utf8",
    env: { ...process.env, RAILYARD_ROUTE_STATE_DIR: dir, CODEX_THREAD_ID: route.parent_session_id || "none" },
  });
  assert.equal(r.status, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("spawn_agent naming lfg creates an authoritative route (not just a log line)", () => {

  const dir = mkdtempSync(path.join(tmpdir(), "gate-route-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const logs = mkdtempSync(path.join(tmpdir(), "gate-log-"));
  const home = fixtureCodexHome(null);
  const r = run(
    { tool_name: "agents__spawn_agent", tool_input: { model: "gpt-5.6-sol", reasoning_effort: "high", task_name: "lfg_delivery_worker", message: "Run LFG pipeline" } },
    home, logs
  );
  assert.equal(r.code, 0);
  var files = readdirSync(dir).filter(f => f.endsWith(".json") && !f.startsWith("candidate-"));
  assert.ok(files.length > 0, "expected a route file to be created");
  var route = JSON.parse(readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(route.state, "pending_spawn");
  assert.equal(route.protocol, "railyard.route-carrier/v1");
  rmSync(home, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test("TOCTOU guard refuses commit+push+pr create in one shell call", () => {
  process.env.RAILYARD_ROUTE_STATE_DIR = mkdtempSync(path.join(tmpdir(), "gate-toc-"));
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "git add -A && git commit -m x && git push && gh pr create" } });
  assert.equal(r.code, 2);
  assert.match(r.err, /TOCTOU guard/);
});

test("echo of git push text does not trigger the gate", () => {
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "echo 'remember to git push later'" } });
  assert.equal(r.code, 0);
});

test("env-wrapped git push is detected", () => {
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "GIT_AUTHOR_NAME=x env git push origin main" } });
  assert.equal(r.code, 0); // Passes because no route/candidate exists
});

test("bash -lc 'git push' via shell tokens is not falsely gated when no candidate", () => {
  // bash -lc wraps it but shellTokens won't see the inner command as top-level
  const r = run({ tool_name: "exec_command", tool_input: { cmd: "bash -lc 'git push origin main'" } });
  assert.equal(r.code, 0); // Passes because no route/candidate exists
});
