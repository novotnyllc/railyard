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

function environment(home, overrides = {}) {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, ".codex"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CLAUDE_PLUGIN_ROOT: "",
    ...overrides,
  };
}

function run(home, overrides = {}, input) {
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 5000,
    input: typeof input === "string" ? input : input === undefined ? undefined : JSON.stringify(input),
    // Never inspect the real user's relocated roots.
    env: environment(home, overrides),
  });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  return { out: r.stdout };
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;
const flat = (text) => text.replace(/\s+/g, " ");

test("startup guide stays short and plain", (t) => {
  const { out } = run(fixture(t));
  assert.match(out, /^Railyard publishing:/);
  assert.ok(words(out) <= 250, `SessionStart guide is ${words(out)} words`);
  assert.doesNotMatch(out, /\b[A-Z]{4,}\b/, "no all-caps emphasis");
  assert.doesNotMatch(out, /do not claim|Allocation:/i);
});

test("startup keeps CE ownership, the deliver endpoint, and explicit-only orchestration", (t) => {
  const out = flat(run(fixture(t)).out);
  assert.match(out, /When CE coordinates a PR, it owns review settlement and CI watching/);
  assert.match(out, /Give it references\/review-feedback-settlement\.md/);
  assert.match(out, /Load and invoke railyard:deliver for implementation, fix, and PR creation intent, even when the user does not name the skill/);
  assert.match(out, /Trivial edits can run natively within Deliver and follow the same delivery gates/);
  assert.match(out, /For authorized repository work, a plain implementation or open-PR request includes review, CI, and confirmed merge via the repository’s normal process/);
  assert.match(out, /Complete required release or deployment and verify the consumer/);
  assert.match(out, /Honor approvals, holds, and explicit stops such as plan-only, local-only, PR-only, or no merge/);
  assert.match(out, /railyard:orchestrate for explicitly requested fleet or remote work that needs separate agents/);
  assert.doesNotMatch(out, /Opus|Fable|Sol|Luna|Astra|ce-plan|ce-debug|Pick Compound Engineering stages/);
});

test("startup supplies the shared publication gate to direct CE and LFG callers", (t) => {
  const out = flat(run(fixture(t)).out);
  assert.match(out, /Before every push, including direct CE\/LFG publishing calls, apply the light policy in references\/whole-candidate-review\.md/);
  assert.match(out, /review the whole change independently before first publication/);
  assert.match(out, /review affected behavior for routine repair pushes/);
  assert.ok(readFileSync(path.join(path.dirname(script), "../references/whole-candidate-review.md"), "utf8").includes("complete cumulative change-set"));
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

test("startup accepts the native payload without creating session logs", (t) => {
  const home = fixture(t);
  const logDir = path.join(home, "run-log");
  const { out } = run(home, { RAILYARD_RUN_LOG_DIR: logDir }, {
    hook_event_name: "SessionStart",
    session_id: "native-session",
    cwd: home,
  });
  assert.match(out, /^Railyard publishing:/);
  assert.deepEqual(readdirSync(home), []);
});

test("startup, setup, and doctor do not restore removed behavior-plugin dependencies", () => {
  const pluginRoot = path.resolve(path.dirname(script), "..");
  for (const relative of ["hooks/routing-charter.js", "skills/setup/SKILL.md", "skills/doctor/SKILL.md"]) {
    const source = readFileSync(path.join(pluginRoot, relative), "utf8");
    assert.doesNotMatch(source, /(?:plugin|marketplace)\s+(?:add|install|update)[^\n]*(?:ponytail|superpowers)/i, `${relative} must not install removed behavior plugins`);
    assert.doesNotMatch(source, /installing\s+railyard authorizes[\s\S]{0,100}required plugins/i, `${relative} must not invent grouped installation authority`);
  }
});
