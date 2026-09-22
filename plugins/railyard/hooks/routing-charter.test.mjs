import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import runLog from "./run-log.js";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "routing-charter.js");

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "charter-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function environment(home, overrides = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, ".codex"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CLAUDE_PLUGIN_ROOT: "",
    RAILYARD_RUN_LOG_DIR: path.join(home, "run-log"),
    TYPESAFE_API_KEY: "",
    ...overrides,
  };
}

function run(home, overrides = {}, input) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 5000,
    input: typeof input === "string" ? input : input === undefined ? undefined : JSON.stringify(input),
    // Never inspect the real user's relocated roots or write their run log.
    env: environment(home, overrides),
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return { out: r.stdout, logDir: path.join(home, "run-log") };
}

function entries(home) {
  const directory = path.join(home, "run-log");
  return readdirSync(directory).sort().flatMap((file) =>
    readFileSync(path.join(directory, file), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

async function runOpenInput(home, send) {
  const child = spawn(process.execPath, [script], { env: environment(home), stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { err += chunk; });
  child.stdin.on("error", () => {}); // The bounded reader may close before late data.
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  const deadline = setTimeout(() => child.kill(), 2000);
  try {
    await send(child);
    assert.equal(await completed, 0, err);
    assert.equal(err, "");
    assert.match(out, /Railyard routing:/);
  } finally {
    clearTimeout(deadline);
    child.stdin.destroy();
  }
}

test("startup keeps native work, selected CE, and explicit orchestration distinct", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /native tools for ordinary local work/);
  assert.match(out, /Automatically select the CE/);
  assert.match(out, /Routine fixes can stay direct/);
  assert.match(out, /ce-commit-push-pr when\n  creating a PR or pushing user-requested commits/);
  assert.match(out, /explicitly requested fleet\/account allocation/);
  assert.match(out, /configured inventory alone does not activate it/);
  assert.match(out, /native subagents for ordinary delegation/);
  assert.match(out, /visible user-owned\n  tasks only on explicit user direction/);
  assert.match(out, /Prefer child completion notifications; do independent work, then yield\n  only with a verified resume path or use a blocking event wait/);
  assert.match(out, /Pass this\n  rule to children; avoid repeated status checks and duplicate work/);
  assert.ok(Buffer.byteLength(out) < 2250, "SessionStart must stay a small route guide");
});

test("startup preserves requested delivery scope and a single CE settlement owner", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /preserve plan\/local-only stops/);
  assert.match(out, /authorized delivery through merge, required release or deployment,\n  and consumer verification/);
  assert.match(out, /CE alone\n  owns review settlement and CI\/PR monitoring/);
  assert.match(out, /reuse its active watcher/);
  assert.match(out, /user-invoked Deliver change includes commit, PR, merge, required release\n  or deployment, and consumer verification unless explicitly narrowed/);
  assert.doesNotMatch(out, /independent Sol|Thermos gate|MUST dispatch|lfg_complete|carrier_started/);
});

test("configured Jev advice is advertised without exposing credentials or sending startup content", (t) => {
  const home = fixture(t);
  const input = { hook_event_name: "SessionStart", prompt: "private-task-canary" };
  const { out } = run(home, { TYPESAFE_API_KEY: "test-only-secret-canary" }, input);
  assert.match(out, /Use railyard:jev by default/);
  assert.match(out, /offline\/privacy restrictions/);
  assert.ok(Buffer.byteLength(out) < 2500, "configured SessionStart must remain bounded");
  const recorded = JSON.stringify(entries(home));
  for (const secret of ["test-only-secret-canary", "private-task-canary"]) {
    assert.ok(!out.includes(secret));
    assert.ok(!recorded.includes(secret));
  }
  for (const key of ["", "   "]) {
    assert.doesNotMatch(run(home, { TYPESAFE_API_KEY: key }).out, /railyard:jev/);
  }
});

test("startup requires deliberate allocation and explains native fork constraints", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /Choose model AND reasoning effort/);
  assert.match(out, /Astra Max is the baseline candidate/);
  assert.match(out, /substantive\n  Codex work/);
  assert.match(out, /For Claude Code, consider Fable 5\.1 with a deliberately chosen\n  effort/);
  assert.match(out, /Deliberate inheritance is valid/);
  assert.match(out, /omit model\/effort\n  overrides on full-history native forks/);
  assert.match(out, /Respect fixed-role tool controls/);
  assert.match(out, /deterministic tools directly\n  for mechanical work/);
  assert.doesNotMatch(out, /cheap-model child|worker tier by default|Every subagent.*explicit model/);
});

test("startup does not turn routine work into artifact or cleanup obligations", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /Contracts,\n  route receipts, retrospectives, and runtime cleanup are on-demand tools/);
  assert.match(out, /not prerequisites for ordinary work/);
  assert.doesNotMatch(out, /mandatory closing|run.*retrospective|ACTION REQUIRED|ponytail/i);
});

