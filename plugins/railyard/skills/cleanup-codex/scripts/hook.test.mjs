import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync as spawnChildSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  hookStatusOutcome,
  runCli,
} from "./cleanup-codex.mjs";

import {
  HOOK_THREAD,
  OTHER_THREAD,
  PLUGIN_DIRECTORY,
  hookCleanupFixture,
  runHookFixture,
} from "./test-support.mjs";

test("SessionEnd hook TERM then KILLs exact matching PIDs and writes no environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 801, parentPid: 1, processGroupId: 800, threadId: HOOK_THREAD },
      { pid: 802, parentPid: 801, processGroupId: 800, threadId: HOOK_THREAD },
      { pid: 803, parentPid: 1, processGroupId: 803, threadId: OTHER_THREAD },
    ]);
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [
      [802, "SIGTERM"], [801, "SIGTERM"], [802, "SIGKILL"], [801, "SIGKILL"],
    ]);
    assert.deepEqual(outcome.receipt.cleanup.selectedPids.sort(), [801, 802]);
    const receipt = fs.readFileSync(outcome.receiptPath, "utf8");
    assert.doesNotMatch(receipt, /CODEX_THREAD_ID|SECRET_VALUE|never-write-this|\/bin\/sh worker/);
    assert.equal(fs.statSync(outcome.receiptPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook refuses mixed-thread and hook/app-server groups", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-refuse-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 810, parentPid: 1, processGroupId: 810, threadId: HOOK_THREAD },
      { pid: 811, parentPid: 1, processGroupId: 810, threadId: OTHER_THREAD },
      { pid: 812, parentPid: 700, processGroupId: 500, threadId: HOOK_THREAD },
    ]);
    const outcome = runHookFixture(fixture, directory);
    assert.deepEqual(fixture.signals, []);
    assert.deepEqual(outcome.receipt.cleanup.selectedPids, []);
    assert.ok(outcome.receipt.cleanup.skippedGroups.some((group) => group.reasons.includes("mixed-thread-group")));
    assert.ok(outcome.receipt.cleanup.skippedGroups.some((group) => group.reasons.includes("hook-or-app-server-group")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook accepts native disappearance and never KILLs a TERM-responsive target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-natural-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 820, parentPid: 1, processGroupId: 820, threadId: HOOK_THREAD },
      { pid: 821, parentPid: 1, processGroupId: 821, threadId: HOOK_THREAD },
    ]);
    const baseRunner = fixture.runner;
    let scans = 0;
    fixture.runner = (file, args, options) => {
      if (file === "/bin/ps" && args[0] === "ww" && ++scans === 2) fixture.remove(820);
      return baseRunner(file, args, options);
    };
    fixture.signalProcess = (pid, signal) => {
      fixture.signals.push([pid, signal]);
      if (signal === "SIGTERM") fixture.remove(pid);
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [[821, "SIGTERM"]]);
    assert.deepEqual(outcome.receipt.cleanup.verifiedPids.sort(), [820, 821]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook treats SIGKILL ESRCH as already gone", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-esrch-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 830, parentPid: 1, processGroupId: 830, threadId: HOOK_THREAD },
    ]);
    fixture.signalProcess = (pid, signal) => {
      fixture.signals.push([pid, signal]);
      if (signal === "SIGKILL") {
        fixture.remove(pid);
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [[830, "SIGTERM"], [830, "SIGKILL"]]);
    assert.deepEqual(outcome.receipt.cleanup.verifiedPids, [830]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook fails closed when post-TERM identity is unknown", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-unknown-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 840, parentPid: 1, processGroupId: 840, threadId: HOOK_THREAD },
    ]);
    const originalReadIdentity = fixture.readIdentity;
    let reads = 0;
    fixture.readIdentity = (pid) => {
      reads += 1;
      return pid === 840 && reads >= 1 ? { state: "unknown" } : originalReadIdentity(pid);
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(fixture.signals, [[840, "SIGTERM"]]);
    assert.ok(outcome.receipt.missingEvidence.includes("hook-post-term-identity-unavailable"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook KILLs an exact process created during TERM grace", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-late-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 850, parentPid: 1, processGroupId: 850, threadId: HOOK_THREAD },
    ]);
    const originalSignal = fixture.signalProcess;
    fixture.signalProcess = (pid, signal) => {
      originalSignal(pid, signal);
      if (pid === 850 && signal === "SIGTERM") {
        fixture.add({ pid: 851, parentPid: 850, processGroupId: 850, threadId: HOOK_THREAD });
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.ok(fixture.signals.some(([pid, signal]) => pid === 851 && signal === "SIGKILL"));
    assert.ok(outcome.receipt.cleanup.verifiedPids.includes(851));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook fails if a target appears during the late KILL pass", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-final-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 860, parentPid: 1, processGroupId: 860, threadId: HOOK_THREAD },
    ]);
    const originalSignal = fixture.signalProcess;
    fixture.signalProcess = (pid, signal) => {
      originalSignal(pid, signal);
      if (pid === 860 && signal === "SIGTERM") {
        fixture.add({ pid: 861, parentPid: 860, processGroupId: 860, threadId: HOOK_THREAD });
      } else if (pid === 861 && signal === "SIGKILL") {
        fixture.add({ pid: 862, parentPid: 1, processGroupId: 862, threadId: HOOK_THREAD });
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.receipt.missingEvidence.includes("hook-final-target-survivor"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid SessionEnd stdin fails closed without scanning or mutation", () => {
  const calls = [];
  const signals = [];
  for (const hookInput of ["", "{}", '{"hook_event_name":"Stop","session_id":"11111111-1111-4111-8111-111111111111"}']) {
    assert.equal(runCli(["cleanup", "--hook"], {
      platform: "darwin",
      hookInput,
      runner: (...args) => { calls.push(args); throw new Error("must not scan"); },
      signalProcess: (...args) => signals.push(args),
    }), EXIT_CODES.refused);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(signals, []);
});

test("SessionEnd payload survives a non-blocking fd 0 the parent writes late", async () => {
  // fd 0 is a non-blocking pipe under the harness: readSync throws EAGAIN
  // until the parent writes. Before the retry loop this returned null, so a
  // healthy session end reported "unavailable" and exited 2.
  const moduleUrl = new URL("./cleanup-codex.mjs", import.meta.url).href;
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const child = spawnChild(process.execPath, ["-e", [
    // resume/pause marks fd 0 O_NONBLOCK in-process, exactly as a
    // non-blocking parent pipe does.
    "process.stdin.resume(); process.stdin.pause();",
    `const m = await import(${JSON.stringify(moduleUrl)});`,
    "console.log(JSON.stringify(m.readHookPayload()));",
  ].join("\n"), "--input-type=module"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  setTimeout(() => {
    child.stdin.end(JSON.stringify({ hook_event_name: "SessionEnd", session_id: sessionId }));
  }, 250);
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout.trim()), { sessionId });
});

test("non-macOS SessionEnd hook no-ops with exit 0 before reading stdin", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(runCli(["cleanup", "--hook"], {
      platform,
      env: {},
      hookInput: "",
      runner: () => { throw new Error("must not scan"); },
      signalProcess: () => { throw new Error("must not signal"); },
      write: () => {},
    }), EXIT_CODES.healthy);
  }
});

test("plugin packaging exposes actual root SessionEnd cleanup and no Claude hook", () => {
  const codexManifest = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, ".codex-plugin", "plugin.json"),
    "utf8",
  ));
  const claudeManifest = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, ".claude-plugin", "plugin.json"),
    "utf8",
  ));
  const hooks = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, "codex", "hooks.json"),
    "utf8",
  ));

  assert.match(codexManifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(codexManifest.hooks, "./codex/hooks.json");
  assert.ok(codexManifest.interface.defaultPrompt.length <= 3);
  assert.equal(claudeManifest.version, codexManifest.version);
  assert.ok(claudeManifest.skills.includes("./skills/cleanup-codex"));
  // Claude loads the routing hooks and the audit markers; the SessionEnd
  // cleanup hook stays Codex-only and must never register here.
  assert.equal(claudeManifest.hooks, "./hooks/claude-hooks.json");
  const claudeHooks = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, "hooks", "claude-hooks.json"),
    "utf8",
  ));
  assert.deepEqual(
    Object.keys(claudeHooks.hooks).sort(),
    ["PreToolUse", "SessionStart", "Stop", "SubagentStart", "SubagentStop", "UserPromptSubmit"],
  );
  // The Stop hook is the retrospective reminder, not a cleanup hook.
  assert.match(claudeHooks.hooks.Stop[0].hooks[0].command, /railyard-retro\.js/);
  for (const event of Object.values(claudeHooks.hooks)) {
    for (const entry of event) {
      for (const hook of entry.hooks) {
        assert.doesNotMatch(hook.command, /cleanup-codex/);
      }
    }
  }
  assert.deepEqual(
    Object.keys(hooks.hooks).sort(),
    ["PreToolUse", "SessionEnd", "SessionStart", "SubagentStart", "SubagentStop", "UserPromptSubmit"],
  );
  const commandHook = hooks.hooks.SessionEnd[0].hooks[0];
  assert.equal(commandHook.type, "command");
  // Codex clamps SessionEnd timeouts to 3s and warns on anything higher;
  // the script's internal 2.2s budget leaves cold-start headroom under it.
  assert.equal(commandHook.timeout, 3);
  assert.match(commandHook.command, /cleanup-codex\.mjs\" cleanup --hook$/);
  assert.doesNotMatch(commandHook.command, /\breap\b|\brecycle\b|\bStop\b|\bSubagentStop\b/);
  // The retrospective reminder rides alongside cleanup as the second
  // SessionEnd hook (Codex has no Stop event); it never does cleanup.
  const retroHook = hooks.hooks.SessionEnd[0].hooks[1];
  assert.match(retroHook.command, /railyard-retro\.js/);
  assert.doesNotMatch(retroHook.command, /cleanup-codex/);
  // Same 3s clamp: anything higher only earns a load warning. The reminder
  // reads one day file and writes one line — ~30ms measured.
  assert.equal(retroHook.timeout, 3);
});

