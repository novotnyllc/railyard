import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  buildExactTreeSnapshot,
  classifyInventory,
  createMutationLock,
  readSnapshotSecure,
  reapSnapshot,
  runCli,
  writeSnapshotAtomic,
} from "./cleanup-codex.mjs";

import {
  NOW,
  exactIdentity,
  inventory,
  processRecord,
  sequenceReader,
  snapshotFixture,
  unlocked,
} from "./test-support.mjs";

test("inspect snapshot records only the exact selected tree and socket-linked proxy", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 500,
        parentPid: 50,
        processGroupId: 500,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --prompt SNAPSHOT_SECRET",
      }),
      processRecord({
        pid: 501,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/bin/worker",
        rawCommand: "/usr/bin/worker --transcript PRIVATE_TRANSCRIPT",
      }),
      processRecord({
        pid: 502,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/local/bin/cloudflared",
        rawCommand: "/usr/local/bin/cloudflared tunnel run",
      }),
      processRecord({ pid: 60, parentPid: 1, processGroupId: 60, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 600,
        parentPid: 60,
        processGroupId: 600,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy --token PROXY_SECRET",
      }),
      processRecord({
        pid: 601,
        parentPid: 60,
        processGroupId: 601,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
      processRecord({ pid: 700, parentPid: 1, processGroupId: 700, rawCommand: "/usr/bin/unrelated" }),
    ],
    descriptors: { 500: { complete: true, count: 12, highest: 18 } },
    proxySockets: {
      600: {
        complete: true,
        paths: ["/tmp/codex/app-server-control.sock"],
        connections: [{ endpoint: "0x600", peerEndpoint: "0x500" }],
      },
      601: { complete: true, paths: ["/tmp/other/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/codex/app-server-control.sock", ownerPid: 500, endpoints: ["0x500"] }],
    },
  });
  const { result } = classifyInventory(fixture, { now: NOW });
  const exact = new Map([
    [500, exactIdentity({
      pid: 500,
      parentPid: 50,
      processGroupId: 500,
      startTime: fixture.processes[1].startTime,
      executable: "/usr/local/bin/codex",
    })],
    [501, exactIdentity({
      pid: 501,
      parentPid: 500,
      processGroupId: 500,
      startTime: fixture.processes[2].startTime,
    })],
    [502, exactIdentity({
      pid: 502,
      parentPid: 500,
      processGroupId: 500,
      startTime: fixture.processes[3].startTime,
      executable: "/usr/local/bin/cloudflared",
    })],
    [600, exactIdentity({
      pid: 600,
      parentPid: 60,
      processGroupId: 600,
      startTime: fixture.processes[5].startTime,
      executable: "/usr/local/bin/codex",
    })],
  ]);

  const snapshot = buildExactTreeSnapshot({
    inventory: fixture,
    inspection: result,
    readIdentity: (pid) => ({ state: "present", identity: exact.get(pid) }),
    now: NOW,
    uid: 501,
  });

  assert.equal(snapshot.owner.pid, 500);
  assert.deepEqual(snapshot.targets.map(({ pid, role }) => ({ pid, role })), [
    { pid: 501, role: "descendant" },
    { pid: 502, role: "descendant" },
    { pid: 600, role: "proxy" },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /SNAPSHOT_SECRET|PRIVATE_TRANSCRIPT|PROXY_SECRET|prompt|transcript|token/);
});

