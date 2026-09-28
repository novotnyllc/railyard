// Desktop recycle: the idle gate, relaunch, watchdog and host guards.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  EXIT_CODES,
  armRelaunchWatchdog,
  bundleRunning,
  codexHomeFromOpenFiles,
  countsAsDesktopThread,
  createDefaultDesktopDependencies,
  defaultWatchdogDeps,
  desktopBusyReasons,
  desktopRecommendations,
  desktopServerEvidenceGap,
  launchBundle,
  parseCliArgs,
  readDesktopActivity,
  readLaunchdMaxfiles,
  readTurn,
  recycleDesktop,
  runCli,
  runRelaunchWatchdog,
  stateDatabaseIn,
} from "./cleanup-codex.mjs";

import {
  NOW,
  desktopHarness,
  desktopInventoryFixture,
  desktopOptions,
  exactIdentity,
  liveIdentity,
  processRecord,
  recycleHarness,
} from "./test-support.mjs";

test("a desktop quit that reports failure but still lands is waited out and relaunched", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness({ quitReportsOk: false });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.deepEqual(harness.calls.launch, ["/Applications/ChatGPT.app"]);
});

test("desktop first pass binds the host app and returns a token without mutation", () => {
  const harness = desktopHarness();
  const { result, exitCode } = recycleDesktop(desktopOptions(), harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.verification.missingEvidence, ["confirmation-required"]);
  assert.equal(result.verification.mutationAttempted, false);
  const receipt = result.verification.receipt;
  assert.match(receipt.confirmationToken, /^RECYCLE [0-9a-f]{64}$/);
  assert.equal(receipt.host.pid, 13007);
  assert.equal(receipt.host.bundleId, "com.openai.codex");
  assert.equal(receipt.server.pid, 13125);
  assert.deepEqual(receipt.targets.map((target) => target.pid), [200, 201]);
  assert.deepEqual(result.verification.launchdMaxfiles, { soft: 256, hard: "unlimited" });
  assert.deepEqual(result.skipped, [{ pid: 202, reasons: ["identity-unavailable"], startTime: "2026-08-02T15:00:00.000Z" }]);
  assert.deepEqual(harness.calls.quit, []);
  assert.equal(harness.calls.lock, 0);

  const again = recycleDesktop(desktopOptions(), desktopHarness().deps);
  assert.equal(again.result.verification.receipt.confirmationToken, receipt.confirmationToken);
});

test("confirmed desktop recycle quits, relaunches the exact bundle, then reaps exact residue", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness();
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);

  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.deepEqual(harness.calls.order, ["watchdog", "quit", "launch", "reap"]);
  assert.deepEqual(harness.calls.launch, ["/Applications/ChatGPT.app"]);
  assert.deepEqual(result.verification.relaunch, { attempted: true, requested: true, verified: true });
  assert.ok(harness.calls.activity.every((context) => context.serverPid === 13125));
  assert.deepEqual(harness.calls.quit, ["com.openai.codex"]);
  assert.deepEqual(harness.calls.reaped, [[200, 201]]);
  assert.equal(harness.calls.lock, 1);
  assert.equal(result.verification.after.hostPid, 14000);
  assert.equal(result.verification.after.pid, 14100);
  assert.deepEqual(result.verification.after.descriptors, { count: 40, highest: 52 });
  assert.equal(result.verification.guiPreserved, true);
  assert.equal(harness.state.get(8100).state, "present");
  assert.ok(result.warnings.some((warning) => warning.code === "desktop-launchd-maxfiles-low"));
});

test("desktop recycle waits for complete evidence before accepting the relaunched server", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const transient = desktopHarness({ incompleteRelaunchPolls: 2 });
  const recovered = recycleDesktop(desktopOptions({ confirmation: token }), transient.deps);
  assert.equal(recovered.exitCode, EXIT_CODES.healthy, JSON.stringify(recovered.result.verification.missingEvidence));
  assert.deepEqual(recovered.result.verification.after.descriptors, { count: 40, highest: 52 });

  const stuck = desktopHarness({ incompleteRelaunchPolls: Number.POSITIVE_INFINITY });
  const failed = recycleDesktop(desktopOptions({ confirmation: token }), stuck.deps);
  assert.notEqual(failed.exitCode, EXIT_CODES.healthy);
  assert.equal(failed.result.status, "failed");
  assert.equal(failed.result.verification.after, null);
});

test("desktop first pass refuses a descendant that reparented out of the server tree", () => {
  const harness = desktopHarness();
  const moved = harness.state.get(201).identity;
  harness.state.set(201, { state: "present", identity: { ...moved, parentPid: 1 } });
  const { result, exitCode } = recycleDesktop(desktopOptions(), harness.deps);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("snapshot-tree-changed"));
  assert.equal(result.verification.mutationAttempted, false);
});

test("desktop recycle reports the locked snapshot's selection when descendants churn", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness();
  const collect = harness.deps.collectInventory;
  let first = true;
  harness.deps.collectInventory = () => {
    const inventory = collect();
    if (!first) return inventory;
    first = false;
    // Descendant 201 exits between the first pass and the locked inventory.
    harness.state.set(201, { state: "absent" });
    return { ...inventory, processes: inventory.processes.filter((record) => record.pid !== 201) };
  };
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.deepEqual(harness.calls.reaped, [[200]]);
  assert.deepEqual(result.verification.receipt.selectedPids, [200, 13125]);
  assert.deepEqual(result.selected.map((item) => item.pid), [200, 13125]);
  assert.deepEqual(result.verification.before.targetPids, [200]);
});