test("Claude loader excludes the Codex-only SessionEnd hook", (context) => {
  const loaded = spawnChildSync(
    "claude",
    ["--plugin-dir", PLUGIN_DIRECTORY, "plugin", "details", "railyard"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (loaded.error?.code === "ENOENT") {
    context.skip("Claude loader is unavailable");
    return;
  }
  assert.equal(loaded.status, 0, loaded.stderr);
  // Claude loads the routing hooks, the audit markers, and the Stop
  // retrospective reminder; the Codex-only SessionEnd cleanup hook must not
  // appear.
  assert.match(loaded.stdout, /Hooks \(6\)/);
  assert.match(loaded.stdout, /SessionStart/);
  assert.match(loaded.stdout, /SubagentStop/);
  assert.match(loaded.stdout, /UserPromptSubmit/);
  assert.doesNotMatch(loaded.stdout, /SessionEnd/);
});

test("hook exit codes agree in both output modes and follow one status table", () => {
  // --json used to report an attempted-but-failed cleanup as exit 2 (refused)
  // where the non-JSON SessionEnd hook the plugin actually runs reported 3.
  assert.deepEqual(
    Object.fromEntries(["healthy", "disabled", "failed", "refused", "unavailable"]
      .map((status) => [status, hookStatusOutcome(status)])),
    {
      healthy: { exitCode: EXIT_CODES.healthy, complete: true },
      disabled: { exitCode: EXIT_CODES.healthy, complete: false },
      failed: { exitCode: EXIT_CODES.failed, complete: false },
      refused: { exitCode: EXIT_CODES.refused, complete: false },
      unavailable: { exitCode: EXIT_CODES.refused, complete: false },
    },
  );
  assert.deepEqual(hookStatusOutcome("warning"), hookStatusOutcome("refused"));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-exit-"));
  try {
    const payload = JSON.stringify({ hook_event_name: "SessionEnd", session_id: HOOK_THREAD });
    const codes = [false, true].map((json) => {
      const fixture = hookCleanupFixture([
        { pid: 870, parentPid: 1, processGroupId: 870, threadId: HOOK_THREAD },
      ]);
      const originalReadIdentity = fixture.readIdentity;
      fixture.readIdentity = (pid) => (pid === 870 ? { state: "unknown" } : originalReadIdentity(pid));
      return runCli(json ? ["cleanup", "--hook", "--json"] : ["cleanup", "--hook"], {
        platform: "darwin",
        hookInput: payload,
        env: { XDG_STATE_HOME: directory, HOME: directory },
        uid: fixture.uid,
        now: Date.parse(fixture.startedAt) + 1_000,
        hookParentPid: 700,
        runner: fixture.runner,
        readIdentity: fixture.readIdentity,
        signalProcess: fixture.signalProcess,
        sleep: () => {},
        lock: { acquire: () => () => {} },
        write: () => {},
      });
    });
    assert.deepEqual(codes, [EXIT_CODES.failed, EXIT_CODES.failed]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