test("inspect --snapshot atomically writes a private validated snapshot", {
  // macOS-only: the sole snapshot test that publishes through the REAL
  // filesystem (its siblings mock fsApi), so it depends on the host's
  // hard-link + stat privacy semantics the darwin-only reaper targets.
  skip: process.platform !== "darwin" && "macOS-only real-filesystem publish",
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-snapshot-"));
  const snapshotPath = path.join(directory, "tree.json");
  const fixture = inventory({
    processes: [
      processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 707,
        parentPid: 70,
        processGroupId: 707,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --listen unix:///tmp/runtime.sock",
      }),
    ],
    descriptors: { 707: { complete: true, count: 10, highest: 16 } },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/runtime/app-server-control.sock", ownerPid: 707 }],
    },
  });
  const output = [];
  try {
    const exitCode = runCli(["inspect", "--snapshot", snapshotPath, "--json"], {
      platform: "darwin",
      now: NOW,
      uid: process.getuid(),
      inventory: fixture,
      readIdentity: () => ({ state: "present", identity: exactIdentity({
        pid: 707,
        parentPid: 70,
        processGroupId: 707,
        uid: process.getuid(),
        startTime: fixture.processes[1].startTime,
        executable: "/usr/local/bin/codex",
      }) }),
      write: (text) => output.push(text),
    });

    assert.equal(exitCode, EXIT_CODES.healthy);
    assert.equal(fs.lstatSync(snapshotPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(output[0]).verification.snapshot.created, true);
    assert.doesNotMatch(output[0], new RegExp(snapshotPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(readSnapshotSecure(snapshotPath, { uid: process.getuid() }).owner.pid, 707);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot file validation rejects overwrite, bad schema, mode, owner, and symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-safety-"));
  const uid = process.getuid();
  const valid = snapshotFixture({
    createdByUid: uid,
    owner: { ...snapshotFixture().owner, uid },
    targets: snapshotFixture().targets.map((target) => ({ ...target, uid })),
  });
  try {
    const safe = path.join(directory, "safe.json");
    writeSnapshotAtomic(safe, valid, { uid });
    assert.deepEqual(readSnapshotSecure(safe, { uid }), valid);
    assert.throws(() => writeSnapshotAtomic(safe, valid, { uid }), (error) => error.code === "snapshot-file-exists");

    const badSchema = path.join(directory, "bad-schema.json");
    fs.writeFileSync(badSchema, JSON.stringify({ ...valid, prompt: "SECRET" }), { mode: 0o600 });
    assert.throws(() => readSnapshotSecure(badSchema, { uid }), (error) => error.code === "snapshot-schema-invalid");

    const badMode = path.join(directory, "bad-mode.json");
    fs.writeFileSync(badMode, JSON.stringify(valid), { mode: 0o644 });
    fs.chmodSync(badMode, 0o644);
    assert.throws(() => readSnapshotSecure(badMode, { uid }), (error) => error.code === "snapshot-file-mode");
    assert.throws(() => readSnapshotSecure(safe, { uid: uid + 1 }), (error) => error.code === "snapshot-file-owner");

    const link = path.join(directory, "snapshot-link.json");
    fs.symlinkSync(safe, link);
    assert.throws(() => readSnapshotSecure(link, { uid }), (error) => error.code === "snapshot-file-symlink");

    const oversized = path.join(directory, "oversized.json");
    const tooLarge = {
      ...valid,
      targets: Array.from({ length: 10_000 }, (_, index) => ({
        ...valid.targets[0],
        role: "proxy",
        commandIdentity: "codex app-server proxy",
        pid: 10_000 + index,
        parentPid: 1,
      })),
    };
    assert.throws(
      () => writeSnapshotAtomic(oversized, tooLarge, { uid }),
      (error) => error.code === "snapshot-file-size",
    );
    assert.equal(fs.existsSync(oversized), false);

    const rejectedPublication = path.join(directory, "rejected-publication.json");
    let linked = false;
    let rejectFinalCheck = true;
    const failingFs = {
      ...fs,
      openSync(file, flags) {
        return fs.openSync(file, flags, 0o000);
      },
      linkSync(source, destination) {
        fs.linkSync(source, destination);
        linked = true;
      },
      lstatSync(file) {
        if (file === rejectedPublication && linked && rejectFinalCheck) {
          rejectFinalCheck = false;
          throw Object.assign(new Error("injected final check failure"), { code: "EIO" });
        }
        return fs.lstatSync(file);
      },
    };
    assert.throws(
      () => writeSnapshotAtomic(rejectedPublication, valid, { fsApi: failingFs, uid }),
      (error) => error.code === "snapshot-write-failed",
    );
    assert.equal(fs.existsSync(rejectedPublication), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reap refuses while the exact recorded owner is live", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "present", identity: snapshot.owner }]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => assert.fail("must not sleep"),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(signals, []);
  assert.deepEqual(result.verification.missingEvidence, ["owner-still-live"]);
  assert.deepEqual(reader.calls, [100]);
});

test("reap does not treat a reused owner PID as conclusive absence", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{
      state: "present",
      identity: { ...snapshot.owner, startTime: "2026-08-02T15:01:00.000Z" },
    }]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => assert.fail("must not sleep"),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(signals, []);
  assert.deepEqual(result.verification.missingEvidence, ["owner-identity-changed"]);
});

test("reap refuses PID reuse and every required identity drift without signaling", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const changes = new Map([
    ["pid", target.pid + 1],
    ["uid", target.uid + 1],
    ["startTime", "2026-08-02T15:31:00.000Z"],
    ["executable", "/usr/bin/replacement"],
    ["processGroupId", target.processGroupId + 1],
  ]);

  for (const [field, value] of changes) {
    const signals = [];
    const reader = sequenceReader(new Map([
      [100, [{ state: "absent" }]],
      [200, [{ state: "present", identity: { ...target, [field]: value } }]],
    ]));
    const { result, exitCode } = reapSnapshot(snapshot, {
      platform: "darwin",
      uid: 501,
      readIdentity: reader.readIdentity,
      signalProcess: (...args) => signals.push(args),
      sleep: () => assert.fail("must not sleep"),
      lock: unlocked(),
    });

    assert.equal(exitCode, EXIT_CODES.refused, field);
    assert.deepEqual(signals, [], field);
    assert.ok(result.skipped[0].reasons.includes(`identity-changed:${field}`), field);
  }
});

test("TERM-responsive target is never KILLed", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const sleeps = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "absent" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: (milliseconds) => sleeps.push(milliseconds),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(sleeps, [1500]);
  assert.deepEqual(result.verification.termPids, [200]);
  assert.deepEqual(result.verification.killPids, []);
});

