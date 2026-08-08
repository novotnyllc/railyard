import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  createDefaultRecycleDependencies,
  recycleConfirmationToken,
  recycleServer,
  runCli,
} from "./cleanup-codex.mjs";

import {
  ATTESTOR,
  LAUNCHER,
  RECYCLE_SOCKET,
  addApplicableParent,
  confirmedRecycleOptions,
  daemonSample,
  exactIdentity,
  inventory,
  liveIdentity,
  parentBoundOptions,
  processRecord,
  recycleHarness,
  recycleInventoryFixture,
  recycleOptions,
  snapshotFixture,
} from "./test-support.mjs";

test("recycle rejects GUI, editor, and ambiguous selections", () => {
  const gui = recycleHarness();
  assert.equal(recycleServer(recycleOptions({ pid: 101 }), gui.deps).exitCode, EXIT_CODES.refused);
  assert.equal(recycleServer(recycleOptions({ pid: 10 }), recycleHarness().deps).exitCode, EXIT_CODES.refused);

  const ambiguous = recycleHarness();
  const server = ambiguous.fixture.processes.find((item) => item.pid === 500);
  server.rawCommand = "/usr/local/bin/codex app-server";
  ambiguous.fixture.controlSockets.items = ambiguous.fixture.controlSockets.items.filter((item) => item.ownerPid !== 500);
  assert.equal(recycleServer(recycleOptions(), ambiguous.deps).exitCode, EXIT_CODES.refused);
  assert.equal(ambiguous.calls.restart, 0);
});

test("recycle receipt names the exact tree and requires its confirmation token", () => {
  const harness = recycleHarness();
  const { result, exitCode } = recycleServer(recycleOptions({ confirmation: null }), harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.verification.receipt.selectedPids, [500, 501, 600]);
  const { confirmationToken, digest, ...receiptCore } = result.verification.receipt;
  assert.equal(confirmationToken, recycleConfirmationToken(receiptCore));
  assert.equal(digest, confirmationToken.slice("RECYCLE ".length));
  assert.equal(result.verification.mutationAttempted, false);
  assert.doesNotMatch(JSON.stringify(result), /SHOULD_NOT_LEAK|PROXY_SECRET|prompt|--token/);
  assert.equal(harness.calls.samples, 2);
});

test("unclassified proxy and reused proxy identity refuse before mutation", () => {
  const unclassified = recycleHarness();
  unclassified.fixture.processes.push(processRecord({
    pid: 602,
    parentPid: 60,
    processGroupId: 602,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server proxy",
  }));
  unclassified.fixture.proxySockets[602] = { complete: false, paths: [] };
  assert.equal(recycleServer(recycleOptions(), unclassified.deps).exitCode, EXIT_CODES.refused);
  assert.equal(unclassified.calls.restart, 0);

  const reused = recycleHarness();
  const originalRead = reused.deps.readIdentity;
  reused.deps.readIdentity = (pid) => pid === 600
    ? { state: "present", identity: liveIdentity(reused.fixture.processes.find((item) => item.pid === 600), {
        startTime: "2026-08-02T15:01:00.000Z",
      }) }
    : originalRead(pid);
  assert.equal(recycleServer(recycleOptions(), reused.deps).exitCode, EXIT_CODES.refused);
  assert.equal(reused.calls.restart, 0);
});

test("managed recycle requires four stable exact pre-mutation samples and never signals the server", () => {
  const harness = recycleHarness();
  const { result, exitCode } = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(harness.calls.samples, 5);
  assert.ok(harness.calls.sampleContexts.every((context) => (
    context.socket === RECYCLE_SOCKET
    && context.executable.path === "/usr/local/bin/codex"
  )));
  assert.equal(harness.calls.restart, 1);
  assert.equal(harness.calls.stop, 0);
  assert.equal(harness.calls.residue, 1);
  assert.deepEqual(harness.calls.attest, [500, 500, 900]);
  assert.equal(result.verification.after.pid, 900);
  assert.deepEqual(result.verification.after.descriptors, { count: 122, highest: 145 });
  assert.equal(result.verification.after.directChildren, 19);
  assert.equal(result.verification.guiPreserved, true);
  assert.equal(harness.calls.readyContext.mode, "managed");
  assert.equal(harness.calls.readyContext.executable, "/usr/local/bin/codex");
});

