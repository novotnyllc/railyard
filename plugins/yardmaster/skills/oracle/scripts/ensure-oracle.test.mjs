import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "ensure-oracle.sh");
const FORMULA = "steipete/tap/oracle";
const NPM_PACKAGE = "@steipete/oracle@0.17.0";

function writeExecutable(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source, { mode: 0o755 });
}

function writeOracle(file, version, fails = false) {
  writeExecutable(
    file,
    fails
      ? "#!/bin/sh\nexit 7\n"
      : `#!/bin/sh\nprintf '%s\\n' 'oracle ${version}'\n`,
  );
}

function createFixture(initialState, npmState = "missing") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ensure-oracle-"));
  const fixture = {
    directory,
    state: path.join(directory, "formula-state"),
    prefix: path.join(directory, "canonical-homebrew", "Cellar", "oracle"),
    brew: path.join(directory, "canonical-homebrew", "bin", "brew"),
    brewLog: path.join(directory, "brew-mutations.log"),
    brewInspectLog: path.join(directory, "brew-inspections.log"),
    brewCalled: path.join(directory, "unexpected-brew-call"),
    npm: path.join(directory, "canonical-npm", "bin", "npm"),
    npmLog: path.join(directory, "npm-mutations.log"),
    npmCalled: path.join(directory, "unexpected-npm-call"),
    npmState: path.join(directory, "npm-state"),
    shadowLog: path.join(directory, "path-shadow-used"),
    shadowDirectory: path.join(directory, "path-shadow"),
    home: path.join(directory, "home"),
    npmPrefix: path.join(directory, "home", ".local"),
    oracleHome: path.join(directory, "oracle-home"),
    dispose() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };

  fs.writeFileSync(fixture.state, `${initialState}\n`);
  fs.writeFileSync(fixture.npmState, `${npmState}\n`);
  fs.mkdirSync(path.join(fixture.home, ".oracle"), { recursive: true });
  fs.mkdirSync(fixture.oracleHome, { recursive: true });
  fs.writeFileSync(path.join(fixture.home, ".oracle", "sentinel"), "browser-state\n");
  fs.writeFileSync(path.join(fixture.oracleHome, "sentinel"), "oracle-home-state\n");

  if (["current", "multi-keg", "prefix-failure", "bad-executable-version"].includes(initialState)) {
    writeOracle(
      path.join(fixture.prefix, "bin", "oracle"),
      initialState === "bad-executable-version" ? "0.9.9" : "0.17.0",
    );
  }
  if (initialState === "version-failure") {
    writeOracle(path.join(fixture.prefix, "bin", "oracle"), "0.17.0", true);
  }
  if (["current", "stale"].includes(npmState)) {
    writeOracle(path.join(fixture.npmPrefix, "bin", "oracle"), npmState === "stale" ? "0.9.9" : "0.17.0");
  }
  if (["stale", "upgrade-failure"].includes(initialState)) {
    writeOracle(path.join(fixture.prefix, "bin", "oracle"), "0.9.9");
  }

  writeExecutable(
    fixture.brew,
    `#!/bin/sh
oracle_test_mode=$(cat "$ORACLE_TEST_STATE")

write_oracle() {
  mkdir -p "$ORACLE_TEST_PREFIX/bin"
  printf '%s\\n' '#!/bin/sh' 'printf "%s\\n" "oracle 0.17.0"' > "$ORACLE_TEST_PREFIX/bin/oracle"
  chmod +x "$ORACLE_TEST_PREFIX/bin/oracle"
}

case "$1" in
  list)
    printf '%s\n' "$*" >> "$ORACLE_TEST_BREW_INSPECT_LOG"
    if [ "$2" != "--versions" ] || [ "$3" != "--formula" ] || [ "$4" != "${FORMULA}" ] || [ "$#" -ne 4 ]; then
      printf 'unexpected list arguments\\n' >&2
      exit 64
    fi
    case "$oracle_test_mode" in
      missing|install-failure) exit 1 ;;
      stale|upgrade-failure) printf '%s\\n' 'oracle 0.9.9' ;;
      multi-keg) printf '%s\\n' 'oracle 0.9.9 0.17.0 0.16.9' ;;
      inspect-failure) printf 'fake formula inspection failure\\n' >&2; exit 2 ;;
      *) printf '%s\\n' 'oracle 0.17.0' ;;
    esac
    ;;
  install)
    if [ "$2" != "--formula" ] || [ "$3" != "--no-ask" ] || [ "$4" != "${FORMULA}" ] || [ "$#" -ne 4 ]; then
      printf 'unexpected install arguments\\n' >&2
      exit 64
    fi
    printf '%s|cleanup=%s|dependents=%s\\n' "$*" "$HOMEBREW_NO_INSTALL_CLEANUP" "$HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK" >> "$ORACLE_TEST_BREW_LOG"
    if [ "$oracle_test_mode" = "install-failure" ]; then
      printf 'fake install failure\\n' >&2
      exit 2
    fi
    write_oracle
    printf 'current\\n' > "$ORACLE_TEST_STATE"
    ;;
  upgrade)
    if [ "$2" != "--formula" ] || [ "$3" != "--minimum-version" ] || [ "$4" != "0.17.0" ] || [ "$5" != "--no-ask" ] || [ "$6" != "${FORMULA}" ] || [ "$#" -ne 6 ]; then
      printf 'unexpected upgrade arguments\\n' >&2
      exit 64
    fi
    printf '%s|cleanup=%s|dependents=%s\\n' "$*" "$HOMEBREW_NO_INSTALL_CLEANUP" "$HOMEBREW_NO_INSTALLED_DEPENDENTS_CHECK" >> "$ORACLE_TEST_BREW_LOG"
    if [ "$oracle_test_mode" = "upgrade-failure" ]; then
      printf 'fake upgrade failure\\n' >&2
      exit 2
    fi
    write_oracle
    printf 'current\\n' > "$ORACLE_TEST_STATE"
    ;;
  --prefix)
    if [ "$2" != "${FORMULA}" ] || [ "$#" -ne 2 ]; then
      printf 'unexpected prefix arguments\\n' >&2
      exit 64
    fi
    if [ "$oracle_test_mode" = "prefix-failure" ]; then
      printf 'fake prefix failure\\n' >&2
      exit 2
    fi
    printf '%s\\n' "$ORACLE_TEST_PREFIX"
    ;;
  *)
    printf 'unexpected brew command\\n' >&2
    exit 64
    ;;
esac
`,
  );
  writeExecutable(
    fixture.npm,
    `#!/bin/sh
oracle_npm_state=$(cat "$ORACLE_TEST_NPM_STATE")

if [ "$1" != "install" ] || [ "$2" != "--global" ] || [ "$3" != "--prefix" ] || [ "$4" != "$ORACLE_TEST_NPM_PREFIX" ] || [ "$5" != "${NPM_PACKAGE}" ] || [ "$#" -ne 5 ]; then
  printf 'unexpected npm arguments\\n' >&2
  exit 64
fi
printf '%s\\n' "$*" >> "$ORACLE_TEST_NPM_LOG"
if [ "$oracle_npm_state" = "failure" ]; then
  printf 'fake npm failure\\n' >&2
  exit 2
fi
oracle_npm_version=0.17.0
case "$oracle_npm_state" in
  post-install-stale) oracle_npm_version=0.9.9 ;;
  post-install-invalid) oracle_npm_version=invalid ;;
  post-install-prerelease) oracle_npm_version=0.17.0-beta.1 ;;
esac
mkdir -p "$ORACLE_TEST_NPM_PREFIX/bin"
printf '%s\\n' '#!/bin/sh' "printf '%s\\n' 'oracle $oracle_npm_version'" > "$ORACLE_TEST_NPM_PREFIX/bin/oracle"
chmod +x "$ORACLE_TEST_NPM_PREFIX/bin/oracle"
printf 'current\\n' > "$ORACLE_TEST_NPM_STATE"
`,
  );
  writeExecutable(
    path.join(fixture.shadowDirectory, "brew"),
    "#!/bin/sh\nprintf '%s\\n' brew >> \"$ORACLE_TEST_SHADOW_LOG\"\nexit 97\n",
  );
  writeExecutable(
    path.join(fixture.shadowDirectory, "oracle"),
    "#!/bin/sh\nprintf '%s\\n' oracle >> \"$ORACLE_TEST_SHADOW_LOG\"\nexit 97\n",
  );

  return fixture;
}