test("TERM-resistant matching survivor is KILLed and a later child is untouched", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "absent" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(reader.calls, [100, 200, 200, 200, 200]);
  assert.deepEqual(result.verification.killPids, [200]);
  assert.ok(signals.every(([pid]) => pid !== 300));
});

test("identity drift after TERM prevents survivor KILL", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, executable: "/usr/bin/replacement" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(result.verification.killPids, []);
  assert.equal(result.verification.complete, false);
  assert.ok(result.skipped[0].reasons.includes("identity-changed:executable"));
});

test("UID drift after TERM does not prove PID reuse", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, uid: target.uid + 1 } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.equal(result.verification.postKillVerifiedPids.includes(200), false);
  assert.ok(result.skipped[0].reasons.includes("identity-changed:uid"));
});

test("PID reuse after TERM proves the old identity gone without KILL", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, startTime: "2026-08-02T15:31:00.000Z" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(result.verification.postKillVerifiedPids, [200]);
  assert.ok(result.skipped.some((item) => (
    item.pid === 200 && item.reasons.includes("pid-reused-after-term")
  )));
});

test("exact survivor lingering after SIGKILL returns incomplete exit 3", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const sleeps = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: (milliseconds) => sleeps.push(milliseconds),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.equal(result.verification.complete, false);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(sleeps, [1500, 100]);
  assert.ok(result.verification.missingEvidence.includes("post-kill-survivor"));
});

test("same-start drift after SIGKILL remains a survivor", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  for (const drift of [{ processGroupId: 777 }, { uid: target.uid + 1 }]) {
    const signals = [];
    const reader = sequenceReader(new Map([
      [100, [{ state: "absent" }]],
      [200, [
        { state: "present", identity: target },
        { state: "present", identity: target },
        { state: "present", identity: target },
        { state: "present", identity: { ...target, ...drift } },
      ]],
    ]));

    const { result, exitCode } = reapSnapshot(snapshot, {
      platform: "darwin",
      uid: 501,
      readIdentity: reader.readIdentity,
      signalProcess: (...args) => signals.push(args),
      sleep: () => {},
      lock: unlocked(),
    });

    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
    assert.ok(result.verification.missingEvidence.includes("post-kill-survivor"));
    assert.equal(result.verification.postKillVerifiedPids.includes(200), false);
  }
});

test("unknown final state after SIGKILL returns incomplete exit 3", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "unknown" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: () => {},
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.ok(result.verification.missingEvidence.includes("post-kill-verification-unknown"));
});