test("missing plugins in both empty harness roots do not bootstrap dependencies", (t) => {
  const home = fixture(t);
  mkdirSync(path.join(home, ".claude"));
  mkdirSync(path.join(home, ".codex"));
  const { out } = run(home);
  assert.doesNotMatch(out, /ACTION REQUIRED|plugin (marketplace|install|add)|ponytail/i);
  assert.deepEqual(readdirSync(path.join(home, ".claude")), []);
  assert.deepEqual(readdirSync(path.join(home, ".codex")), []);
});

test("installed and relocated plugin caches cannot alter startup routing", (t) => {
  const home = fixture(t);
  const expected = run(home).out;
  const codexRoot = path.join(home, "relocated-codex");
  const claudeRoot = path.join(home, "relocated-claude");
  for (const root of [codexRoot, claudeRoot]) {
    for (const [marketplace, plugin] of [
      ["compound-engineering-plugin", "compound-engineering"],
      ["ponytail", "ponytail"],
    ]) {
      const version = path.join(root, "plugins", "cache", marketplace, plugin, "1.0.0");
      mkdirSync(version, { recursive: true });
      writeFileSync(path.join(version, "marker"), "untouched");
    }
  }
  const { out } = run(home, { CODEX_HOME: codexRoot, CLAUDE_CONFIG_DIR: claudeRoot });
  assert.equal(out, expected);
  for (const root of [codexRoot, claudeRoot]) {
    assert.deepEqual(readdirSync(root), ["plugins"]);
    assert.equal(readFileSync(path.join(root, "plugins/cache/ponytail/ponytail/1.0.0/marker"), "utf8"), "untouched");
  }
});

test("startup anchors the run log with one session line", (t) => {
  const { logDir } = run(fixture(t));
  const files = readdirSync(logDir);
  assert.equal(files.length, 1);
  const lines = readFileSync(path.join(logDir, files[0]), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, "session");
  assert.equal(JSON.parse(lines[0]).session_id, undefined);
  assert.equal(JSON.parse(lines[0]).cwd, undefined);
});

test("native and Claude SessionStart payloads supply identity and cwd without extra content", (t) => {
  for (const harness of ["codex", "claude-code"]) {
    const home = fixture(t);
    const sid = `${harness}-current-task`;
    const cwd = path.join(home, "actual-task-workdir");
    run(home, {
      CODEX_THREAD_ID: "ancestor-codex",
      CLAUDE_CODE_SESSION_ID: "ancestor-claude",
      CLAUDE_PLUGIN_ROOT: path.join(home, harness === "codex" ? ".codex" : ".claude", "plugins", "railyard"),
    }, {
      hook_event_name: "SessionStart", session_id: sid, cwd,
      transcript_path: "/private/transcript.jsonl", source: "startup",
      model: "fixture-model", permission_mode: "default",
      prompt: "never record this body", session_title: "never record this title",
    });
    const [anchor] = entries(home);
    assert.equal(anchor.session_id, sid);
    assert.equal(anchor.cwd, cwd);
    assert.equal(anchor.harness, harness);
    assert.deepEqual(Object.keys(anchor).sort(), ["cwd", "event", "harness", "session_id", "ts"]);
  }
});

test("missing or malformed startup input never borrows an ancestor's identity or cwd", (t) => {
  for (const input of [undefined, "{", "not JSON", null, [], {},
    { hook_event_name: "PostToolUse", session_id: "wrong-event", cwd: "/wrong" },
    { hook_event_name: "SessionStart", session_id: {}, cwd: [] },
    { hook_event_name: "SessionStart", session_id: "s".repeat(121), cwd: "x".repeat(4097) },
  ]) {
    const home = fixture(t);
    run(home, { CODEX_THREAD_ID: "ancestor", CLAUDE_CODE_SESSION_ID: "other-ancestor" }, input);
    const [anchor] = entries(home);
    assert.equal(anchor.session_id, undefined);
    assert.equal(anchor.cwd, undefined);
    assert.equal(entries(home).length, 1);
  }
});

test("partial startup metadata preserves known fields without inventing the missing ones", (t) => {
  const home = fixture(t);
  run(home, {}, { hook_event_name: "SessionStart", session_id: "known-task" });
  run(home, {}, { hook_event_name: "SessionStart", cwd: "/known/workdir" });
  const [identified, unidentified] = entries(home);
  assert.equal(identified.session_id, "known-task");
  assert.equal(identified.cwd, undefined);
  assert.equal(unidentified.session_id, undefined);
  assert.equal(unidentified.cwd, "/known/workdir");
});