test("desktop recycle refuses while Codex is busy or the app is in front", () => {
  const recent = { complete: true, latestActivityMs: NOW - 60_000, frontmostBundleId: "com.apple.Terminal" };
  const busy = recycleDesktop(desktopOptions(), desktopHarness({ activity: [recent] }).deps);
  assert.equal(busy.exitCode, EXIT_CODES.refused);
  assert.ok(busy.result.verification.missingEvidence.includes("desktop-busy"));
  assert.deepEqual(busy.result.verification.idle.reasons, ["codex-activity-recent"]);

  const front = { complete: true, latestActivityMs: NOW - 3_600_000, frontmostBundleId: "com.openai.codex" };
  const frontmost = recycleDesktop(desktopOptions(), desktopHarness({ activity: [front] }).deps);
  assert.deepEqual(frontmost.result.verification.idle.reasons, ["desktop-app-frontmost"]);

  const unknown = recycleDesktop(desktopOptions(), desktopHarness({ activity: [{ complete: false }] }).deps);
  assert.deepEqual(unknown.result.verification.idle.reasons, ["desktop-activity-unknown"]);

  const idle = recycleDesktop(desktopOptions(), desktopHarness().deps);
  assert.equal(idle.result.verification.idle.idle, true);
  assert.ok(idle.result.verification.missingEvidence.includes("confirmation-required"));
});

test("desktop recycle rechecks idleness under the lock and never quits a busy app", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const idle = { complete: true, latestActivityMs: NOW - 3_600_000, frontmostBundleId: "com.apple.Terminal" };
  const recent = { complete: true, latestActivityMs: NOW - 5_000, frontmostBundleId: "com.apple.Terminal" };
  const harness = desktopHarness({ activity: [idle, recent] });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("desktop-busy"));
  assert.equal(result.verification.mutationAttempted, false);
  assert.deepEqual(harness.calls.quit, []);
  assert.deepEqual(harness.calls.launch, []);
});

test("a recently started app-server child counts as activity", () => {
  const harness = desktopHarness();
  const child = harness.fixture.processes.find((record) => record.pid === 200);
  child.startTime = new Date(NOW - 30_000).toISOString();
  harness.state.set(200, { state: "present", identity: { ...harness.state.get(200).identity, startTime: child.startTime } });
  const { result } = recycleDesktop(desktopOptions(), harness.deps);
  assert.ok(result.verification.idle.reasons.includes("recent-app-server-child"));
});

test("desktop recycle accepts a replacement that reuses the old server PID with a new birth", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness({ relaunchServerPid: 13125 });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.equal(result.verification.after.pid, 13125);
});

test("desktop recycle never reports a replacement that already exited", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness({ replacementExits: true });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.notEqual(exitCode, EXIT_CODES.healthy);
  assert.equal(result.verification.after, null);
  assert.ok(result.verification.missingEvidence.includes("desktop-relaunch-timeout"));
});

test("a failed quit request is still reported as an attempted mutation", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness({ hostQuits: false, quitReportsOk: false });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.failed);
  assert.equal(result.verification.mutationAttempted, true);
  assert.ok(result.verification.missingEvidence.includes("desktop-quit-request-failed"));
  assert.deepEqual(harness.calls.launch, []);
});

test("desktop recycle never quits an app that restarted during the idle check", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness();
  const readActivity = harness.deps.readDesktopActivity;
  let calls = 0;
  harness.deps.readDesktopActivity = () => {
    calls += 1;
    // The locked idle check runs second; the app relaunches itself meanwhile.
    if (calls === 2) {
      const host = harness.state.get(13007).identity;
      harness.state.set(13007, { state: "present", identity: { ...host, startTime: "2026-08-02T16:00:30.000Z" } });
    }
    return readActivity();
  };
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("desktop-identity-changed"));
  assert.deepEqual(harness.calls.quit, []);
});

test("a child started while the locked idle probe ran still counts as busy", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness();
  const collect = harness.deps.collectInventory;
  let calls = 0;
  harness.deps.collectInventory = () => {
    const inventory = collect();
    calls += 1;
    if (calls < 2) return inventory;
    // The second read happens after the activity probe: a new turn spawned a child.
    return {
      ...inventory,
      processes: inventory.processes.concat(processRecord({
        pid: 300,
        parentPid: 13125,
        processGroupId: 300,
        startTime: new Date(NOW - 2_000).toISOString(),
        executable: "/bin/zsh",
        rawCommand: "/bin/zsh -lc make test",
      })),
    };
  };
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.idle.reasons.includes("recent-app-server-child"));
  assert.deepEqual(harness.calls.quit, []);
});

test("desktop recycle fails with a recovery code when the host app will not quit", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness({ hostQuits: false });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.ok(result.verification.missingEvidence.includes("desktop-host-quit-timeout"));
  assert.deepEqual(harness.calls.reaped, []);
  assert.deepEqual(harness.calls.launch, []);
  assert.equal(harness.state.get(13007).state, "present");
});

test("desktop recycle refuses non-GUI servers, drifted hosts, and conflicting flags", () => {
  const detached = recycleHarness();
  const desktopDeps = { ...desktopHarness().deps, inventory: detached.fixture, readIdentity: detached.deps.readIdentity };
  const wrongClass = recycleDesktop(desktopOptions({ pid: 500 }), desktopDeps);
  assert.equal(wrongClass.exitCode, EXIT_CODES.refused);
  assert.ok(wrongClass.result.verification.missingEvidence.includes("selected-server-not-gui"));

  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const drifted = desktopHarness();
  const host = drifted.fixture.processes.find((record) => record.pid === 13007);
  host.startTime = "2026-08-02T11:00:00.000Z";
  drifted.state.set(13007, { state: "present", identity: liveIdentity(host) });
  const mismatch = recycleDesktop(desktopOptions({ confirmation: token }), drifted.deps);
  assert.equal(mismatch.exitCode, EXIT_CODES.refused);
  assert.ok(mismatch.result.verification.missingEvidence.includes("confirmation-mismatch"));
  assert.deepEqual(drifted.calls.quit, []);

  assert.equal(parseCliArgs(["recycle", "--pid", "13125", "--desktop", "--unmanaged"]).error, "desktop-incompatible-arguments");
  assert.equal(parseCliArgs(["recycle", "--pid", "13125", "--desktop", "--nofile-attestor", "/x"]).error, "desktop-incompatible-arguments");
  assert.equal(parseCliArgs(["inspect", "--desktop"]).error, "recycle-argument-without-recycle");
  assert.equal(parseCliArgs(["recycle", "--pid", "13125", "--desktop"]).error, null);
});