function invoke(fixture, {
  oracleBin,
  calls = 1,
  direct = false,
  rejectBrew = false,
  noBrew = false,
  rejectNpm = false,
} = {}) {
  const environment = {
    ...process.env,
    HOME: fixture.home,
    ORACLE_HOME_DIR: fixture.oracleHome,
    ORACLE_TEST_BREW_CALLED: fixture.brewCalled,
    ORACLE_TEST_BREW_LOG: fixture.brewLog,
    ORACLE_TEST_BREW_INSPECT_LOG: fixture.brewInspectLog,
    ORACLE_TEST_BREW: fixture.brew,
    ORACLE_TEST_NPM_LOG: fixture.npmLog,
    ORACLE_TEST_NPM_CALLED: fixture.npmCalled,
    ORACLE_TEST_NPM: fixture.npm,
    ORACLE_TEST_NPM_PREFIX: fixture.npmPrefix,
    ORACLE_TEST_NPM_STATE: fixture.npmState,
    ORACLE_TEST_PREFIX: fixture.prefix,
    ORACLE_TEST_SHADOW_LOG: fixture.shadowLog,
    ORACLE_TEST_STATE: fixture.state,
    PATH: `${fixture.shadowDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  delete environment.ORACLE_BIN;
  if (oracleBin !== undefined) {
    environment.ORACLE_BIN = oracleBin;
  }

  const brewResolver = rejectBrew
    ? "oracle_find_brew() { printf 'called\\n' > \"$ORACLE_TEST_BREW_CALLED\"; return 99; }"
    : noBrew
      ? "oracle_find_brew() { return 1; }"
      : "oracle_find_brew() { printf '%s\\n' \"$ORACLE_TEST_BREW\"; }";
  const npmResolver = rejectNpm
    ? "oracle_find_npm() { printf 'called\\n' > \"$ORACLE_TEST_NPM_CALLED\"; return 1; }"
    : "oracle_find_npm() { printf '%s\\n' \"$ORACLE_TEST_NPM\"; }";
  const commands = Array.from({ length: calls }, () => "ensure_oracle").join("\n");

  if (direct) {
    return spawnSync("/bin/bash", [SCRIPT], { encoding: "utf8", env: environment });
  }

  return spawnSync(
    "/bin/bash",
    ["-c", `source "$1"\n${brewResolver}\n${npmResolver}\n${commands}`, "bash", SCRIPT, fixture.brew, fixture.npm],
    { encoding: "utf8", env: environment },
  );
}

function brewMutations(fixture) {
  return fs.existsSync(fixture.brewLog)
    ? fs.readFileSync(fixture.brewLog, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

function brewInspections(fixture) {
  return fs.existsSync(fixture.brewInspectLog)
    ? fs.readFileSync(fixture.brewInspectLog, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

function npmMutations(fixture) {
  return fs.existsSync(fixture.npmLog)
    ? fs.readFileSync(fixture.npmLog, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

function assertOracleStateIsPreserved(fixture) {
  assert.equal(fs.readFileSync(path.join(fixture.home, ".oracle", "sentinel"), "utf8"), "browser-state\n");
  assert.equal(fs.readFileSync(path.join(fixture.oracleHome, "sentinel"), "utf8"), "oracle-home-state\n");
}

test("a valid explicit Oracle override resolves without Homebrew", () => {
  const fixture = createFixture("missing");
  const oracle = path.join(fixture.directory, "explicit", "oracle");

  try {
    writeOracle(oracle, "0.17.0");
    const result = invoke(fixture, { oracleBin: oracle, rejectBrew: true, rejectNpm: true });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), oracle);
    const directResult = invoke(fixture, { oracleBin: oracle, direct: true });
    assert.equal(directResult.status, 0, directResult.stderr);
    assert.equal(directResult.stdout.trim(), oracle);
    assert.equal(fs.existsSync(fixture.brewCalled), false);
    assert.equal(fs.existsSync(fixture.npmCalled), false);
    assert.deepEqual(brewMutations(fixture), []);
    assert.deepEqual(npmMutations(fixture), []);
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("invalid explicit overrides fail validation without Homebrew", () => {
  const fixture = createFixture("missing");
  const oldOracle = path.join(fixture.directory, "old-oracle");
  const prereleaseOracle = path.join(fixture.directory, "prerelease-oracle");
  const nonExecutable = path.join(fixture.directory, "non-executable");

  try {
    writeOracle(oldOracle, "0.9.9");
    writeOracle(prereleaseOracle, "0.17.0-beta.1");
    fs.writeFileSync(nonExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o644 });

    for (const oracleBin of ["", "oracle", fixture.directory, nonExecutable, oldOracle, prereleaseOracle]) {
      const result = invoke(fixture, { oracleBin, rejectBrew: true, rejectNpm: true });

      assert.notEqual(result.status, 0, oracleBin || "empty override");
      assert.equal(result.stdout, "", oracleBin || "empty override");
      assert.match(result.stderr, /ORACLE_BIN/, oracleBin || "empty override");
      assert.equal(fs.existsSync(fixture.brewCalled), false, oracleBin || "empty override");
      assert.equal(fs.existsSync(fixture.npmCalled), false, oracleBin || "empty override");
    }
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("a missing formula installs once, preserves Oracle state, and is idempotent", () => {
  const fixture = createFixture("missing");
  const expected = path.join(fixture.prefix, "bin", "oracle");

  try {
    const result = invoke(fixture, { calls: 2 });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [expected, expected]);
    assert.deepEqual(brewMutations(fixture), [
      `install --formula --no-ask ${FORMULA}|cleanup=1|dependents=1`,
    ]);
    assert.deepEqual(npmMutations(fixture), []);
    assert.equal(fs.readFileSync(fixture.state, "utf8"), "current\n");
    assert.equal(fs.existsSync(fixture.shadowLog), false);
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("a current formula performs no mutation and ignores PATH shadows", () => {
  const fixture = createFixture("current");
  const expected = path.join(fixture.prefix, "bin", "oracle");

  try {
    const result = invoke(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
    assert.deepEqual(brewMutations(fixture), []);
    assert.deepEqual(npmMutations(fixture), []);
    assert.equal(fs.existsSync(fixture.shadowLog), false);
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("multiple installed Homebrew kegs select the highest version without mutation", () => {
  const fixture = createFixture("multi-keg");
  const expected = path.join(fixture.prefix, "bin", "oracle");

  try {
    const result = invoke(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
    assert.deepEqual(brewMutations(fixture), []);
    assert.deepEqual(npmMutations(fixture), []);
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("a 0.9.x formula upgrades numerically with the narrow Homebrew environment", () => {
  const fixture = createFixture("stale");
  const expected = path.join(fixture.prefix, "bin", "oracle");

  try {
    const result = invoke(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
    assert.deepEqual(brewMutations(fixture), [
      `upgrade --formula --minimum-version 0.17.0 --no-ask ${FORMULA}|cleanup=1|dependents=1`,
    ]);
    assert.deepEqual(npmMutations(fixture), []);
    assert.equal(fs.readFileSync(fixture.state, "utf8"), "current\n");
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("the stable npm prefix is current without mutation and repairs missing or stale Oracle", () => {
  const cases = [
    ["missing", 2, [`install --global --prefix %PREFIX% ${NPM_PACKAGE}`]],
    ["current", 1, []],
    ["stale", 1, [`install --global --prefix %PREFIX% ${NPM_PACKAGE}`]],
  ];

  for (const [npmState, calls, expectedNpmMutations] of cases) {
    const fixture = createFixture("missing", npmState);
    const expected = path.join(fixture.npmPrefix, "bin", "oracle");

    try {
      const result = invoke(fixture, { calls, noBrew: true });

      assert.equal(result.status, 0, `${npmState}: ${result.stderr}`);
      assert.deepEqual(result.stdout.trim().split("\n"), Array(calls).fill(expected), npmState);
      assert.deepEqual(brewMutations(fixture), [], npmState);
      assert.deepEqual(
        npmMutations(fixture),
        expectedNpmMutations.map((entry) => entry.replace("%PREFIX%", fixture.npmPrefix)),
        npmState,
      );
      assert.equal(fs.existsSync(fixture.shadowLog), false, npmState);
      assertOracleStateIsPreserved(fixture);
    } finally {
      fixture.dispose();
    }
  }
});

test("failed Homebrew installation and upgrade fall back to the stable npm prefix", () => {
  for (const [initialState, brewCommand] of [["install-failure", "install"], ["upgrade-failure", "upgrade"]]) {
    const fixture = createFixture(initialState, "missing");
    const expected = path.join(fixture.npmPrefix, "bin", "oracle");

    try {
      const result = invoke(fixture, { calls: 2 });

      assert.equal(result.status, 0, `${initialState}: ${result.stderr}`);
      assert.deepEqual(result.stdout.trim().split("\n"), [expected, expected], initialState);
      assert.equal(brewMutations(fixture)[0]?.split(" ")[0], brewCommand, initialState);
      assert.deepEqual(npmMutations(fixture), [
        `install --global --prefix ${fixture.npmPrefix} ${NPM_PACKAGE}`,
      ], initialState);
      assertOracleStateIsPreserved(fixture);
    } finally {
      fixture.dispose();
    }
  }
});

test("unresolvable or invalid Homebrew verification falls back to the stable npm prefix", () => {
  for (const initialState of ["prefix-failure", "bad-executable-version", "version-failure"]) {
    const fixture = createFixture(initialState, "missing");
    const expected = path.join(fixture.npmPrefix, "bin", "oracle");

    try {
      const result = invoke(fixture, { calls: 2 });

      assert.equal(result.status, 0, `${initialState}: ${result.stderr}`);
      assert.deepEqual(result.stdout.trim().split("\n"), [expected, expected], initialState);
      assert.deepEqual(brewMutations(fixture), [], initialState);
      assert.deepEqual(npmMutations(fixture), [
        `install --global --prefix ${fixture.npmPrefix} ${NPM_PACKAGE}`,
      ], initialState);
      assertOracleStateIsPreserved(fixture);
    } finally {
      fixture.dispose();
    }
  }
});

test("inspection and failures after both managers emit no executable", () => {
  const cases = [
    ["bad-executable-version", "post-install-stale", {}, /npm package .*too old/, [], ["install"]],
    ["version-failure", "post-install-invalid", {}, /npm package .*failed to report/, [], ["install"]],
    ["version-failure", "post-install-prerelease", {}, /npm package .*too old/, [], ["install"]],
    ["missing", "failure", { noBrew: true }, /npm could not install/, [], ["install"]],
    ["missing", "missing", { noBrew: true, rejectNpm: true }, /npm is unavailable/, [], []],
  ];

  for (const [initialState, npmState, options, message, expectedBrew, expectedNpm] of cases) {
    const fixture = createFixture(initialState, npmState);

    try {
      const result = invoke(fixture, options);

      assert.notEqual(result.status, 0, initialState);
      assert.equal(result.stdout, "", initialState);
      assert.match(result.stderr, message, initialState);
      assert.deepEqual(
        brewMutations(fixture).map((entry) => entry.split(" ")[0]),
        expectedBrew,
        initialState,
      );
      assert.deepEqual(
        npmMutations(fixture).map((entry) => entry.split(" ")[0]),
        expectedNpm,
        initialState,
      );
      assertOracleStateIsPreserved(fixture);
    } finally {
      fixture.dispose();
    }
  }
});

test("a Homebrew inspection failure falls back once and reuses the stable npm executable", () => {
  const fixture = createFixture("inspect-failure", "missing");
  const expected = path.join(fixture.npmPrefix, "bin", "oracle");

  try {
    const result = invoke(fixture, { calls: 2 });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [expected, expected]);
    assert.deepEqual(brewInspections(fixture), Array(2).fill(`list --versions --formula ${FORMULA}`));
    assert.deepEqual(npmMutations(fixture), [
      `install --global --prefix ${fixture.npmPrefix} ${NPM_PACKAGE}`,
    ]);
    assertOracleStateIsPreserved(fixture);
  } finally {
    fixture.dispose();
  }
});

test("the helper has no PATH Oracle, npx, or pnpm fallback", () => {
  const source = fs.readFileSync(SCRIPT, "utf8");

  assert.doesNotMatch(source, /command -v (?:brew|oracle)/);
  assert.doesNotMatch(source, /\b(?:npx|pnpm)\b/);
});