test("oversized startup input preserves the route guide with an unidentified anchor", (t) => {
  const home = fixture(t);
  run(home, {}, { hook_event_name: "SessionStart", session_id: "oversized-task", cwd: "/work",
    unused: "x".repeat(128 * 1024) });
  assert.deepEqual(Object.keys(entries(home)[0]).sort(), ["event", "ts"]);
});

test("a complete native payload finishes while its stdin pipe remains open", async (t) => {
  const home = fixture(t);
  await runOpenInput(home, (child) => {
    child.stdin.write(JSON.stringify({ hook_event_name: "SessionStart", session_id: "open-pipe-task", cwd: "/native/work" }));
  });
  assert.equal(entries(home)[0].session_id, "open-pipe-task");
});

test("an empty or incomplete open pipe cannot hold startup beyond its input budget", async (t) => {
  for (const input of ["", '{"hook_event_name":"SessionStart",']) {
    const home = fixture(t);
    const started = Date.now();
    await runOpenInput(home, (child) => { if (input) child.stdin.write(input); });
    assert.ok(Date.now() - started < 1500);
    assert.equal(entries(home)[0].session_id, undefined);
  }
});

test("startup prints before input and accepts a fragmented payload within its budget", async (t) => {
  const home = fixture(t);
  await runOpenInput(home, async (child) => {
    await new Promise((resolve) => child.stdout.once("data", resolve));
    const payload = JSON.stringify({ hook_event_name: "SessionStart", session_id: "fragmented-task", cwd: "/work" });
    child.stdin.write(payload.slice(0, 20));
    await new Promise((resolve) => setTimeout(resolve, 50));
    child.stdin.write(payload.slice(20));
  });
  assert.equal(entries(home)[0].session_id, "fragmented-task");
});

test("audit selection keeps interleaved sessions and their outcomes separate", (t) => {
  const home = fixture(t);
  const cwd = "/shared/worktree";
  run(home, {}, { hook_event_name: "SessionStart", session_id: "task-a", cwd });
  run(home, {}, { hook_event_name: "SessionStart", session_id: "task-b", cwd });
  const file = path.join(home, "run-log", readdirSync(path.join(home, "run-log"))[0]);
  const append = (values) => writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + "\n", { flag: "a" });
  append([
    { event: "dispatch", phase: "pre_tool_use", session_id: "task-a", label: "worker" },
    { event: "outcome", session_id: "task-b", what: "worker", result: "complete" },
    { event: "dispatch", cwd, label: "unidentified" },
  ]);
  run(home, {}, { hook_event_name: "SessionStart", source: "resume", session_id: "task-a", cwd });
  append([{ event: "dispatch", session_id: "task-b", label: "next worker" }]);
  const all = entries(home);
  assert.deepEqual(runLog.entriesForSession(all, "task-a").map((entry) => entry.event), ["session", "dispatch", "session"]);
  assert.deepEqual(runLog.entriesForSession(all, "task-b").map((entry) => entry.event), ["session", "outcome", "dispatch"]);
  assert.equal(runLog.entriesForSession(all, "task-a").some((entry) => entry.event === "outcome"), false,
    "another task's completion must not fill this task's missing completion evidence");
  assert.deepEqual(runLog.entriesForSession(all, undefined), []);
  assert.deepEqual(runLog.entriesForSession(all, "task"), []);
  assert.deepEqual(runLog.entriesForSession([null, [], "malformed", ...all], "task-a"), runLog.entriesForSession(all, "task-a"));
});

test("identified dispatches remain usable when their startup anchor is missing", () => {
  const dispatch = { event: "dispatch", session_id: "partial-run" };
  assert.deepEqual(runLog.entriesForSession([dispatch, { event: "session" }], "partial-run"), [dispatch]);
});

test("an unavailable run-log destination does not block startup", (t) => {
  const home = fixture(t);
  const blocker = path.join(home, "not-a-directory");
  writeFileSync(blocker, "untouched");
  const { out } = run(home, { RAILYARD_RUN_LOG_DIR: path.join(blocker, "run-log") });
  assert.match(out, /Railyard routing:/);
  assert.equal(readFileSync(blocker, "utf8"), "untouched");
});


test("startup, setup, and doctor do not restore removed behavior-plugin dependencies", () => {
  const pluginRoot = path.resolve(path.dirname(script), "..");
  for (const relative of ["hooks/routing-charter.js", "skills/setup/SKILL.md", "skills/doctor/SKILL.md"]) {
    const source = readFileSync(path.join(pluginRoot, relative), "utf8");
    assert.doesNotMatch(source, /(?:plugin|marketplace)\s+(?:add|install|update)[^\n]*(?:ponytail|superpowers)/i, `${relative} must not install removed behavior plugins`);
    assert.doesNotMatch(source, /installing\s+railyard authorizes[\s\S]{0,100}required plugins/i, `${relative} must not invent grouped installation authority`);
  }
});