test("launchd maxfiles below the minimum warns and inspect recommends a desktop recycle", () => {
  const high = recycleDesktop(desktopOptions(), desktopHarness({ limits: { soft: 65_536, hard: "unlimited" } }).deps);
  assert.ok(!high.result.warnings.some((warning) => warning.code === "desktop-launchd-maxfiles-low"));

  assert.deepEqual(readLaunchdMaxfiles(() => ({
    status: 0,
    stdout: "\tmaxfiles    256            unlimited      \n",
    stderr: "",
  })), { soft: 256, hard: "unlimited" });
  assert.equal(readLaunchdMaxfiles(() => ({ status: 1, stdout: "", stderr: "" })), null);

  const lines = [];
  const exitCode = runCli(["inspect", "--json"], {
    inventory: desktopInventoryFixture(),
    now: Date.parse("2026-08-02T16:00:00.000Z"),
    readLaunchdLimits: () => ({ soft: 256, hard: "unlimited" }),
    write: (text) => lines.push(text),
  });
  assert.equal(exitCode, EXIT_CODES.warning);
  const inspection = JSON.parse(lines[0]);
  assert.deepEqual(inspection.verification.launchdMaxfiles, { soft: 256, hard: "unlimited" });
  assert.deepEqual(inspection.recommendations.map((item) => item.code), [
    "desktop-recycle-recommended",
    "desktop-launchd-maxfiles-low",
  ]);
  assert.equal(inspection.recommendations[0].command, "recycle --pid 13125 --desktop");
  assert.deepEqual(desktopRecommendations(inspection, { soft: 65_536, hard: "unlimited" }).map((item) => item.code), [
    "desktop-recycle-recommended",
  ]);
});

test("a GUI server past launchd's soft limit is not treated as capped", () => {
  const fixture = desktopInventoryFixture();
  fixture.descriptors[13125] = { complete: true, count: 243, highest: 316 };
  const lines = [];
  runCli(["inspect", "--json"], {
    inventory: fixture,
    now: Date.parse("2026-08-02T16:00:00.000Z"),
    readLaunchdLimits: () => ({ soft: 256, hard: "unlimited" }),
    write: (text) => lines.push(text),
  });
  const inspection = JSON.parse(lines[0]);
  assert.ok(inspection.warnings.some((warning) => warning.code === "highest-fd-pressure"));
  assert.deepEqual(inspection.recommendations, []);

  const harness = desktopHarness();
  harness.deps.inventory.descriptors[13125] = { complete: true, count: 243, highest: 316 };
  const { result } = recycleDesktop(desktopOptions(), harness.deps);
  assert.ok(!result.warnings.some((warning) => warning.code === "desktop-launchd-maxfiles-low"));
});

