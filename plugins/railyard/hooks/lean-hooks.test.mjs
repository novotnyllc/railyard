import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// A `railyard-off` file in the shared git directory, naming that directory,
// stands every hook down in the repository and all of its worktrees.
function offRepo(t, { worktree = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "railyard-off-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, "main");
  const common = path.join(main, ".git");
  mkdirSync(common, { recursive: true });
  writeFileSync(path.join(common, "railyard-off"), common + "\n");
  let repo = main;
  if (worktree) {
    repo = path.join(root, "feature");
    const gitDir = path.join(common, "worktrees", "feature");
    mkdirSync(gitDir, { recursive: true });
    writeFileSync(path.join(gitDir, "commondir"), "../..\n");
    mkdirSync(repo);
    writeFileSync(path.join(repo, ".git"), `gitdir: ${gitDir}\n`);
  }
  const nested = path.join(repo, "src");
  mkdirSync(nested);
  return { repo, common, nested, home: root };
}

function runHook(name, cwd, home, input) {
  return spawnSync(process.execPath, [path.join(hookDirectory, name)], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    input: input === undefined ? "" : JSON.stringify(input),
    env: { ...process.env, HOME: home, RAILYARD_RUN_LOG_DIR: path.join(home, "run-log"), TYPESAFE_API_KEY: "" },
  });
}

for (const worktree of [false, true]) {
  test(`railyard-off stands every hook down${worktree ? " in a worktree" : ""}`, (t) => {
    const { nested, home } = offRepo(t, { worktree });

    const charter = runHook("routing-charter.js", nested, home);
    assert.equal(charter.status, 0, charter.stderr);
    assert.match(charter.stdout, /^Railyard is off in this repository/);
    assert.doesNotMatch(charter.stdout, /Railyard routing:/);

    const fork = runHook("dispatch-gate.js", nested, home, {
      hook_event_name: "PreToolUse", cwd: nested, tool_name: "spawn_agent",
      tool_input: { task_name: "x", fork_turns: "all", model: "m" },
    });
    assert.equal(fork.status, 0, fork.stderr);
    assert.equal(fork.stderr, "");

    const merge = runHook("merge-settlement-gate.js", nested, home, {
      hook_event_name: "PreToolUse", cwd: nested, tool_name: "Bash",
      tool_input: { command: "gh pr merge 1 --squash" },
    });
    assert.equal(merge.status, 0, merge.stderr);
    assert.equal(merge.stderr, "");
  });
}

test("hooks stay on without the marker", (t) => {
  const { common, nested, home } = offRepo(t);
  rmSync(path.join(common, "railyard-off"));
  const charter = runHook("routing-charter.js", nested, home);
  assert.match(charter.stdout, /^Railyard routing:/);
  const fork = runHook("dispatch-gate.js", nested, home, {
    hook_event_name: "PreToolUse", cwd: nested, tool_name: "spawn_agent",
    tool_input: { task_name: "x", fork_turns: "all", model: "m" },
  });
  assert.equal(fork.status, 2);
});

test("a copied repository comes back on", (t) => {
  const { repo, home } = offRepo(t);
  const copy = path.join(path.dirname(repo), "copy");
  cpSync(repo, copy, { recursive: true });
  const charter = runHook("routing-charter.js", copy, home);
  assert.match(charter.stdout, /^Railyard routing:/);
  assert.match(runHook("routing-charter.js", repo, home).stdout, /^Railyard is off/);
});

test("tool hooks follow the session folder in the payload, not the process folder", (t) => {
  const { nested, home } = offRepo(t);
  const elsewhere = mkdtempSync(path.join(tmpdir(), "railyard-elsewhere-"));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  const fork = runHook("dispatch-gate.js", elsewhere, home, {
    hook_event_name: "PreToolUse", cwd: nested, tool_name: "spawn_agent",
    tool_input: { task_name: "x", fork_turns: "all", model: "m" },
  });
  assert.equal(fork.status, 0, fork.stderr);
});

test("the README command switches off a real repository and its worktrees", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "railyard-real-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, "main");
  const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  git(root, "init", "-q", "main");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  const common = git(main, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.trim();
  writeFileSync(path.join(common, "railyard-off"), common + "\n");
  git(main, "worktree", "add", "-q", path.join(root, "feature"), "-b", "feature");
  git(root, "clone", "-q", "main", "cloned");
  const on = (dir) => /^Railyard routing:/.test(runHook("routing-charter.js", dir, root).stdout);
  assert.equal(on(main), false);
  assert.equal(on(path.join(root, "feature")), false);
  assert.equal(on(path.join(root, "cloned")), true);
});