test("reused PID after SIGKILL proves the old identity gone without another signal", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, startTime: "2026-08-02T15:31:00.000Z" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(result.verification.postKillVerifiedPids, [200]);
  assert.ok(result.skipped.some((item) => item.pid === 200 && item.reasons.includes("pid-reused-after-kill")));
});

test("reap refuses lock contention before process inspection", () => {
  const snapshot = snapshotFixture();
  let inspected = false;
  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: () => {
      inspected = true;
      return { state: "absent" };
    },
    signalProcess: () => assert.fail("must not signal"),
    sleep: () => assert.fail("must not sleep"),
    lock: {
      acquire() {
        const error = new Error("held");
        error.code = "ELOCKED";
        throw error;
      },
    },
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(inspected, false);
  assert.deepEqual(result.verification.missingEvidence, ["mutation-lock-held"]);
});

test("filesystem mutation lock is exclusive and reusable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-"));
  const lockPath = path.join(directory, "mutation.lock");
  try {
    const first = createMutationLock({ uid: process.getuid(), lockPath });
    const second = createMutationLock({ uid: process.getuid(), lockPath });
    const release = first.acquire();

    assert.throws(() => second.acquire(), (error) => error.code === "mutation-lock-held");
    release();
    second.acquire()();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("filesystem mutation lock reclaims only a private lock whose owner is absent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-stale-"));
  const lockPath = path.join(directory, "mutation.lock");
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999_999, uid: process.getuid() })}\n`, { mode: 0o600 });
    const release = createMutationLock({
      uid: process.getuid(),
      lockPath,
      pidIsAlive: (pid) => pid !== 999_999,
    }).acquire();
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("filesystem mutation lock reclaims a birth-bound lock after PID reuse", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-reused-"));
  const lockPath = path.join(directory, "mutation.lock");
  const oldStartTime = "2026-08-02T12:00:00.000Z";
  const currentStartTime = "2026-08-03T12:00:00.000Z";
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({
      pid: 999_999,
      uid: process.getuid(),
      startTime: oldStartTime,
    })}\n`, { mode: 0o600 });
    const release = createMutationLock({
      uid: process.getuid(),
      lockPath,
      readProcessBirth: (pid) => ({
        state: "present",
        uid: process.getuid(),
        startTime: pid === process.pid ? currentStartTime : "2026-08-02T13:00:00.000Z",
      }),
    }).acquire();
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).startTime, currentStartTime);
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("lock release preserves a replacement across an inode swap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-swap-"));
  const lockPath = path.join(directory, "mutation.lock");
  const originalPath = path.join(directory, "original.lock");
  let swap = false;
  const fsApi = {
    ...fs,
    lstatSync(file) {
      if (file === lockPath && swap) {
        swap = false;
        const original = fs.lstatSync(file);
        fs.renameSync(file, originalPath);
        fs.writeFileSync(file, "replacement\n", { mode: 0o600 });
        return original;
      }
      return fs.lstatSync(file);
    },
  };
  try {
    const release = createMutationLock({ fsApi, uid: process.getuid(), lockPath }).acquire();
    swap = true;

    assert.throws(release, (error) => error.code === "mutation-lock-changed");
    assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement\n");
    assert.equal(fs.existsSync(originalPath), true);
    assert.deepEqual(
      fs.readdirSync(directory).sort(),
      [path.basename(lockPath), path.basename(originalPath)].sort(),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("failed lock initialization removes only its created inode", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-failure-"));
  const lockPath = path.join(directory, "mutation.lock");
  const failingFs = {
    ...fs,
    openSync(file, flags) {
      return fs.openSync(file, flags, 0o000);
    },
    writeFileSync(target, ...args) {
      if (typeof target === "number") {
        throw Object.assign(new Error("injected lock write failure"), { code: "EIO" });
      }
      return fs.writeFileSync(target, ...args);
    },
  };
  try {
    assert.throws(
      () => createMutationLock({ fsApi: failingFs, uid: process.getuid(), lockPath }).acquire(),
      (error) => error.code === "mutation-lock-unavailable",
    );
    assert.equal(fs.existsSync(lockPath), false);
    createMutationLock({ uid: process.getuid(), lockPath }).acquire()();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
