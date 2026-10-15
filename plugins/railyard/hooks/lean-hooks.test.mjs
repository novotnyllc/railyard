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

// Per-repository settings in git config (repo-config.js, railyard:config).
const configScript = path.join(pluginDirectory, "skills", "config", "scripts", "config.mjs");
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

function realRepo(t) {
  const root = mkdtempSync(path.join(tmpdir(), "railyard-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, "main");
  git(root, "init", "-q", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  mkdirSync(path.join(main, "src"));
  return { root, main, home: root };
}

const isolatedEnv = (home) => ({
  ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), GIT_CONFIG_NOSYSTEM: "1",
  RAILYARD_RUN_LOG_DIR: path.join(home, "run-log"), TYPESAFE_API_KEY: "",
});

function runHook(name, cwd, home, input) {
  return spawnSync(process.execPath, [path.join(hookDirectory, name)], {
    cwd, encoding: "utf8", timeout: 5000, env: isolatedEnv(home),
    input: input === undefined ? "" : JSON.stringify(input),
  });
}

const configure = (cwd, home, ...args) =>
  spawnSync(process.execPath, [configScript, ...args], { cwd, encoding: "utf8", env: isolatedEnv(home) });
const charter = (cwd, home) => runHook("routing-charter.js", cwd, home).stdout;
const forkPayload = (cwd) => ({
  hook_event_name: "PreToolUse", cwd, tool_name: "spawn_agent",
  tool_input: { task_name: "x", fork_turns: "all", model: "m" },
});
const mergeCommand = ["gh", "pr", "merge", "1", "--squash"].join(" ");

test("railyard.off stands every hook down in the repository and its worktrees only", (t) => {
  const { root, main, home } = realRepo(t);
  assert.match(configure(main, home, "off").stdout, /railyard: off/);
  git(main, "worktree", "add", "-q", path.join(root, "feature"), "-b", "feature");
  git(root, "clone", "-q", "main", "cloned");
  cpSync(main, path.join(root, "copied"), { recursive: true });

  for (const dir of [main, path.join(main, "src"), path.join(root, "feature")]) {
    assert.match(charter(dir, home), /^Railyard is off in this repository/, dir);
    assert.equal(runHook("dispatch-gate.js", dir, home, forkPayload(dir)).status, 0, dir);
    const merge = runHook("merge-settlement-gate.js", dir, home, {
      hook_event_name: "PreToolUse", cwd: dir, tool_name: "Bash", tool_input: { command: mergeCommand },
    });
    assert.equal(merge.status, 0, merge.stderr);
  }
  for (const dir of [path.join(root, "cloned"), path.join(root, "copied")]) {
    assert.match(charter(dir, home), /^Railyard routing:/, dir);
    assert.equal(runHook("dispatch-gate.js", dir, home, forkPayload(dir)).status, 2, dir);
  }

  assert.match(configure(main, home, "on").stdout, /railyard: on/);
  assert.match(charter(main, home), /^Railyard routing:/);
});

test("tool hooks follow the session folder in the payload, not the process folder", (t) => {
  const { root, main, home } = realRepo(t);
  configure(main, home, "off");
  assert.equal(runHook("dispatch-gate.js", root, home, forkPayload(main)).status, 0);
});

test("review level and CE nudges change only their startup lines", (t) => {
  const { main, home } = realRepo(t);
  const full = charter(main, home);
  assert.match(full, /whole-candidate-review\.md gate/);
  assert.match(full, /Pick Compound Engineering stages/);

  configure(main, home, "review", "light");
  assert.match(charter(main, home), /checks and one combined correctness and maintainability review .*railyard\.review light/);
  configure(main, home, "review", "checks");
  assert.match(charter(main, home), /run the repository's checks; no review passes/);

  configure(main, home, "ce", "off");
  const quiet = charter(main, home);
  assert.match(quiet, /Don't pick Compound Engineering stages unless the user asks/);
  assert.doesNotMatch(quiet, /ce-commit-push-pr|CE owns|CE snapshot/);
  assert.match(quiet, /railyard:deliver request runs through merge/);

  assert.match(configure(main, home, "review", "full").stdout, /review: full {2}ce: off/);
  assert.match(configure(main, home, "ce", "on").stdout, /review: full {2}ce: on/);
  assert.equal(charter(main, home), full);
});

test("the config script rejects unknown values and non-repositories", (t) => {
  const { root, main, home } = realRepo(t);
  assert.equal(configure(main, home, "review", "fast").status, 2);
  assert.equal(configure(main, home, "ce", "maybe").status, 2);
  const outside = mkdtempSync(path.join(tmpdir(), "railyard-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal(configure(outside, home, "off").status, 2);
  assert.match(configure(root, home, "--repo", main).stdout, /railyard: on/);
});

test("merge-gate off stops merge checks in that repository only", (t) => {
  const { root, main, home } = realRepo(t);
  const merge = (dir) => runHook("merge-settlement-gate.js", dir, home, {
    hook_event_name: "PreToolUse", cwd: dir, tool_name: "Bash", tool_input: { command: `${mergeCommand} --admin` },
  });
  assert.equal(merge(main).status, 2);
  assert.match(configure(main, home, "merge-gate", "off").stdout, /merge-gate: off/);
  assert.equal(merge(main).status, 0);
  git(root, "clone", "-q", "main", "cloned");
  assert.equal(merge(path.join(root, "cloned")).status, 2);
  assert.match(configure(main, home, "merge-gate", "on").stdout, /merge-gate: on/);
  assert.equal(merge(main).status, 2);
  assert.equal(configure(main, home, "merge-gate", "maybe").status, 2);
});

test("explicit repository values beat personal global defaults", (t) => {
  const { main, home } = realRepo(t);
  mkdirSync(path.join(home, ".config", "git"), { recursive: true });
  writeFileSync(path.join(home, ".config", "git", "config"), "[railyard]\n\treview = checks\n\tce = off\n");
  assert.match(configure(main, home).stdout, /review: checks {2}ce: off/);
  assert.match(configure(main, home, "review", "full").stdout, /review: full/);
  assert.match(configure(main, home, "ce", "on").stdout, /ce: on/);
});

test("personal global defaults apply outside a repository", (t) => {
  const { home } = realRepo(t);
  mkdirSync(path.join(home, ".config", "git"), { recursive: true });
  writeFileSync(path.join(home, ".config", "git", "config"), "[railyard]\n\tce = off\n");
  const outside = mkdtempSync(path.join(tmpdir(), "railyard-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.match(charter(outside, home), /Don't pick Compound Engineering stages/);
});

test("merge settings follow the repository a merge runs in", (t) => {
  const { root, main, home } = realRepo(t);
  git(root, "init", "-q", "other");
  const run = (cwd, command) => runHook("merge-settlement-gate.js", cwd, home, {
    hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command },
  });
  configure(main, home, "merge-gate", "off");
  assert.equal(run(main, `${mergeCommand} --admin`).status, 0);
  assert.equal(run(main, `cd ${path.join(root, "other")} && ${mergeCommand} --admin`).status, 2);
  configure(main, home, "merge-gate", "on");
  configure(path.join(root, "other"), home, "merge-gate", "off");
  assert.equal(run(main, `cd ${path.join(root, "other")} && ${mergeCommand} --admin`).status, 0);
});

test("a refusal in another repository survives the session repository's settings", (t) => {
  const { root, main, home } = realRepo(t);
  git(root, "init", "-q", "other");
  const run = (command) => runHook("merge-settlement-gate.js", main, home, {
    hook_event_name: "PreToolUse", cwd: main, tool_name: "Bash", tool_input: { command },
  });
  configure(main, home, "merge-gate", "off");
  assert.equal(run(`cd ${path.join(root, "other")} && sh -c '${mergeCommand} --admin'`).status, 2);
  assert.equal(run(`env --chdir=${path.join(root, "other")} sh -c '${mergeCommand} --admin'`).status, 2);
  configure(main, home, "merge-gate", "on");
  configure(main, home, "off");
  assert.equal(run(`cd ${path.join(root, "other")} && ${mergeCommand} --admin`).status, 2);
});

test("a repository switched off with the 0.13 marker file stays off until switched on", (t) => {
  const { main, home } = realRepo(t);
  const common = git(main, "rev-parse", "--path-format=absolute", "--git-common-dir");
  writeFileSync(path.join(common, "railyard-off"), common + "\n");
  assert.match(charter(main, home), /^Railyard is off in this repository/);
  assert.match(configure(main, home, "on").stdout, /railyard: on/);
  assert.match(charter(main, home), /^Railyard routing:/);
});

test("unplaced merges follow local opt-outs unless the script changes directory", (t) => {
  const { root, main, home } = realRepo(t);
  git(root, "init", "-q", "other");
  const run = (command) => runHook("merge-settlement-gate.js", main, home, {
    hook_event_name: "PreToolUse", cwd: main, tool_name: "Bash", tool_input: { command },
  });
  configure(main, home, "merge-gate", "off");
  assert.equal(run(`sh -c '${mergeCommand} --admin'`).status, 0);
  assert.equal(run(`cd ${path.join(root, "other")} && sh -c '${mergeCommand} --admin'`).status, 2);
});