test("default desktop adapters issue exact quit, relaunch, and bundle lookups", () => {
  const calls = [];
  const runner = (file, args) => {
    calls.push([file, ...args]);
    if (file === "/usr/bin/plutil") return { status: 0, stdout: "com.openai.codex\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const deps = createDefaultDesktopDependencies({ inventory: desktopInventoryFixture(), runner, uid: 501, lock: { acquire: () => () => {} } });

  assert.equal(deps.readBundleIdentifier("/Applications/ChatGPT.app"), "com.openai.codex");
  assert.deepEqual(deps.quitApp("com.openai.codex"), { ok: true });
  assert.deepEqual(deps.launchApp("/Applications/ChatGPT.app", "com.openai.codex"), { ok: true, by: "path" });
  assert.deepEqual(deps.quitApp('evil" to do shell script "x'), { ok: false });
  for (const bad of ["com.openai.codex", "-b", "/Applications/../tmp/ChatGPT.app", "/Applications/Other.app"]) {
    assert.deepEqual(deps.launchApp(bad, "com.openai.codex"), { ok: false, by: null });
  }
  assert.equal(deps.selfPid, process.pid);
  assert.deepEqual(calls, [
    ["/usr/bin/plutil", "-extract", "CFBundleIdentifier", "raw", "-o", "-", "/Applications/ChatGPT.app/Contents/Info.plist"],
    ["/usr/bin/osascript", "-e", 'tell application id "com.openai.codex" to quit'],
    ["/usr/bin/open", "-g", "/Applications/ChatGPT.app"],
  ]);
});

// A VS Code-hosted stdio app-server: detached ancestry without a control
// socket, so inspect calls it ambiguous. It is not the desktop recycle's.
function withEditorServer(fixture) {
  fixture.processes.push(
    processRecord({
      pid: 7000,
      parentPid: 1,
      processGroupId: 7000,
      executable: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
      rawCommand: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    }),
    processRecord({
      pid: 7100,
      parentPid: 7000,
      processGroupId: 7000,
      executable: "/Users/u/.vscode/extensions/openai.chatgpt/bin/codex",
      rawCommand: "/Users/u/.vscode/extensions/openai.chatgpt/bin/codex app-server",
    }),
  );
  fixture.descriptors[7100] = { complete: true, count: 20, highest: 30 };
  return fixture;
}

test("an unrelated ambiguous app-server does not block the pre-flight or the relaunch", () => {
  const first = desktopHarness();
  withEditorServer(first.fixture);
  first.state.set(7100, { state: "present", identity: liveIdentity(first.fixture.processes.find((item) => item.pid === 7100)) });
  const token = recycleDesktop(desktopOptions(), first.deps).result.verification.receipt?.confirmationToken;
  assert.ok(token, "pre-flight accepts the selected server's own complete evidence");

  const harness = desktopHarness({ relaunchedInventory: withEditorServer });
  const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.equal(result.verification.after.pid, 14100);
});

test("pre-flight and relaunch share one evidence-completeness rule", () => {
  assert.equal(desktopServerEvidenceGap({ missingEvidence: ["process-list-incomplete"] }), "inventory-incomplete");
  assert.equal(desktopServerEvidenceGap({ missingEvidence: [] }, { missingEvidence: ["file-descriptors"] }), "selected-server-ambiguous");
  assert.equal(desktopServerEvidenceGap({ missingEvidence: [] }, { missingEvidence: [] }), null);
  assert.equal(desktopServerEvidenceGap({ missingEvidence: [] }), null);
});

function confirmedDesktop(harnessOptions = {}) {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const harness = desktopHarness(harnessOptions);
  return { harness, ...recycleDesktop(desktopOptions({ confirmation: token }), harness.deps) };
}

test("once the app is gone the relaunch always runs, and later failures are reported beside it", () => {
  // The residue reap fails.
  {
    const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
    const harness = desktopHarness();
    harness.deps.reapResidue = () => {
      harness.calls.order.push("reap");
      return { exitCode: EXIT_CODES.failed, result: { verification: { missingEvidence: ["target-survived"] } } };
    };
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(harness.calls.order, ["watchdog", "quit", "launch", "reap"]);
    assert.ok(result.verification.missingEvidence.includes("target-survived"));
    assert.equal(result.verification.after.pid, 14100);
    assert.equal(result.verification.relaunch.verified, true);
  }
  // The old server outlives its host.
  {
    const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
    const harness = desktopHarness();
    const quit = harness.deps.quitApp;
    harness.deps.quitApp = (bundleId) => {
      const outcome = quit(bundleId);
      harness.state.set(13125, { state: "present", identity: liveIdentity(harness.fixture.processes.find((item) => item.pid === 13125)) });
      return outcome;
    };
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(harness.calls.launch, ["/Applications/ChatGPT.app"]);
    assert.ok(result.verification.missingEvidence.includes("desktop-server-survived-host"));
  }
  // The relaunch request fails: residue is still reaped and the failure named.
  {
    const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
    const harness = desktopHarness();
    harness.deps.launchApp = (bundlePath) => {
      harness.calls.launch.push(bundlePath);
      throw new Error("open failed");
    };
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(harness.calls.launch, ["/Applications/ChatGPT.app"]);
    assert.deepEqual(harness.calls.reaped, [[200, 201]]);
    assert.ok(result.verification.missingEvidence.includes("desktop-relaunch-failed"));
    assert.deepEqual(result.verification.relaunch, { attempted: true, requested: false, verified: false });
    assert.equal(result.verification.after, null);
  }
  // The host cannot be read after the quit: it is not shown running, so relaunch.
  {
    const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
    const harness = desktopHarness();
    const read = harness.deps.readIdentity;
    let quitSent = false;
    const quit = harness.deps.quitApp;
    harness.deps.quitApp = (bundleId) => {
      quitSent = true;
      return quit(bundleId);
    };
    harness.deps.readIdentity = (pid) => {
      if (quitSent && pid === 13007) throw new Error("ps failed");
      return read(pid);
    };
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(harness.calls.launch, ["/Applications/ChatGPT.app"]);
    assert.ok(result.verification.missingEvidence.includes("desktop-host-quit-unverified"));
  }
});

test("a relaunched server that reuses the old server PID is passed to the residue reap", () => {
  const { harness, exitCode, result } = confirmedDesktop({ relaunchServerPid: 13125 });
  assert.equal(exitCode, EXIT_CODES.healthy, JSON.stringify(result.verification.missingEvidence));
  assert.deepEqual(harness.calls.reapContext, {
    ownerReplacement: { pid: 13125, startTime: "2026-08-02T16:05:00.000Z" },
  });
});

test("desktop recycle refuses when its own process runs inside the app", () => {
  for (const [selfPid, extra, code] of [
    [201, null, "desktop-recycle-inside-app"],
    [9300, { pid: 9300, parentPid: 13007 }, "desktop-recycle-inside-app"],
    [424242, null, "desktop-self-ancestry-unknown"],
  ]) {
    const harness = desktopHarness();
    if (extra) {
      harness.fixture.processes.push(processRecord({
        ...extra,
        processGroupId: 9300,
        executable: "/bin/zsh",
        rawCommand: "/bin/zsh -l",
      }));
    }
    harness.deps.selfPid = selfPid;
    const { result, exitCode } = recycleDesktop(desktopOptions(), harness.deps);
    assert.equal(exitCode, EXIT_CODES.refused);
    assert.ok(result.verification.missingEvidence.includes(code), JSON.stringify(result.verification.missingEvidence));
    assert.equal(result.verification.mutationAttempted, false);
    assert.deepEqual(harness.calls.quit, []);
  }
});

test("desktop recycle refuses when another running app copy shares the bundle id", () => {
  const harness = desktopHarness({ bundleIds: { "/Applications/Codex.app": "com.openai.codex" } });
  const { result, exitCode } = recycleDesktop(desktopOptions(), harness.deps);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("desktop-bundle-id-ambiguous"));
});

test("the desktop activity reader is a required dependency", () => {
  const harness = desktopHarness();
  delete harness.deps.readDesktopActivity;
  const { result } = recycleDesktop(desktopOptions(), harness.deps);
  assert.deepEqual(result.verification.missingEvidence, ["desktop-evidence-unavailable"]);
});

test("a turn still open in the app keeps it busy and names its thread", () => {
  const openTurns = [{ threadId: "t-1", title: "Build the thing", since: new Date(NOW - 12 * 60_000).toISOString(), rollout: "/r" }];
  const silent = { complete: true, latestActivityMs: NOW - 12 * 60_000, openTurns, frontmostBundleId: "com.apple.Terminal" };
  const { result } = recycleDesktop(desktopOptions(), desktopHarness({ activity: [silent] }).deps);
  assert.deepEqual(result.verification.idle.reasons, ["desktop-turn-in-progress"]);
  assert.deepEqual(result.verification.idle.openTurns, openTurns);
  const lines = [];
  runCli(["recycle", "--pid", "13125", "--desktop"], {
    platform: "darwin",
    // The fixture's processes belong to uid 501, not to whoever runs the suite.
    uid: 501,
    inventory: desktopInventoryFixture(),
    desktopDependencies: desktopHarness({ activity: [silent] }).deps,
    now: NOW,
    write: (text) => lines.push(text),
  });
  assert.match(lines[0], /open turn in thread "Build the thing" \(t-1\) since .*finish, cancel or archive that thread in the app/);
  assert.deepEqual(desktopBusyReasons({
    activity: { complete: true, latestActivityMs: null },
    inventory: { processes: [] }, serverPid: 1, bundleId: "x", nowMs: NOW, idleMs: 1,
  }), ["desktop-activity-unknown"]);
});

// Fake runner and filesystem for the activity reader. The live desktop
// app-server holds only its logs and queue databases open; the state database
// is read from the same directory.
const HOME = "/Users/u/.codex";
const LIVE_LSOF = `p13125\nn${HOME}/logs_2.sqlite\nn${HOME}/logs_2.sqlite-wal\nn${HOME}/queue_1.sqlite\nn${HOME}/queue_1.sqlite-shm\n`;
const line = (type, payload, timestamp = "2026-08-02T15:00:00.000Z") => JSON.stringify({ timestamp, type, payload }) + "\n";
const CLOSED_TURN = line("session_meta", {}) + line("event_msg", { type: "task_started" })
  + line("response_item", { type: "function_call", call_id: "c1" })
  + line("response_item", { type: "function_call_output", call_id: "c1" })
  + line("event_msg", { type: "task_complete" });
const openTurn = (startedAt) => line("session_meta", {}) + line("event_msg", { type: "task_started" }, new Date(startedAt).toISOString())
  + line("response_item", { type: "custom_tool_call", call_id: "c2" });
const OPEN_TURN = openTurn(NOW - 40 * 60_000);
const desktopRow = (name, updated, extra = {}) => ({
  id: `id-${name}`, title: `thread ${name}`, rollout_path: `${HOME}/sessions/${name}.jsonl`, updated_at_ms: updated,
  originator: "Codex Desktop", source: "vscode", ...extra,
});

function activityFixture({
  lsof = LIVE_LSOF,
  homeFiles = ["logs_2.sqlite", "queue_1.sqlite", "state_4.sqlite", "state_5.sqlite", "state_5.sqlite-wal", "sessions"],
  rows = [desktopRow("a", NOW - 3_600_000), desktopRow("b", NOW - 7_200_000)],
  files = {
    [`${HOME}/sessions/a.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 3_000_000 },
    [`${HOME}/sessions/b.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 7_000_000 },
  },
  front = "ASN:0x0-0x4e94e9:\n",
  bundle = '"CFBundleIdentifier"="com.apple.Terminal"\n',
  sqliteStatus = 0,
} = {}) {
  const calls = [];
  const runner = (file, args) => {
    calls.push([file, ...args]);
    if (file === "/usr/sbin/lsof") return { status: lsof === null ? 1 : 0, stdout: lsof ?? "", stderr: "" };
    if (file === "/usr/bin/sqlite3") return { status: sqliteStatus, stdout: typeof rows === "string" ? rows : JSON.stringify(rows), stderr: "" };
    if (args[0] === "front") return { status: 0, stdout: front, stderr: "" };
    return { status: 0, stdout: bundle, stderr: "" };
  };
  const handles = new Map();
  const reads = [];
  const fsApi = {
    readdirSync(dir) {
      if (dir !== HOME || homeFiles === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return homeFiles;
    },
    statSync(file) {
      const entry = files[file];
      if (!entry) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { mtimeMs: entry.mtimeMs, size: Buffer.byteLength(entry.text) };
    },
    openSync(file) {
      reads.push(file);
      const fd = handles.size + 10;
      handles.set(fd, Buffer.from(files[file].text));
      return fd;
    },
    readSync(fd, buffer, offset, length, position) {
      return handles.get(fd).copy(buffer, offset, position, position + length);
    },
    closeSync(fd) {
      handles.delete(fd);
    },
  };
  return { calls, reads, read: () => readDesktopActivity({ runner, fsApi, serverPid: 13125, nowMs: NOW }) };
}

test("desktop activity reads the newest state database beside the server's open Codex databases", () => {
  // Thermos r2 #1: the live server holds only logs and queue open.
  const fixture = activityFixture();
  const activity = fixture.read();
  assert.equal(activity.complete, true, activity.unknown);
  assert.equal(activity.codexHome, HOME);
  assert.equal(activity.latestActivityMs, NOW - 3_000_000);
  assert.deepEqual(activity.openTurns, []);
  assert.equal(activity.frontmostBundleId, "com.apple.Terminal");
  assert.deepEqual(fixture.calls[0], ["/usr/sbin/lsof", "-nP", "-a", "-p", "13125", "-Fn"]);
  const query = fixture.calls.find((call) => call[0] === "/usr/bin/sqlite3");
  assert.equal(query[3], `file:${HOME}/state_5.sqlite?mode=ro`);
  assert.match(query[4], /SELECT id, title, rollout_path, updated_at_ms, originator, source FROM threads WHERE archived = 0/);
  // A state database the server does hold open wins.
  const held = activityFixture({ lsof: `${LIVE_LSOF}n${HOME}/state_4.sqlite\n` });
  held.read();
  assert.equal(held.calls.find((call) => call[0] === "/usr/bin/sqlite3")[3], `file:${HOME}/state_4.sqlite?mode=ro`);
});

test("only known non-desktop threads are left out of desktop activity", () => {
  assert.equal(countsAsDesktopThread({ originator: "Codex Desktop" }), true);
  assert.equal(countsAsDesktopThread({ originator: "codex_work_desktop" }), true);
  assert.equal(countsAsDesktopThread({ originator: "something-new" }), true);
  for (const originator of ["codex_exec", "codex_cli_rs", "codex_vscode"]) {
    assert.equal(countsAsDesktopThread({ originator, source: "vscode" }), false, originator);
  }
  for (const source of ["exec", "cli", "mcp", '{"subagent":"review"}']) {
    assert.equal(countsAsDesktopThread({ originator: null, source }), false, source);
  }
  // Desktop builds that recorded no originator used the vscode source.
  assert.equal(countsAsDesktopThread({ originator: null, source: "vscode" }), true);
  assert.equal(countsAsDesktopThread({ originator: null, source: "unknown" }), true);

  const quiet = activityFixture({
    rows: [desktopRow("x", NOW - 10_000, { originator: "codex_exec", source: "exec" }), desktopRow("a", NOW - 3_600_000)],
    files: {
      [`${HOME}/sessions/x.jsonl`]: { text: OPEN_TURN, mtimeMs: NOW - 10_000 },
      [`${HOME}/sessions/a.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 3_600_000 },
    },
  }).read();
  assert.equal(quiet.latestActivityMs, NOW - 3_600_000);
  assert.deepEqual(quiet.openTurns, []);
  const renamed = activityFixture({
    rows: [desktopRow("n", NOW - 10_000, { originator: "codex_work_desktop" }), desktopRow("a", NOW - 3_600_000)],
    files: {
      [`${HOME}/sessions/n.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 10_000 },
      [`${HOME}/sessions/a.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 3_600_000 },
    },
  }).read();
  assert.equal(renamed.latestActivityMs, NOW - 10_000);
});

test("desktop activity treats every unreadable or untied signal as unknown", () => {
  for (const [overrides, code] of [
    [{ lsof: null }, "codex-home-unknown"],
    [{ lsof: "p1\nn/tmp/other.txt\n" }, "codex-home-unknown"],
    [{ lsof: `n${HOME}/logs_2.sqlite\nn/Users/v/.codex/queue_1.sqlite\n` }, "codex-home-unknown"],
    [{ lsof: `${LIVE_LSOF}n${HOME}/state_4.sqlite\nn${HOME}/state_5.sqlite\n` }, "codex-home-unknown"],
    [{ homeFiles: ["logs_2.sqlite", "queue_1.sqlite"] }, "codex-state-unknown"],
    [{ homeFiles: null }, "codex-state-unknown"],
    [{ sqliteStatus: 1 }, "desktop-threads-unreadable"],
    [{ rows: "not json" }, "desktop-threads-unreadable"],
    [{ rows: [] }, "desktop-threads-none"],
    [{ rows: [desktopRow("x", NOW - 1, { originator: "codex_exec" })] }, "desktop-threads-none"],
    [{ rows: Array.from({ length: 500 }, (_, index) => desktopRow(`r${index}`, NOW - index)) }, "desktop-threads-too-many"],
    [{ rows: [desktopRow("a", null)] }, "desktop-thread-timestamp-invalid"],
    [{ rows: [desktopRow("a", NOW + 10 * 86_400_000)] }, "desktop-thread-timestamp-invalid"],
    [{ rows: [desktopRow("missing", NOW - 1)] }, "desktop-rollout-unreadable"],
    [{ files: { [`${HOME}/sessions/a.jsonl`]: { text: "{broken\n", mtimeMs: NOW - 1 }, [`${HOME}/sessions/b.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 2 } } }, "desktop-rollout-unreadable"],
    [{ front: "garbage" }, "frontmost-app-unknown"],
    [{ bundle: "no bundle here" }, "frontmost-app-unknown"],
  ]) {
    const activity = activityFixture(overrides).read();
    assert.equal(activity.complete, false, code);
    assert.equal(activity.unknown, code);
    assert.deepEqual(desktopBusyReasons({ activity, inventory: { processes: [] }, serverPid: 1, bundleId: "x", nowMs: NOW, idleMs: 1 }), [
      "desktop-activity-unknown",
    ]);
  }
  assert.equal(readDesktopActivity({ runner: () => assert.fail("no probe without a server"), serverPid: null }).unknown, "desktop-server-unidentified");
});

