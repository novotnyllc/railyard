import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hookDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginDirectory = path.resolve(hookDirectory, "..");
const repositoryDirectory = path.resolve(pluginDirectory, "../..");
const retiredHooks = ["routing-nudge", "railyard-retro", "route-state", "route-lifecycle"];

test("retired prompt and retrospective hook scripts are not shipped", () => {
  for (const name of retiredHooks) {
    for (const extension of [".js", ".test.mjs"]) {
      const relative = `hooks/${name}${extension}`;
      assert.equal(existsSync(path.join(pluginDirectory, relative)), false, relative);
    }
  }
});

for (const relative of ["hooks/claude-hooks.json", "codex/hooks.json"]) {
  test(`${relative} has no prompt, stop, or session-end automation`, () => {
    const { hooks } = JSON.parse(readFileSync(path.join(pluginDirectory, relative), "utf8"));
    for (const event of ["UserPromptSubmit", "Stop", "SessionEnd"]) {
      assert.equal(Object.hasOwn(hooks, event), false, `${relative}: ${event}`);
    }
    // Do not pin the number of startup/PreToolUse hooks: a targeted merge
    // guard may be added without restoring the retired ambient behavior.
    const commands = Object.values(hooks).flatMap(entries =>
      entries.flatMap(entry => entry.hooks.flatMap(hook =>
        [hook.command, hook.commandWindows].filter(value => typeof value === "string"))));
    for (const command of commands) {
      for (const name of retiredHooks) {
        assert.ok(!command.includes(name), `${relative} still invokes ${name}`);
      }
    }
  });
}

test("manual audit, retrospective notes, and cleanup remain available", () => {
  for (const relative of [
    "skills/audit/SKILL.md",
    "references/run-audit.md",
    "hooks/run-log.js",
    "skills/cleanup-codex/SKILL.md",
    "skills/cleanup-codex/scripts/cleanup-codex.mjs",
  ]) {
    assert.ok(existsSync(path.join(pluginDirectory, relative)), relative);
  }
  const claude = JSON.parse(readFileSync(path.join(pluginDirectory, ".claude-plugin/plugin.json"), "utf8"));
  const codex = JSON.parse(readFileSync(path.join(pluginDirectory, ".codex-plugin/plugin.json"), "utf8"));
  for (const name of ["audit", "cleanup-codex"]) {
    assert.ok(claude.skills.includes(`./skills/${name}`), `Claude skill ${name}`);
    const discoverable = typeof codex.skills === "string"
      ? existsSync(path.join(pluginDirectory, codex.skills, name, "SKILL.md"))
      : codex.skills.includes(`./skills/${name}`);
    assert.ok(discoverable, `Codex skill ${name}`);
  }
});

test("manual audit notes retain session binding without a retrospective hook", (t) => {
  const cases = [
    { codex: "codex-child", claude: "claude-parent", expected: "codex-child" },
    { codex: "", claude: "claude-session", expected: "claude-session" },
    { codex: "", claude: `  ${"s".repeat(200)}  `, expected: "s".repeat(120) },
    { codex: "", claude: "", expected: undefined },
  ];
  for (const { codex, claude, expected } of cases) {
    const logDirectory = mkdtempSync(path.join(tmpdir(), "lean-hook-audit-"));
    t.after(() => rmSync(logDirectory, { recursive: true, force: true }));
    const result = spawnSync(process.execPath, [
      path.join(hookDirectory, "run-log.js"),
      "note",
      JSON.stringify({ event: "retrospective", what: "requested audit" }),
    ], {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        RAILYARD_RUN_LOG_DIR: logDirectory,
        CODEX_THREAD_ID: codex,
        CLAUDE_CODE_SESSION_ID: claude,
        CLAUDE_PLUGIN_ROOT: "",
      },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const entries = readdirSync(logDirectory).flatMap(name =>
      readFileSync(path.join(logDirectory, name), "utf8").trim().split("\n").map(line => JSON.parse(line)));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].event, "retrospective");
    assert.equal(entries[0].session_id, expected);
  }
});

test("local and CI required suites agree and cover hook retirement", () => {
  const files = ["AGENTS.md", ".github/workflows/validate.yml"];
  const suites = files.map(relative => {
    const source = readFileSync(path.join(repositoryDirectory, relative), "utf8");
    const paths = [...source.matchAll(/plugins\/railyard\/[\w./-]+\.test\.mjs/g)].map(match => match[0]);
    assert.equal(paths.length, new Set(paths).size, `${relative} repeats a test suite`);
    assert.ok(paths.includes("plugins/railyard/hooks/lean-hooks.test.mjs"), `${relative} omits retirement coverage`);
    for (const suite of paths) {
      assert.ok(existsSync(path.join(repositoryDirectory, suite)), `${relative} references missing ${suite}`);
    }
    return paths.sort();
  });
  assert.deepEqual(suites[0], suites[1]);
});
