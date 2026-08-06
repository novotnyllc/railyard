import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "routing-charter.js");

function run(home) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  return { code: r.status, out: r.stdout };
}

function fixtureHome() {
  return mkdtempSync(path.join(tmpdir(), "charter-home-"));
}

test("charter prints routing lines and exits 0", () => {
  const home = fixtureHome();
  const r = run(home);
  assert.equal(r.code, 0);
  assert.match(r.out, /Railyard routing:/);
  rmSync(home, { recursive: true, force: true });
});

test("no harness roots: no dependency warning", () => {
  const home = fixtureHome();
  const r = run(home);
  assert.doesNotMatch(r.out, /ACTION REQUIRED/);
  rmSync(home, { recursive: true, force: true });
});

test("harness root without CE cache warns with that harness's fix", () => {
  const home = fixtureHome();
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const r = run(home);
  assert.match(r.out, /ACTION REQUIRED/);
  assert.match(r.out, /claude plugin marketplace add EveryInc\/compound-engineering-plugin/);
  assert.doesNotMatch(r.out, /codex plugin marketplace add/);
  rmSync(home, { recursive: true, force: true });
});

test("CE installed: no warning", () => {
  const home = fixtureHome();
  const ver = path.join(home, ".claude", "plugins", "cache",
    "compound-engineering-plugin", "compound-engineering", "3.21.1");
  mkdirSync(ver, { recursive: true });
  writeFileSync(path.join(ver, "marker"), "x");
  const r = run(home);
  assert.doesNotMatch(r.out, /ACTION REQUIRED/);
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
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: alt },
  });
  assert.match(r.stdout, /ACTION REQUIRED/);
  rmSync(home, { recursive: true, force: true });
});