test("managed recycle fails closed without a receipt-bound native compare-and-swap", () => {
  const harness = recycleHarness();
  delete harness.deps.restartManagedExact;

  const { result, exitCode } = recycleServer(recycleOptions(), harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.verification.mutationAttempted, false);
  assert.ok(result.verification.receipt);
  assert.ok(result.verification.missingEvidence.includes("managed-restart-exact-pid-unsupported"));
  assert.equal(harness.calls.restart, 0);
});

test("missing or conflicting managed evidence never falls through to unmanaged signaling", () => {
  const missing = recycleHarness({
    sampleOverrides: [
      daemonSample(recycleInventoryFixture(), null),
      daemonSample(recycleInventoryFixture(), null),
    ],
  });
  assert.equal(recycleServer(recycleOptions(), missing.deps).exitCode, EXIT_CODES.refused);
  assert.equal(missing.calls.restart, 0);
  assert.equal(missing.calls.stop, 0);

  const conflictingFixture = recycleInventoryFixture();
  const first = daemonSample(conflictingFixture);
  const second = daemonSample(conflictingFixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  const conflicting = recycleHarness({ sampleOverrides: [first, second] });
  assert.equal(recycleServer(recycleOptions(), conflicting.deps).exitCode, EXIT_CODES.refused);
  assert.equal(conflicting.calls.restart, 0);
  assert.equal(conflicting.calls.stop, 0);
});

test("attestor absence and mismatched old-PID attestation refuse before mutation", () => {
  const absent = recycleHarness();
  assert.equal(recycleServer({ ...confirmedRecycleOptions(), attestorPath: null }, absent.deps).exitCode, EXIT_CODES.refused);
  assert.equal(absent.calls.restart, 0);

  const invalid = recycleHarness();
  invalid.deps.attestNofile = (identity) => ({
    schema: "codex-nofile-attestation-v1",
    pid: identity.pid + 1,
    uid: identity.uid,
    processStartTime: identity.startTime,
    softNofile: 8192,
  });
  assert.equal(recycleServer(recycleOptions({ confirmation: "unused" }), invalid.deps).exitCode, EXIT_CODES.refused);
  assert.equal(invalid.calls.restart, 0);
});

test("an old process below the recovery minimum may recycle when replacement attestation meets it", () => {
  const harness = recycleHarness({ oldSoftNofile: 256 });

  const { result, exitCode } = recycleServer(
    confirmedRecycleOptions({}, { oldSoftNofile: 256 }),
    harness.deps,
  );

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.verification.before.softNofile, 256);
  assert.equal(result.verification.after.softNofile, 8192);
});

test("explicit unmanaged recycle validates launcher limit and uses only the selected launcher", () => {
  const harness = recycleHarness({ mode: "unmanaged" });
  const options = confirmedRecycleOptions({
    unmanaged: true,
    launcher: LAUNCHER,
  });
  const { result, exitCode } = recycleServer(options, harness.deps);

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(harness.calls.restart, 0);
  assert.equal(harness.calls.stop, 1);
  assert.equal(harness.calls.launch, 1);
  assert.deepEqual(harness.calls.attestLauncher, [LAUNCHER, LAUNCHER]);
  assert.equal(result.verification.mode, "unmanaged");

  const low = recycleHarness({ mode: "unmanaged" });
  low.deps.attestLauncher = (launcher) => ({
    schema: "codex-launcher-nofile-attestation-v1",
    path: launcher.path,
    dev: launcher.dev,
    ino: launcher.ino,
    replacementExecutable: "/usr/local/bin/codex",
    softNofile: 4096,
  });
  assert.equal(recycleServer(options, low.deps).exitCode, EXIT_CODES.refused);
  assert.equal(low.calls.stop, 0);
  assert.equal(low.calls.launch, 0);

  const linkedLauncher = "/usr/local/bin/codex-link";
  const linkedHarness = () => {
    const candidate = recycleHarness({ mode: "unmanaged" });
    const canonicalPath = candidate.deps.canonicalPath;
    candidate.deps.canonicalPath = (value) => value === linkedLauncher
      ? LAUNCHER
      : canonicalPath(value);
    return candidate;
  };
  const probe = linkedHarness();
  const linkedOptions = recycleOptions({
    unmanaged: true,
    launcher: linkedLauncher,
  });
  const probeOutcome = recycleServer(linkedOptions, probe.deps);
  const linked = linkedHarness();
  const linkedOutcome = recycleServer({
    ...linkedOptions,
    confirmation: probeOutcome.result.verification.receipt.confirmationToken,
  }, linked.deps);
  assert.equal(linkedOutcome.exitCode, EXIT_CODES.healthy);
  assert.equal(linkedOutcome.result.verification.receipt.launcher.path, LAUNCHER);
});