test("a missing rollout older than the window is ignored", () => {
  const activity = activityFixture({
    rows: [desktopRow("a", NOW - 3_600_000), desktopRow("gone", NOW - 3 * 86_400_000)],
  }).read();
  assert.equal(activity.complete, true, activity.unknown);
});

test("an open turn in any desktop thread active in the last day marks the app busy", () => {
  // Thermos r1 #1: thread A has sat inside a tool call for 40 minutes while
  // thread B finished 10 minutes ago.
  const fixture = activityFixture({
    rows: [desktopRow("b", NOW - 10 * 60_000), desktopRow("a", NOW - 40 * 60_000)],
    files: {
      [`${HOME}/sessions/b.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 10 * 60_000 },
      [`${HOME}/sessions/a.jsonl`]: { text: OPEN_TURN, mtimeMs: NOW - 40 * 60_000 },
    },
  });
  const activity = fixture.read();
  assert.equal(activity.complete, true, activity.unknown);
  assert.deepEqual(activity.openTurns, [{
    threadId: "id-a", title: "thread a", since: new Date(NOW - 40 * 60_000).toISOString(), rollout: `${HOME}/sessions/a.jsonl`,
  }]);
  assert.deepEqual(desktopBusyReasons({ activity, inventory: { processes: [] }, serverPid: 1, bundleId: "x", nowMs: NOW, idleMs: 300_000 }), [
    "desktop-turn-in-progress",
  ]);

  // Older than a day and past the newest threads: not read at all.
  const rows = [desktopRow("b", NOW - 60_000)];
  const files = { [`${HOME}/sessions/b.jsonl`]: { text: CLOSED_TURN, mtimeMs: NOW - 60_000 } };
  for (let index = 0; index < 25; index += 1) {
    rows.push(desktopRow(`old${index}`, NOW - 2 * 86_400_000 - index));
    files[`${HOME}/sessions/old${index}.jsonl`] = { text: OPEN_TURN, mtimeMs: NOW - 2 * 86_400_000 };
  }
  const old = activityFixture({ rows, files });
  assert.deepEqual(old.read().openTurns, []);
  assert.ok(!old.reads.includes(`${HOME}/sessions/old24.jsonl`));
});

test("a failed process list during the idle check counts as busy", () => {
  const activity = { complete: true, latestActivityMs: NOW - 600_000, openTurns: [], frontmostBundleId: "com.apple.Terminal" };
  for (const inventory of [{ collectionErrors: [{ code: "process-list-unavailable" }], processes: [] }, null]) {
    assert.deepEqual(desktopBusyReasons({ activity, inventory, serverPid: 13125, bundleId: "x", nowMs: NOW, idleMs: 300_000 }), [
      "desktop-process-list-unknown",
    ]);
  }
});

test("rollout turn state reads turns and tool calls from the tail", () => {
  const state = (text, options) => readTurn(text, options).state;
  assert.equal(state(CLOSED_TURN), "closed");
  assert.equal(state(OPEN_TURN), "open");
  assert.equal(readTurn(OPEN_TURN).openedAtMs, NOW - 40 * 60_000);
  assert.equal(state(line("event_msg", { type: "task_started" }) + line("event_msg", { type: "turn_aborted" })), "closed");
  assert.equal(state(CLOSED_TURN + line("response_item", { type: "function_call", call_id: "late" })), "open");
  assert.equal(state(line("session_meta", {}) + line("response_item", { type: "compaction" })), "closed");
  // A cut tail with no turn boundary cannot tell.
  assert.equal(state("cut-line\n" + line("response_item", { type: "message" }), { partial: true }), "unknown");
  // A line still being written means the rollout is being written.
  assert.equal(state(CLOSED_TURN + '{"type":"event_msg","pay'), "open");
  assert.equal(state(CLOSED_TURN + "{broken\n" + line("event_msg", { type: "task_complete" })), "unknown");
  assert.equal(state(null), "unknown");
});

test("the Codex home is the one directory of the server's open Codex databases", () => {
  assert.deepEqual(codexHomeFromOpenFiles(`n${HOME}/logs_2.sqlite\nn${HOME}/queue_1.sqlite-wal\n`), { home: HOME, openState: null });
  assert.deepEqual(codexHomeFromOpenFiles(`n${HOME}/state_6.sqlite-wal\nn${HOME}/logs_2.sqlite\n`), {
    home: HOME,
    openState: `${HOME}/state_6.sqlite`,
  });
  assert.equal(codexHomeFromOpenFiles(`n${HOME}/state_5.sqlite\nn${HOME}/state_6.sqlite\n`), null);
  assert.equal(codexHomeFromOpenFiles(`n${HOME}/logs_2.sqlite\nn/other/queue_1.sqlite\n`), null);
  assert.equal(codexHomeFromOpenFiles(""), null);
  const fsApi = (names) => ({ readdirSync: () => names });
  assert.equal(stateDatabaseIn({ home: HOME, openState: null }, fsApi(["state_4.sqlite", "state_12.sqlite", "state_5.sqlite"])), `${HOME}/state_12.sqlite`);
  assert.equal(stateDatabaseIn({ home: HOME, openState: null }, fsApi(["logs_2.sqlite"])), null);
  assert.equal(stateDatabaseIn({ home: "/tmp/odd?dir", openState: null }, fsApi(["state_5.sqlite"])), null);
});

// The detached relaunch watchdog, driven with fakes.
function watchdogFakes({ hostGoneAfter = 2, running = false, identityThrows = false } = {}) {
  let clock = 0;
  let polls = 0;
  const launched = [];
  return {
    launched,
    deps: {
      readIdentity(pid) {
        if (identityThrows) throw new Error("ps failed");
        polls += 1;
        return polls > hostGoneAfter
          ? { state: "absent" }
          : { state: "present", identity: exactIdentity({ pid, startTime: "2026-08-02T10:00:00.000Z" }) };
      },
      isRunning: () => running,
      launch: (target) => {
        launched.push(target);
        return { ok: true };
      },
      sleep: (ms) => { clock += ms; },
      now: () => clock,
    },
  };
}
const WATCH = { hostPid: 13007, hostStartTime: "2026-08-02T10:00:00.000Z", bundlePath: "/Applications/ChatGPT.app", bundleId: "com.openai.codex" };

test("the relaunch watchdog reopens the app only when nothing else did", () => {
  const closed = watchdogFakes();
  assert.equal(runRelaunchWatchdog(WATCH, closed.deps), "relaunched");
  assert.deepEqual(closed.launched, [{ bundlePath: "/Applications/ChatGPT.app", bundleId: "com.openai.codex" }]);

  const reopened = watchdogFakes({ running: true });
  assert.equal(runRelaunchWatchdog(WATCH, reopened.deps), "already-running");
  assert.deepEqual(reopened.launched, []);

  const stays = watchdogFakes({ hostGoneAfter: Number.POSITIVE_INFINITY });
  assert.equal(runRelaunchWatchdog(WATCH, stays.deps), "host-still-running");
  assert.deepEqual(stays.launched, []);

  const unreadable = watchdogFakes({ identityThrows: true });
  assert.equal(runRelaunchWatchdog(WATCH, unreadable.deps), "host-still-running");
  assert.deepEqual(unreadable.launched, []);

  assert.equal(runRelaunchWatchdog({ ...WATCH, bundlePath: "/Applications/../x/ChatGPT.app" }, closed.deps), "invalid-arguments");
});

test("every relaunch opens the exact bundle in the background, falling back to its bundle id", () => {
  const calls = [];
  const runner = (failPath) => (file, args) => {
    calls.push([file, ...args]);
    return { status: failPath && args.includes("/Applications/ChatGPT.app") ? 1 : 0, stdout: "", stderr: "" };
  };
  assert.deepEqual(launchBundle(runner(false), WATCH), { ok: true, by: "path" });
  assert.deepEqual(launchBundle(runner(true), WATCH), { ok: true, by: "bundle-id" });
  assert.deepEqual(launchBundle(runner(false), { ...WATCH, bundlePath: "relative/ChatGPT.app" }), { ok: false, by: null });
  assert.deepEqual(calls, [
    ["/usr/bin/open", "-g", "/Applications/ChatGPT.app"],
    ["/usr/bin/open", "-g", "/Applications/ChatGPT.app"],
    ["/usr/bin/open", "-g", "-b", "com.openai.codex"],
  ]);
  // The watchdog's own launcher is the same function.
  const watchdogCalls = [];
  const deps = defaultWatchdogDeps((file, args) => {
    watchdogCalls.push([file, ...args]);
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.deepEqual(deps.launch(WATCH), { ok: true, by: "path" });
  assert.deepEqual(watchdogCalls, [["/usr/bin/open", "-g", "/Applications/ChatGPT.app"]]);
});

test("the relaunch watchdog is spawned detached and can be disarmed", () => {
  const spawned = [];
  const child = { pid: 777, unref() { this.unrefed = true; }, on() {}, kill(signal) { this.killed = signal; } };
  const armed = armRelaunchWatchdog(WATCH, {
    spawnProcess: (file, args, options) => {
      spawned.push({ file, args, options });
      return child;
    },
    execPath: "/usr/local/bin/node",
  });
  assert.equal(armed.ok, true);
  assert.equal(armed.pid, 777);
  assert.equal(child.unrefed, true);
  assert.equal(spawned[0].file, "/usr/local/bin/node");
  assert.match(spawned[0].args[0], /desktop-watchdog\.mjs$/);
  assert.deepEqual(JSON.parse(spawned[0].args[1]), WATCH);
  assert.deepEqual(spawned[0].options, { detached: true, stdio: "ignore" });
  armed.disarm();
  assert.equal(child.killed, "SIGTERM");
  assert.deepEqual(armRelaunchWatchdog({ ...WATCH, bundlePath: "relative/ChatGPT.app" }, { spawnProcess: () => assert.fail() }), { ok: false });
  const ps = (stdout) => () => ({ status: 0, stdout });
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("  501 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n"), 501), true);
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("501 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --flag\n"), 501), true);
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("501 /Applications/Codex.app/Contents/MacOS/Codex\n"), 501), false);
  // A helper beside the main executable is not the app.
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("501 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT-helper\n"), 501), false);
  // Another user's copy does not stand in for this user's app.
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("502 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n"), 501), false);
  assert.equal(bundleRunning("/Applications/ChatGPT.app", () => ({ status: 1, stdout: "" }), 501), null);
  assert.equal(bundleRunning("/Applications/ChatGPT.app", ps("501 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n"), null), null);
});

test("the CLI hands its process spawner to the desktop watchdog", () => {
  const spawned = [];
  const deps = createDefaultDesktopDependencies({
    inventory: desktopInventoryFixture(), runner: () => ({ status: 0, stdout: "", stderr: "" }), uid: 501,
    lock: { acquire: () => () => {} },
    spawnProcess: (file, args, options) => {
      spawned.push(options);
      return { pid: 5, unref() {}, on() {} };
    },
  });
  assert.equal(deps.armRelaunchWatchdog(WATCH).ok, true);
  assert.deepEqual(spawned, [{ detached: true, stdio: "ignore" }]);
});

test("the watchdog is armed before the quit, and a recycle refuses without one", () => {
  const { harness, result } = confirmedDesktop();
  assert.deepEqual(harness.calls.order.slice(0, 2), ["watchdog", "quit"]);
  assert.deepEqual(harness.calls.watchdog, [WATCH]);
  assert.deepEqual(result.verification.watchdog, { armed: true, pid: 4242 });

  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const unarmed = desktopHarness();
  unarmed.deps.armRelaunchWatchdog = () => ({ ok: false });
  const refusedRun = recycleDesktop(desktopOptions({ confirmation: token }), unarmed.deps);
  assert.equal(refusedRun.exitCode, EXIT_CODES.refused);
  assert.ok(refusedRun.result.verification.missingEvidence.includes("desktop-watchdog-unavailable"));
  assert.equal(refusedRun.result.verification.mutationAttempted, false);
  assert.deepEqual(unarmed.calls.quit, []);
});

test("an exception after the quit still relaunches the app and is reported", () => {
  for (const [failing, launches] of [["monotonicNow", 1], ["sleep", 1]]) {
    const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
    const harness = desktopHarness({ incompleteRelaunchPolls: Number.POSITIVE_INFINITY });
    let quitSent = false;
    const quit = harness.deps.quitApp;
    harness.deps.quitApp = (bundleId) => {
      quitSent = true;
      return quit(bundleId);
    };
    const original = harness.deps[failing];
    harness.deps[failing] = (...args) => {
      if (quitSent) throw new Error(`${failing} failed`);
      return original(...args);
    };
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed, failing);
    assert.equal(harness.calls.launch.length, launches, failing);
    assert.ok(result.verification.missingEvidence.includes("desktop-recycle-evidence-failed"), failing);
  }
});

test("a quit that does not land swaps the long watchdog for a short one", () => {
  for (const quitReportsOk of [true, false]) {
    const { harness, result, exitCode } = confirmedDesktop({ hostQuits: false, quitReportsOk });
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(harness.calls.launch, []);
    // The short watchdog runs before the long one is stopped.
    assert.deepEqual(harness.calls.order, ["watchdog", "quit", "watchdog", "disarm"]);
    assert.deepEqual(harness.calls.watchdog, [WATCH, { ...WATCH, timeoutMs: 60_000 }]);
    assert.equal(result.verification.watchdog.lateQuitMs, 60_000);
    assert.ok(result.warnings.some((warning) => warning.code === "desktop-quit-may-still-land" && /60 seconds/.test(warning.message)));
  }
});

test("a short watchdog that cannot start leaves the long one armed", () => {
  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  for (const failure of [() => ({ ok: false }), () => { throw new Error("spawn failed"); }]) {
    const harness = desktopHarness({ hostQuits: false });
    const arm = harness.deps.armRelaunchWatchdog;
    harness.deps.armRelaunchWatchdog = (args) => (harness.calls.watchdog.length ? failure() : arm(args));
    const { result, exitCode } = recycleDesktop(desktopOptions({ confirmation: token }), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.ok(!harness.calls.order.includes("disarm"), JSON.stringify(harness.calls.order));
    assert.deepEqual(result.verification.watchdog, { armed: true, pid: 4242, lateQuitArmFailed: true });
    assert.ok(result.warnings.some((warning) => warning.code === "desktop-quit-may-still-land" && /stays armed/.test(warning.message)));
  }
});

test("the relaunch path is checked before anything is quit", () => {
  const harness = desktopHarness();
  const host = harness.state.get(13007).identity;
  // A bundle path the relaunch would refuse, bound into the receipt.
  const moved = { ...host, executable: "/Applications/./ChatGPT.app/Contents/MacOS/ChatGPT" };
  harness.fixture.processes.find((record) => record.pid === 13007).executable = moved.executable;
  harness.state.set(13007, { state: "present", identity: moved });
  harness.deps.readBundleIdentifier = (bundlePath) => (bundlePath.includes("ChatGPT") ? "com.openai.codex" : "com.openai.codex-app");
  const first = recycleDesktop(desktopOptions(), harness.deps).result.verification.receipt.confirmationToken;
  const { result } = recycleDesktop(desktopOptions({ confirmation: first }), harness.deps);
  assert.ok(result.verification.missingEvidence.includes("desktop-relaunch-path-invalid"), JSON.stringify(result.verification.missingEvidence));
  assert.deepEqual(harness.calls.quit, []);
});
