import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "routing-charter.js");

function run(home) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    // Hermetic run log: the charter appends its session anchor.
    env: { ...process.env, HOME: home, USERPROFILE: home, RAILYARD_RUN_LOG_DIR: path.join(home, "run-log") },
  });
  return { code: r.status, out: r.stdout, logDir: path.join(home, "run-log") };
}

function fixtureHome() {
  return mkdtempSync(path.join(tmpdir(), "charter-home-"));
}

test("charter prints routing lines and exits 0", () => {
  const home = fixtureHome();
  const r = run(home);
  assert.equal(r.code, 0);
  assert.match(r.out, /Railyard routing:/);
  assert.match(r.out, /route change:/);
  rmSync(home, { recursive: true, force: true });
});

test("charter anchors the run log with one session line", () => {
  const home = fixtureHome();
  const r = run(home);
  const files = readdirSync(r.logDir);
  assert.equal(files.length, 1);
  const lines = readFileSync(path.join(r.logDir, files[0]), "utf8").split("\n").filter(Boolean);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, "session");
  rmSync(home, { recursive: true, force: true });
});

test("no harness roots: no dependency warning", () => {
  const home = fixtureHome();
  const r = run(home);
  assert.doesNotMatch(r.out, /ACTION REQUIRED/);
  rmSync(home, { recursive: true, force: true });
});

// Install one required plugin's cache under a harness root so only the OTHER
// required plugin is reported missing.
function installPlugin(home, harnessDir, cacheDir, plugin) {
  const ver = path.join(home, harnessDir, "plugins", "cache", cacheDir, plugin, "1.0.0");
  mkdirSync(ver, { recursive: true });
  writeFileSync(path.join(ver, "marker"), "x");
}

test("harness root without required caches warns with that harness's fixes", () => {
  const home = fixtureHome();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const r = run(home);
  assert.match(r.out, /ACTION REQUIRED/);
  assert.match(r.out, /claude plugin marketplace add EveryInc\/compound-engineering-plugin/);
  assert.match(r.out, /claude plugin marketplace add DietrichGebert\/ponytail/);
  assert.doesNotMatch(r.out, /codex plugin marketplace add/);
  rmSync(home, { recursive: true, force: true });
});

test("all required plugins installed: no warning", () => {
  const home = fixtureHome();
  installPlugin(home, ".claude", "compound-engineering-plugin", "compound-engineering");
  installPlugin(home, ".claude", "ponytail", "ponytail");
  const r = run(home);
  assert.doesNotMatch(r.out, /ACTION REQUIRED/);
  rmSync(home, { recursive: true, force: true });
});

test("ponytail missing while CE present warns for ponytail only, one grouped block", () => {
  const home = fixtureHome();
  installPlugin(home, ".claude", "compound-engineering-plugin", "compound-engineering");
  const r = run(home);
  assert.match(r.out, /ACTION REQUIRED/);
  assert.match(r.out, /claude plugin install ponytail@ponytail/);
  assert.doesNotMatch(r.out, /claude plugin install compound-engineering/);
  // One grouped install, not two separate ACTION REQUIRED asks.
  assert.equal(r.out.match(/ACTION REQUIRED/g).length, 1);
  rmSync(home, { recursive: true, force: true });
});

test("CE missing while ponytail present warns for CE only", () => {
  const home = fixtureHome();
  installPlugin(home, ".claude", "ponytail", "ponytail");
  const r = run(home);
  assert.match(r.out, /claude plugin install compound-engineering/);
  assert.doesNotMatch(r.out, /ponytail@ponytail/);
  rmSync(home, { recursive: true, force: true });
});

test("both harnesses missing CE: both fixes printed", () => {
  const home = fixtureHome();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  const r = run(home);
  assert.match(r.out, /claude plugin install compound-engineering/);
  assert.match(r.out, /codex plugin add compound-engineering/);
  rmSync(home, { recursive: true, force: true });
});

test("CLAUDE_CONFIG_DIR override is honored", () => {
  const home = fixtureHome();
  const alt = path.join(home, "alt-claude");
  mkdirSync(alt, { recursive: true });
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: alt,
      RAILYARD_RUN_LOG_DIR: path.join(home, "run-log"),
    },
  });
  assert.match(r.stdout, /ACTION REQUIRED/);
  // The override is honored for every required plugin, ponytail included.
  assert.match(r.stdout, /claude plugin install ponytail@ponytail/);
  rmSync(home, { recursive: true, force: true });
});