test("attempted restart, readiness, socket, and replacement attestation failures preserve exact reasons", () => {
  const cases = [
    {
      expected: "managed-restart-failed",
      configure: (harness) => { harness.deps.restartManagedExact = () => { throw new Error("restart failed"); }; },
    },
    {
      expected: "replacement-readiness-timeout",
      configure: (harness) => { harness.deps.waitForReady = () => null; },
    },
    {
      expected: "replacement-socket-invalid",
      configure: (harness) => {
        harness.deps.waitForReady = () => ({
          identity: harness.replacement,
          socket: { path: RECYCLE_SOCKET, ready: true, owners: [] },
          descriptors: { count: 10, highest: 12 },
          directChildren: 1,
        });
      },
    },
    {
      expected: "pid-nofile-attestation-invalid",
      configure: (harness) => {
        const original = harness.deps.attestNofile;
        harness.deps.attestNofile = (identity) => identity.pid === 900
          ? { schema: "codex-nofile-attestation-v1", pid: 900, uid: 501, processStartTime: identity.startTime, softNofile: 4096 }
          : original(identity);
      },
    },
  ];

  for (const { configure, expected } of cases) {
    const harness = recycleHarness();
    configure(harness);
    const { result, exitCode } = recycleServer(confirmedRecycleOptions(), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.equal(result.verification.complete, false);
    assert.equal(result.verification.mutationAttempted, true);
    assert.ok(result.verification.missingEvidence.includes(expected));
  }
});

test("post-mutation recovery evidence preserves exact readiness and residue failures", () => {
  const readiness = recycleHarness();
  readiness.deps.waitForReady = () => ({ failureCode: "replacement-socket-ownership-mismatch" });
  const readinessOutcome = recycleServer(confirmedRecycleOptions(), readiness.deps);
  assert.equal(readinessOutcome.exitCode, EXIT_CODES.failed);
  assert.ok(readinessOutcome.result.verification.missingEvidence.includes(
    "replacement-socket-ownership-mismatch",
  ));

  const residue = recycleHarness();
  residue.deps.reapResidue = () => ({
    exitCode: EXIT_CODES.failed,
    result: { verification: { missingEvidence: ["post-kill-survivor"] } },
  });
  const residueOutcome = recycleServer(confirmedRecycleOptions(), residue.deps);
  assert.equal(residueOutcome.exitCode, EXIT_CODES.failed);
  assert.ok(residueOutcome.result.verification.missingEvidence.includes("post-kill-survivor"));
});

test("post-verification requires old tree absence and GUI preservation", () => {
  const residue = recycleHarness();
  residue.deps.reapResidue = () => {
    residue.calls.residue += 1;
    return { exitCode: EXIT_CODES.healthy };
  };
  assert.equal(recycleServer(confirmedRecycleOptions(), residue.deps).exitCode, EXIT_CODES.failed);

  const gui = recycleHarness();
  const originalRestart = gui.deps.restartManagedExact;
  gui.deps.restartManagedExact = () => {
    const response = originalRestart();
    const oldGui = gui.state.get(101).identity;
    gui.state.set(101, { state: "present", identity: { ...oldGui, startTime: "2026-08-02T15:01:00.000Z" } });
    return response;
  };
  assert.equal(recycleServer(confirmedRecycleOptions(), gui.deps).exitCode, EXIT_CODES.failed);
});

test("CLI routes recycle through the guarded dependency surface", () => {
  const harness = recycleHarness();
  const options = confirmedRecycleOptions();
  const output = [];

  const exitCode = runCli([
    "recycle",
    "--pid", String(options.pid),
    "--confirm", options.confirmation,
    "--nofile-attestor", ATTESTOR,
    "--json",
  ], {
    platform: "darwin",
    uid: 501,
    inventory: harness.fixture,
    readIdentity: harness.deps.readIdentity,
    recycleDependencies: harness.deps,
    env: {},
    write: (value) => output.push(value),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(JSON.parse(output[0]).action, "recycle");
  assert.equal(harness.calls.restart, 1);
});

test("CLI receipt pass binds the attestor and minimum before confirmation", () => {
  const harness = recycleHarness();
  const output = [];

  const exitCode = runCli([
    "recycle",
    "--pid", "500",
    "--nofile-attestor", ATTESTOR,
    "--json",
  ], {
    platform: "darwin",
    uid: 501,
    inventory: harness.fixture,
    readIdentity: harness.deps.readIdentity,
    recycleDependencies: harness.deps,
    env: {},
    write: (value) => output.push(value),
  });

  const result = JSON.parse(output[0]);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.verification.missingEvidence, ["confirmation-required"]);
  assert.equal(result.verification.receipt.minimumSoftNofile, 8192);
  assert.equal(result.verification.receipt.attestor.path, ATTESTOR);
  assert.equal(result.verification.mutationAttempted, false);
});

test("confirmation token cannot authorize a different minimum", () => {
  const harness = recycleHarness();
  const options = confirmedRecycleOptions();
  const { result, exitCode } = recycleServer({ ...options, minSoftLimit: 16384 }, harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("confirmation-mismatch"));
  assert.equal(harness.calls.restart, 0);
});

test("recycle refuses when any app-server classification is incomplete", () => {
  const ambiguousServer = processRecord({
    pid: 700,
    parentPid: 70,
    processGroupId: 700,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server",
  });
  const initial = recycleHarness();
  initial.fixture.processes.push(
    processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
    ambiguousServer,
  );
  initial.fixture.descriptors[700] = { complete: true, count: 8, highest: 9 };

  const initialOutcome = recycleServer(recycleOptions(), initial.deps);
  assert.equal(initialOutcome.exitCode, EXIT_CODES.refused);
  assert.deepEqual(initialOutcome.result.verification.missingEvidence, ["inventory-incomplete"]);
  assert.equal(initial.calls.samples, 0);

  const locked = recycleHarness();
  const lockedInventory = structuredClone(locked.fixture);
  lockedInventory.processes.push(
    processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
    ambiguousServer,
  );
  lockedInventory.descriptors[700] = { complete: true, count: 8, highest: 9 };
  locked.deps.collectInventory = () => lockedInventory;

  const lockedOutcome = recycleServer(confirmedRecycleOptions(), locked.deps);
  assert.equal(lockedOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(lockedOutcome.result.verification.missingEvidence.includes("inventory-recheck-incomplete"));
  assert.equal(locked.calls.restart, 0);

  const reclassified = recycleHarness();
  const reclassifiedInventory = structuredClone(reclassified.fixture);
  reclassifiedInventory.processes.find((item) => item.pid === 500).parentPid = 10;
  reclassified.deps.collectInventory = () => reclassifiedInventory;

  const reclassifiedOutcome = recycleServer(confirmedRecycleOptions(), reclassified.deps);
  assert.equal(reclassifiedOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(reclassifiedOutcome.result.verification.missingEvidence.includes(
    "selected-server-recheck-incomplete",
  ));
  assert.equal(reclassified.calls.restart, 0);
});

test("late proxy and GUI drift refuse under the mutation lock", () => {
  const proxy = recycleHarness();
  const lateInventory = structuredClone(proxy.fixture);
  lateInventory.processes.push(processRecord({
    pid: 602,
    parentPid: 60,
    processGroupId: 602,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server proxy",
  }));
  lateInventory.proxySockets[602] = {
    complete: true,
    paths: [RECYCLE_SOCKET],
    connections: [{ endpoint: "0x602", peerEndpoint: "0x500" }],
  };
  proxy.deps.collectInventory = () => lateInventory;
  const proxyOutcome = recycleServer(confirmedRecycleOptions(), proxy.deps);
  assert.equal(proxyOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(proxyOutcome.result.verification.missingEvidence.includes("proxy-set-changed"));
  assert.equal(proxy.calls.restart, 0);

  const gui = recycleHarness();
  gui.deps.lock.acquire = () => {
    const baseline = gui.state.get(101).identity;
    gui.state.set(101, {
      state: "present",
      identity: { ...baseline, startTime: "2026-08-02T15:01:00.000Z" },
    });
    return () => {};
  };
  const guiOutcome = recycleServer(confirmedRecycleOptions(), gui.deps);
  assert.equal(guiOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(guiOutcome.result.verification.missingEvidence.includes("gui-preservation-failed"));
  assert.equal(gui.calls.restart, 0);
});

test("a descendant that joins after confirmation refuses under the mutation lock", () => {
  const harness = recycleHarness();
  const lateInventory = structuredClone(harness.fixture);
  lateInventory.processes.push(processRecord({
    pid: 502,
    parentPid: 500,
    processGroupId: 500,
    executable: "/usr/bin/true",
    rawCommand: "/usr/bin/true",
  }));
  harness.deps.collectInventory = () => lateInventory;

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("exact-tree-changed"));
  assert.equal(harness.calls.restart, 0);
});

test("a descendant that joins during locked attestation refuses before mutation", () => {
  const harness = recycleHarness();
  const lateInventory = structuredClone(harness.fixture);
  lateInventory.processes.push(processRecord({
    pid: 502,
    parentPid: 500,
    processGroupId: 500,
    executable: "/usr/bin/true",
    rawCommand: "/usr/bin/true",
  }));
  const attestNofile = harness.deps.attestNofile;
  let attestations = 0;
  harness.deps.attestNofile = (...args) => {
    const attestation = attestNofile(...args);
    attestations += 1;
    if (attestations === 2) harness.deps.collectInventory = () => lateInventory;
    return attestation;
  };

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("exact-tree-changed"));
  assert.equal(harness.calls.restart, 0);
});

test("locked daemon drift and executable replacement refuse before mutation", () => {
  const daemon = recycleHarness();
  const base = daemonSample(daemon.fixture);
  const drift = daemonSample(daemon.fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  let sample = 0;
  daemon.deps.sampleDaemonEvidence = () => structuredClone([base, base, drift][Math.min(sample++, 2)]);
  const daemonOutcome = recycleServer(confirmedRecycleOptions(), daemon.deps);
  assert.equal(daemonOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(daemon.calls.restart, 0);

  const executable = recycleHarness();
  const originalFileIdentity = executable.deps.fileIdentity;
  let changed = false;
  executable.deps.fileIdentity = (value) => {
    const evidence = originalFileIdentity(value);
    return changed && value === ATTESTOR ? { ...evidence, digest: "d".repeat(64) } : evidence;
  };
  executable.deps.lock.acquire = () => {
    changed = true;
    return () => {};
  };
  const executableOutcome = recycleServer(confirmedRecycleOptions(), executable.deps);
  assert.equal(executableOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(executableOutcome.result.verification.missingEvidence.includes("nofile-attestor-changed"));
  assert.equal(executable.calls.restart, 0);
});

test("daemon drift in the immediate pre-mutation sample refuses", () => {
  const fixture = recycleInventoryFixture();
  const base = daemonSample(fixture);
  const drift = daemonSample(fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  const harness = recycleHarness({ sampleOverrides: [base, base, base, drift] });

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("daemon-socket-ownership-conflict"));
  assert.equal(harness.calls.samples, 4);
  assert.equal(harness.calls.restart, 0);
});

test("daemon drift during locked inventory refuses before mutation", () => {
  const harness = recycleHarness();
  const base = daemonSample(harness.fixture);
  const drift = daemonSample(harness.fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  let inventoryCollected = false;
  harness.deps.sampleDaemonEvidence = () => structuredClone(inventoryCollected ? drift : base);
  harness.deps.collectInventory = () => {
    inventoryCollected = true;
    return harness.fixture;
  };

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("daemon-socket-ownership-conflict"));
  assert.equal(harness.calls.restart, 0);
});

test("default daemon adapter reads the native PID record and ignores an exact proxy client", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-daemon-"));
  try {
    const uid = process.getuid();
    const codexHome = path.join(directory, "codex-home");
    const daemonDirectory = path.join(codexHome, "app-server-daemon");
    const executable = path.join(directory, "codex");
    const socket = path.join(directory, "app-server-control.sock");
    fs.mkdirSync(daemonDirectory, { recursive: true });
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(socket, "fixture", { mode: 0o600 });
    const pidRecord = path.join(daemonDirectory, "app-server.pid");
    fs.writeFileSync(pidRecord, JSON.stringify({
      pid: 500,
      processStartTime: "2026-08-02T16:00:00.000Z",
    }), { mode: 0o600 });
    const canonicalExecutable = fs.realpathSync(executable);
    const canonicalSocket = fs.realpathSync(socket);
    const owner = exactIdentity({
      pid: 500,
      parentPid: 1,
      processGroupId: 500,
      uid,
      startTime: "2026-08-02T16:00:00.000Z",
      executable: canonicalExecutable,
    });
    let omitBackend = false;
    let runFailure = null;
    const runner = (file, args) => {
      if (file === canonicalExecutable) {
        assert.deepEqual(args, ["app-server", "daemon", "version"]);
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            ...(!omitBackend ? { backend: "pid" } : {}),
            managedCodexPath: canonicalExecutable,
            socketPath: canonicalSocket,
          }),
          stderr: "",
          ...runFailure,
        };
      }
      if (file === "/usr/sbin/lsof") {
        assert.deepEqual(args, ["-nP", "-U", "-Fpcfn"]);
        return {
          status: 0,
          stdout: `p500\nccodex\nf10\nn${canonicalSocket}\np600\nccodex\nf11\nn${canonicalSocket}\n`,
          stderr: "",
        };
      }
      if (file === "/bin/ps") {
        assert.deepEqual(args, ["-p", "600", "-o", "command="]);
        return { status: 0, stdout: `${canonicalExecutable} app-server proxy\n`, stderr: "" };
      }
      throw new Error(`unexpected command: ${file}`);
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      runner,
      env: { CODEX_HOME: codexHome },
      uid,
      readIdentity: (pid) => pid === owner.pid
        ? { state: "present", identity: owner }
        : { state: "unknown" },
    });

    const evidence = dependencies.sampleDaemonEvidence({
      socket: canonicalSocket,
      executable: { path: canonicalExecutable },
      ownerPid: owner.pid,
    });

    assert.deepEqual(evidence.socketOwners, [{ pid: owner.pid, uid }]);
    assert.deepEqual(evidence.pidRecord, {
      state: "valid",
      uid,
      regular: true,
      symlink: false,
      pid: owner.pid,
      processStartTime: owner.startTime,
    });
    assert.equal(evidence.managedExecutable.path, canonicalExecutable);

    omitBackend = true;
    assert.throws(
      () => dependencies.sampleDaemonEvidence({
        socket: canonicalSocket,
        executable: { path: canonicalExecutable },
        ownerPid: owner.pid,
      }),
      (error) => error.code === "daemon-version-invalid",
    );
    omitBackend = false;

    for (const failure of [
      { error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
      { signal: "SIGKILL" },
    ]) {
      runFailure = failure;
      assert.throws(
        () => dependencies.sampleDaemonEvidence({
          socket: canonicalSocket,
          executable: { path: canonicalExecutable },
          ownerPid: owner.pid,
        }),
        (error) => error.code === "daemon-version-unavailable",
      );
    }
    runFailure = null;

    fs.chmodSync(pidRecord, 0o666);
    assert.deepEqual(dependencies.sampleDaemonEvidence({
      socket: canonicalSocket,
      executable: { path: canonicalExecutable },
      ownerPid: owner.pid,
    }).pidRecord, { state: "invalid" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("file identity hashes the opened inode instead of a later pathname lookup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-file-identity-"));
  try {
    const executable = path.join(directory, "codex");
    const contents = Buffer.from("#!/bin/sh\nexit 0\n");
    fs.writeFileSync(executable, contents, { mode: 0o755 });
    let pathRead = false;
    const fsApi = {
      ...fs,
      readFileSync(target, ...args) {
        if (typeof target !== "number") {
          pathRead = true;
          return Buffer.from("replacement pathname contents");
        }
        return fs.readFileSync(target, ...args);
      },
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      fsApi,
    });

    const identity = dependencies.fileIdentity(executable);

    assert.equal(pathRead, false);
    assert.equal(identity.size, contents.length);
    assert.equal(identity.digest, createHash("sha256").update(contents).digest("hex"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unsafe attestor files and pre-signal unmanaged drift remain exit 2", () => {
  const unsafe = recycleHarness();
  const originalFileIdentity = unsafe.deps.fileIdentity;
  unsafe.deps.fileIdentity = (value) => value === ATTESTOR
    ? { ...originalFileIdentity(value), mode: 0o100777 }
    : originalFileIdentity(value);
  const unsafeOutcome = recycleServer(recycleOptions(), unsafe.deps);
  assert.equal(unsafeOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(unsafeOutcome.result.verification.mutationAttempted, false);

  const stopped = recycleHarness({ mode: "unmanaged" });
  stopped.deps.stopUnmanaged = () => ({
    exitCode: EXIT_CODES.refused,
    mutationAttempted: false,
    failureCode: "unmanaged-identity-changed",
  });
  const stoppedOutcome = recycleServer(confirmedRecycleOptions({
    unmanaged: true,
    launcher: LAUNCHER,
  }), stopped.deps);
  assert.equal(stoppedOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(stoppedOutcome.result.verification.mutationAttempted, false);
  assert.ok(stoppedOutcome.result.verification.missingEvidence.includes("unmanaged-identity-changed"));
  assert.equal(stopped.calls.launch, 0);
});

test("default readiness reports the last exact recovery failure", () => {
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    uid: process.getuid(),
    readIdentity: () => ({ state: "absent" }),
    readyTimeoutMs: 0,
  });

  assert.deepEqual(dependencies.waitForReady({
    pid: 900,
    socketPath: RECYCLE_SOCKET,
    mode: "managed",
    executable: "/usr/local/bin/codex",
  }), { failureCode: "replacement-identity-not-ready" });
});

test("default unmanaged launcher absorbs asynchronous spawn errors", () => {
  const child = new EventEmitter();
  child.pid = undefined;
  child.unref = () => {};
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    spawnProcess: () => child,
  });

  assert.deepEqual(dependencies.launchUnmanaged({
    launcher: "/tmp/codex-wrapper",
    socketPath: RECYCLE_SOCKET,
  }), { pid: null });
  assert.equal(child.listenerCount("error"), 1);
  assert.doesNotThrow(() => child.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" })));
});

test("readiness bounds every default process probe to the remaining deadline", () => {
  let clock = 0;
  const calls = [];
  const runner = (file, args, { timeout } = {}) => {
    calls.push({ file, args, timeout });
    clock += timeout;
    return { status: null, stdout: "", stderr: "", error: true };
  };
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    runner,
    readyTimeoutMs: 50,
    readyPollMs: 10,
    monotonicNow: () => clock,
    sleep: () => assert.fail("exhausted deadline must not sleep"),
  });

  assert.deepEqual(dependencies.waitForReady({
    pid: 900,
    socketPath: RECYCLE_SOCKET,
    mode: "managed",
    executable: "/usr/local/bin/codex",
  }), { failureCode: "replacement-identity-not-ready" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeout, 50);
});

test("readiness bounds the socket owner identity recheck", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-ready-"));
  try {
    const socket = path.join(directory, "app-server-control.sock");
    fs.writeFileSync(socket, "fixture", { mode: 0o600 });
    const canonicalSocket = fs.realpathSync(socket);
    const executable = "/usr/local/bin/codex";
    const uid = process.getuid();
    const identity = exactIdentity({
      pid: 900,
      parentPid: 1,
      processGroupId: 900,
      uid,
      executable,
    });
    let clock = 0;
    const identityRunners = [];
    const runner = (file, args, { timeout } = {}) => {
      assert.ok(timeout > 0 && timeout <= 50);
      if (file === executable) {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            backend: "pid",
            managedCodexPath: executable,
            socketPath: canonicalSocket,
          }),
          stderr: "",
        };
      }
      if (file === "/usr/sbin/lsof" && args.includes("-U")) {
        return { status: 0, stdout: `p900\nccodex\nf10\nn${canonicalSocket}\n`, stderr: "" };
      }
      if (file === "/usr/sbin/lsof" && args.includes("-a")) {
        clock += timeout;
        return { status: null, stdout: "", stderr: "", error: true };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      runner,
      uid,
      readyTimeoutMs: 50,
      readyPollMs: 10,
      monotonicNow: () => clock,
      sleep: (milliseconds) => { clock += milliseconds; },
      readIdentity(pid, { runner: identityRunner } = {}) {
        assert.equal(pid, identity.pid);
        identityRunners.push(identityRunner);
        return { state: "present", identity };
      },
    });

    assert.deepEqual(dependencies.waitForReady({
      pid: identity.pid,
      socketPath: canonicalSocket,
      mode: "managed",
      executable,
    }), { failureCode: "replacement-descriptors-unavailable" });
    assert.equal(identityRunners.length, 2);
    assert.ok(identityRunners.every((identityRunner) => typeof identityRunner === "function"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unmanaged stop kills a TERM-resistant child after natural reparenting", () => {
  const snapshot = snapshotFixture();
  const states = new Map([
    [snapshot.owner.pid, snapshot.owner],
    [snapshot.targets[0].pid, snapshot.targets[0]],
  ]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (pid === snapshot.owner.pid && signal === "SIGTERM") {
        states.delete(pid);
        states.set(snapshot.targets[0].pid, { ...snapshot.targets[0], parentPid: 1 });
      }
      if (pid === snapshot.targets[0].pid && signal === "SIGKILL") states.delete(pid);
    },
    sleep: () => {},
  });

  assert.deepEqual(dependencies.stopUnmanaged(snapshot), {
    exitCode: EXIT_CODES.healthy,
    mutationAttempted: true,
    failureCode: null,
  });
  assert.deepEqual(signals, [
    [snapshot.targets[0].pid, "SIGTERM"],
    [snapshot.owner.pid, "SIGTERM"],
    [snapshot.targets[0].pid, "SIGKILL"],
  ]);
  assert.equal(states.size, 0);
});

test("unmanaged stop refuses same-start UID drift after TERM", () => {
  const snapshot = snapshotFixture();
  const states = new Map([
    [snapshot.owner.pid, snapshot.owner],
    [snapshot.targets[0].pid, snapshot.targets[0]],
  ]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (pid === snapshot.targets[0].pid && signal === "SIGTERM") {
        states.set(pid, { ...snapshot.targets[0], uid: snapshot.targets[0].uid + 1 });
      }
      if (pid === snapshot.owner.pid && signal === "SIGTERM") states.delete(pid);
    },
    sleep: () => {},
  });

  assert.deepEqual(dependencies.stopUnmanaged(snapshot), {
    exitCode: EXIT_CODES.failed,
    mutationAttempted: true,
    failureCode: "unmanaged-post-term-identity-unverified",
  });
  assert.deepEqual(signals, [
    [snapshot.targets[0].pid, "SIGTERM"],
    [snapshot.owner.pid, "SIGTERM"],
  ]);
  assert.equal(states.has(snapshot.targets[0].pid), true);
});

test("applicable parent identity must be gone after recycle", () => {
  const gone = recycleHarness();
  const parent = addApplicableParent(gone);
  const originalRestart = gone.deps.restartManagedExact;
  gone.deps.restartManagedExact = (...args) => {
    const result = originalRestart(...args);
    gone.state.set(parent.pid, { state: "absent" });
    return result;
  };
  const success = recycleServer(parentBoundOptions(), gone.deps);
  assert.equal(success.exitCode, EXIT_CODES.healthy);
  assert.deepEqual(success.result.verification.after.oldParent, { pid: parent.pid, gone: true });

  const survivor = recycleHarness();
  addApplicableParent(survivor);
  const failed = recycleServer(parentBoundOptions(), survivor.deps);
  assert.equal(failed.exitCode, EXIT_CODES.failed);
  assert.ok(failed.result.verification.missingEvidence.includes("old-parent-survivor"));
});
