import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "routing-charter.js");

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "charter-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

function run(home, overrides = {}) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 5000,
    // Never inspect the real user's relocated roots or write their run log.
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: path.join(home, ".codex"),
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      RAILYARD_RUN_LOG_DIR: path.join(home, "run-log"),
      ...overrides,
    },
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return { out: r.stdout, logDir: path.join(home, "run-log") };
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
  assert.ok(Buffer.byteLength(out) < 2100, "SessionStart must stay a small route guide");
});

test("startup preserves requested delivery scope and a single CE settlement owner", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /preserve plan\/local-only stops/);
  assert.match(out, /authorized delivery through merge and post-merge proof/);
  assert.match(out, /CE alone\n  owns review settlement and CI\/PR monitoring/);
  assert.match(out, /reuse its active watcher/);
  assert.doesNotMatch(out, /independent Sol|Thermos gate|MUST dispatch|lfg_complete|carrier_started/);
});

test("startup requires deliberate allocation and explains native fork constraints", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /Choose model AND reasoning effort/);
  assert.match(out, /Astra Max is the baseline candidate/);
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
