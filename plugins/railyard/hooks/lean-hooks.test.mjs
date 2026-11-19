import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const hookDirectory = path.dirname(fileURLToPath(import.meta.url));
const pluginDirectory = path.resolve(hookDirectory, "..");
const repositoryDirectory = path.resolve(pluginDirectory, "../..");
for (const relative of ["hooks/claude-hooks.json", "codex/hooks.json"]) {
  test(`${relative} registers only the startup guide`, () => {
    const { hooks } = JSON.parse(readFileSync(path.join(pluginDirectory, relative), "utf8"));
    assert.deepEqual(Object.keys(hooks), ["SessionStart"]);
    assert.equal(hooks.SessionStart.length, 1);
    const entries = hooks.SessionStart[0].hooks;
    assert.equal(entries.length, 1);
    assert.match(entries[0].command, /routing-charter\.js/);
    assert.match(entries[0].commandWindows, /routing-charter\.js/);
  });
}

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
});

const configure = (cwd, home, ...args) =>
  spawnSync(process.execPath, [configScript, ...args], { cwd, encoding: "utf8", env: isolatedEnv(home) });
const charter = (cwd, home) => {
  const result = spawnSync(process.execPath, [path.join(hookDirectory, "routing-charter.js")], {
    cwd, encoding: "utf8", timeout: 5000, env: isolatedEnv(home),
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

test("railyard.off disables startup guidance in the repository and its worktrees only", (t) => {
  const { root, main, home } = realRepo(t);
  assert.match(configure(main, home, "off").stdout, /railyard: off/);
  git(main, "worktree", "add", "-q", path.join(root, "feature"), "-b", "feature");
  git(root, "clone", "-q", "main", "cloned");
  cpSync(main, path.join(root, "copied"), { recursive: true });

  for (const dir of [main, path.join(main, "src"), path.join(root, "feature")]) {
    assert.match(charter(dir, home), /^Railyard is off in this repository/, dir);
  }
  for (const dir of [path.join(root, "cloned"), path.join(root, "copied")]) {
    assert.match(charter(dir, home), /^Railyard publishing:/, dir);
  }

  assert.match(configure(main, home, "on").stdout, /railyard: on/);
  assert.match(charter(main, home), /^Railyard publishing:/);
});

test("review level changes the publishing requirement", (t) => {
  const { main, home } = realRepo(t);
  assert.match(configure(main, home).stdout, /review: light/);
  const light = charter(main, home);
  assert.match(light, /apply the light policy in references\/whole-candidate-review\.md/);
  assert.match(light, /review the whole change independently before first publication/);
  assert.match(light, /review affected behavior for routine repair pushes/);

  configure(main, home, "review", "checks");
  assert.match(charter(main, home), /run the repository's checks; no review passes/);

  assert.match(configure(main, home, "review", "full").stdout, /review: full/);
  assert.match(charter(main, home), /whole-candidate-review\.md gate/);
  assert.match(configure(main, home, "review", "light").stdout, /review: light/);
  assert.equal(charter(main, home), light);
});

test("the config script rejects unknown values and non-repositories", (t) => {
  const { root, main, home } = realRepo(t);
  assert.equal(configure(main, home, "review", "fast").status, 2);
  assert.equal(configure(main, home, "unknown").status, 2);
  const outside = mkdtempSync(path.join(tmpdir(), "railyard-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.equal(configure(outside, home, "off").status, 2);
  assert.match(configure(root, home, "--repo", main).stdout, /railyard: on/);
});

test("explicit repository values beat personal global defaults", (t) => {
  const { main, home } = realRepo(t);
  mkdirSync(path.join(home, ".config", "git"), { recursive: true });
  writeFileSync(path.join(home, ".config", "git", "config"), "[railyard]\n\treview = checks\n");
  assert.match(configure(main, home).stdout, /review: checks/);
  assert.match(configure(main, home, "review", "full").stdout, /review: full/);
});

test("personal global defaults apply outside a repository", (t) => {
  const { home } = realRepo(t);
  mkdirSync(path.join(home, ".config", "git"), { recursive: true });
  writeFileSync(path.join(home, ".config", "git", "config"), "[railyard]\n\treview = checks\n");
  const outside = mkdtempSync(path.join(tmpdir(), "railyard-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  assert.match(charter(outside, home), /run the repository's checks/);
});

test("a repository switched off with the 0.13 marker file stays off until switched on", (t) => {
  const { main, home } = realRepo(t);
  const common = git(main, "rev-parse", "--path-format=absolute", "--git-common-dir");
  writeFileSync(path.join(common, "railyard-off"), common + "\n");
  assert.match(charter(main, home), /^Railyard is off in this repository/);
  assert.match(configure(main, home, "on").stdout, /railyard: on/);
  assert.match(charter(main, home), /^Railyard publishing:/);
});
