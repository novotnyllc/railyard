// Shared fixtures for the cleanup-codex suites. Not a suite itself.

import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync as spawnChildSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXIT_CODES,
  SNAPSHOT_SCHEMA,
  inspectHook,
  recycleServer,
} from "./cleanup-codex.mjs";

export const NOW = Date.parse("2026-08-02T16:00:00.000Z");

export const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const PLUGIN_DIRECTORY = path.resolve(TEST_DIRECTORY, "../../..");

export function processRecord(overrides) {
  return {
    pid: 1,
    parentPid: 0,
    processGroupId: 1,
    uid: 501,
    startTime: "2026-08-02T15:00:00.000Z",
    executable: "/sbin/launchd",
    rawCommand: "/sbin/launchd",
    ...overrides,
  };
}

export function inventory(overrides = {}) {
  return {
    platform: "darwin",
    collectionErrors: [],
    processes: [],
    descriptors: {},
    proxySockets: {},
    controlSockets: { complete: true, items: [] },
    ...overrides,
  };
}

export const EXACT_IDENTITY_FIELDS = [
  "pid",
  "parentPid",
  "processGroupId",
  "uid",
  "startTime",
  "executable",
];

export function sameExactIdentity(expected, actual) {
  return Boolean(actual) && EXACT_IDENTITY_FIELDS.every((field) => actual[field] === expected[field]);
}

export function guiFixture() {
  return inventory({
    processes: [
      processRecord({
        pid: 10,
        parentPid: 1,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        rawCommand: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      }),
      processRecord({
        pid: 101,
        parentPid: 10,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/Resources/codex",
        rawCommand: "/Applications/ChatGPT.app/Contents/Resources/codex app-server",
      }),
    ],
    descriptors: { 101: { complete: true, count: 20, highest: 31 } },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/codex/app-server-control.sock", ownerPid: 101 }],
    },
  });
}

export function exactIdentity(overrides = {}) {
  return {
    pid: 200,
    parentPid: 100,
    processGroupId: 100,
    uid: 501,
    startTime: "2026-08-02T15:30:00.000Z",
    executable: "/usr/bin/worker",
    ...overrides,
  };
}

export function snapshotFixture(overrides = {}) {
  return {
    schema: SNAPSHOT_SCHEMA,
    createdAt: "2026-08-02T16:00:00.000Z",
    createdByUid: 501,
    owner: {
      role: "server",
      ...exactIdentity({
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        startTime: "2026-08-02T15:00:00.000Z",
        executable: "/usr/local/bin/codex",
        commandIdentity: "codex app-server",
      }),
    },
    targets: [{
      role: "descendant",
      ...exactIdentity({ commandIdentity: "process" }),
    }],
    ...overrides,
  };
}

export function sequenceReader(sequences) {
  const calls = [];
  return {
    calls,
    readIdentity(pid) {
      calls.push(pid);
      const values = sequences.get(pid);
      assert.ok(values?.length, `unexpected identity read for pid ${pid}`);
      return values.shift();
    },
  };
}

export function unlocked() {
  return {
    acquire() {
      return () => {};
    },
  };
}

export const RECYCLE_SOCKET = "/tmp/codex/app-server-control.sock";

export const GUI_SOCKET = "/tmp/codex-gui/app-server-control.sock";

export const ATTESTOR = "/usr/local/bin/codex-nofile-attestor";

export const LAUNCHER = "/usr/local/bin/codex-wrapper";

export function recycleInventoryFixture() {
  return inventory({
    processes: [
      processRecord({
        pid: 10,
        parentPid: 1,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        rawCommand: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      }),
      processRecord({
        pid: 101,
        parentPid: 10,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/Resources/codex",
        rawCommand: "/Applications/ChatGPT.app/Contents/Resources/codex app-server",
      }),
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 500,
        parentPid: 50,
        processGroupId: 500,
        executable: "/usr/local/bin/codex",
        rawCommand: `/usr/local/bin/codex app-server --listen unix://${RECYCLE_SOCKET}`,
      }),
      processRecord({
        pid: 501,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/bin/worker",
        rawCommand: "/usr/bin/worker --prompt SHOULD_NOT_LEAK",
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
    ],
    descriptors: {
      101: { complete: true, count: 25, highest: 46 },
      500: { complete: true, count: 255, highest: 255 },
    },
    proxySockets: {
      600: {
        complete: true,
        paths: [RECYCLE_SOCKET],
        connections: [{ endpoint: "0x600", peerEndpoint: "0x500" }],
      },
      601: { complete: true, paths: ["/tmp/other/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [
        { path: GUI_SOCKET, ownerPid: 101 },
        { path: RECYCLE_SOCKET, ownerPid: 500, endpoints: ["0x500"] },
      ],
    },
  });
}

export function liveIdentity(record, overrides = {}) {
  return exactIdentity({
    pid: record.pid,
    parentPid: record.parentPid,
    processGroupId: record.processGroupId,
    uid: record.uid,
    startTime: record.startTime,
    executable: record.executable,
    ...overrides,
  });
}

export function daemonSample(fixture, backend = "pid", overrides = {}) {
  const server = fixture.processes.find((item) => item.pid === 500);
  return {
    version: {
      status: "running",
      backend,
      socketPath: RECYCLE_SOCKET,
      managedCodexPath: backend === "pid" ? "/usr/local/bin/codex" : null,
    },
    socketOwners: [{ pid: 500, uid: 501 }],
    managedExecutable: backend === "pid"
      ? { path: "/usr/local/bin/codex", dev: 1, ino: 2 }
      : null,
    pidRecord: backend === "pid"
      ? {
          state: "valid",
          uid: 501,
          regular: true,
          symlink: false,
          pid: 500,
          processStartTime: server.startTime,
        }
      : { state: "absent" },
    ...overrides,
  };
}

export function recycleOptions(overrides = {}) {
  return {
    platform: "darwin",
    uid: 501,
    pid: 500,
    unmanaged: false,
    confirmation: null,
    attestorPath: ATTESTOR,
    minSoftLimit: 8192,
    launcher: null,
    ...overrides,
  };
}

export function recycleHarness({
  mode = "managed",
  sampleOverrides = [],
  ready = undefined,
  oldSoftNofile = 8192,
} = {}) {
  const fixture = recycleInventoryFixture();
  const byPid = new Map(fixture.processes.map((record) => [record.pid, record]));
  const state = new Map([
    [101, { state: "present", identity: liveIdentity(byPid.get(101)) }],
    [500, { state: "present", identity: liveIdentity(byPid.get(500)) }],
    [501, { state: "present", identity: liveIdentity(byPid.get(501)) }],
    [600, { state: "present", identity: liveIdentity(byPid.get(600)) }],
  ]);
  const replacement = exactIdentity({
    pid: 900,
    parentPid: 1,
    processGroupId: 900,
    uid: 501,
    startTime: "2026-08-02T16:01:00.000Z",
    executable: "/usr/local/bin/codex",
  });
  const baseSample = daemonSample(fixture, mode === "managed" ? "pid" : null);
  const replacementSample = daemonSample(fixture, mode === "managed" ? "pid" : null, {
    socketOwners: [{ pid: replacement.pid, uid: replacement.uid }],
    pidRecord: mode === "managed"
      ? {
          state: "valid",
          uid: replacement.uid,
          regular: true,
          symlink: false,
          pid: replacement.pid,
          processStartTime: replacement.startTime,
        }
      : { state: "absent" },
  });
  const samples = sampleOverrides.length
    ? sampleOverrides
    : [baseSample, baseSample, baseSample, baseSample, replacementSample];
  let sampleIndex = 0;
  const calls = {
    samples: 0,
    sampleContexts: [],
    attest: [],
    attestLauncher: [],
    restart: 0,
    residue: 0,
    stop: 0,
    launch: 0,
    lock: 0,
    readyContext: null,
  };
  const deps = {
    inventory: fixture,
    collectInventory() {
      return fixture;
    },
    readIdentity(pid) {
      return state.get(pid) ?? { state: "absent" };
    },
    canonicalPath(value) {
      return value;
    },
    fileIdentity(value) {
      if (!["/usr/local/bin/codex", ATTESTOR, LAUNCHER].includes(value)) return null;
      return {
        path: value,
        dev: value === "/usr/local/bin/codex" ? 1 : 3,
        ino: value === "/usr/local/bin/codex" ? 2 : value === ATTESTOR ? 4 : 5,
        uid: 0,
        mode: 0o100755,
        nlink: 1,
        mtimeMs: 1,
        size: 100,
        digest: value === "/usr/local/bin/codex" ? "a".repeat(64) : value === ATTESTOR ? "b".repeat(64) : "c".repeat(64),
        regular: true,
        symlink: false,
        executable: true,
      };
    },
    sampleDaemonEvidence(context) {
      calls.samples += 1;
      calls.sampleContexts.push(context);
      return structuredClone(samples[Math.min(sampleIndex++, samples.length - 1)]);
    },
    attestNofile(identity) {
      calls.attest.push(identity.pid);
      return {
        schema: "codex-nofile-attestation-v1",
        pid: identity.pid,
        uid: identity.uid,
        processStartTime: identity.startTime,
        softNofile: identity.pid === 500 ? oldSoftNofile : 8192,
      };
    },
    attestLauncher(launcher) {
      calls.attestLauncher.push(launcher.path);
      return {
        schema: "codex-launcher-nofile-attestation-v1",
        path: launcher.path,
        dev: launcher.dev,
        ino: launcher.ino,
        replacementExecutable: "/usr/local/bin/codex",
        softNofile: 8192,
      };
    },
    restartManagedExact({ expectedIdentity }) {
      assert.equal(expectedIdentity.pid, 500);
      assert.equal(expectedIdentity.startTime, fixture.processes.find((item) => item.pid === 500).startTime);
      calls.restart += 1;
      state.set(500, { state: "absent" });
      state.set(900, { state: "present", identity: replacement });
      return {
        status: "restarted",
        backend: "pid",
        pid: 900,
        socketPath: RECYCLE_SOCKET,
      };
    },
    reapResidue(snapshot) {
      calls.residue += 1;
      for (const target of snapshot.targets) state.set(target.pid, { state: "absent" });
      return { exitCode: EXIT_CODES.healthy };
    },
    stopUnmanaged(snapshot) {
      calls.stop += 1;
      state.set(snapshot.owner.pid, { state: "absent" });
      for (const target of snapshot.targets) state.set(target.pid, { state: "absent" });
      return { exitCode: EXIT_CODES.healthy };
    },
    launchUnmanaged() {
      calls.launch += 1;
      state.set(900, { state: "present", identity: replacement });
      return { pid: 900 };
    },
    waitForReady(context) {
      calls.readyContext = context;
      return ready === undefined
        ? {
            identity: replacement,
            socket: { path: RECYCLE_SOCKET, ready: true, owners: [{ pid: 900, uid: 501 }] },
            descriptors: { count: 122, highest: 145 },
            directChildren: 19,
          }
        : ready;
    },
    lock: {
      acquire() {
        calls.lock += 1;
        return () => {};
      },
    },
  };
  return { fixture, state, replacement, calls, deps };
}

export function confirmedRecycleOptions(overrides = {}, harnessOptions = {}) {
  const base = recycleOptions(overrides);
  const probe = recycleHarness({
    mode: base.unmanaged ? "unmanaged" : "managed",
    ...harnessOptions,
  });
  const { result } = recycleServer({ ...base, confirmation: null }, probe.deps);
  assert.ok(result.verification.receipt?.confirmationToken);
  return { ...base, confirmation: result.verification.receipt.confirmationToken };
}

export function addApplicableParent(harness) {
  const parent = harness.fixture.processes.find((item) => item.pid === 50);
  parent.executable = "/usr/local/bin/codex";
  parent.rawCommand = "/usr/local/bin/codex launcher";
  harness.state.set(parent.pid, { state: "present", identity: liveIdentity(parent) });
  return parent;
}

export function parentBoundOptions() {
  const probe = recycleHarness();
  addApplicableParent(probe);
  const options = recycleOptions();
  const { result } = recycleServer(options, probe.deps);
  assert.ok(result.verification.receipt?.confirmationToken);
  return { ...options, confirmation: result.verification.receipt.confirmationToken };
}

export const HOOK_THREAD = "11111111-1111-4111-8111-111111111111";

export const OTHER_THREAD = "22222222-2222-4222-8222-222222222222";

export function hookCleanupFixture(processes) {
  const uid = process.getuid();
  const started = "Sun Aug 2 12:00:00 2026";
  const startedAt = new Date(started).toISOString();
  const records = new Map(processes.map((record) => [record.pid, {
    uid, startTime: startedAt, executable: "/bin/sh", ...record,
  }]));
  const signals = [];
  const row = (record, command) => (
    `${record.pid} ${record.parentPid} ${record.processGroupId} ${record.uid} ${started} ${command}\n`
  );
  const server = { pid: 500, parentPid: 1, processGroupId: 500, uid, startTime: startedAt };
  const hook = { pid: 700, parentPid: 500, processGroupId: 500, uid, startTime: startedAt };
  return {
    uid,
    startedAt,
    signals,
    remove(pid) { records.delete(pid); },
    add(record) {
      records.set(record.pid, { uid, startTime: startedAt, executable: "/bin/sh", ...record });
    },
    runner(file, args) {
      if (file !== "/bin/ps" && file !== "/usr/sbin/lsof") return { status: 1, stdout: "", stderr: "" };
      if (file === "/usr/sbin/lsof") {
        if (args.includes("-d") && args.includes("txt")) {
          const pids = String(args[args.indexOf("-p") + 1]).split(",").map(Number);
          return {
            status: 0,
            stdout: pids.flatMap((pid) => records.has(pid)
              ? [`p${pid}`, "ftxt", "tREG", `n${records.get(pid).executable}`]
              : []).join("\n"),
            stderr: "",
          };
        }
        return { status: 0, stdout: "ftxt\nn/usr/local/bin/codex\nf10\nn/tmp/app-server-control.sock\n", stderr: "" };
      }
      if (args[0] === "ww" || args[0] === "eww") {
        const env = args[0] === "eww";
        const all = [server, hook, ...records.values()];
        return { status: 0, stdout: all.map((record) => {
          const command = record.pid === 500 ? "/usr/local/bin/codex app-server"
            : record.pid === 700 ? "/bin/sh hook"
              : record.command ?? "/bin/sh worker";
          return row(record, env && record.threadId
            ? `${command} CODEX_THREAD_ID=${record.threadId} SECRET_VALUE=never-write-this`
            : command);
        }).join(""), stderr: "" };
      }
      const pid = Number(args[1]);
      const record = pid === 500 ? server : pid === 700 ? hook : records.get(pid);
      if (!record) return { status: 1, stdout: "", stderr: "" };
      const command = args.at(-1).endsWith("command=")
        ? (pid === 500 ? "/usr/local/bin/codex app-server" : "/bin/sh hook")
        : "/usr/local/bin/codex";
      return { status: 0, stdout: row(record, command), stderr: "" };
    },
    readIdentity(pid) {
      const record = records.get(pid);
      return record ? { state: "present", identity: {
        pid: record.pid,
        parentPid: record.parentPid,
        processGroupId: record.processGroupId,
        uid: record.uid,
        startTime: record.startTime,
        executable: record.executable,
      } } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (signal === "SIGKILL") records.delete(pid);
    },
  };
}

export function runHookFixture(fixture, directory) {
  return inspectHook({
    platform: "darwin",
    runner: fixture.runner,
    env: { XDG_STATE_HOME: directory, HOME: directory },
    uid: fixture.uid,
    now: Date.parse(fixture.startedAt) + 1_000,
    parentPid: 700,
    sessionId: HOOK_THREAD,
    readIdentity: fixture.readIdentity,
    signalProcess: fixture.signalProcess,
    sleep: () => {},
    lock: { acquire: () => () => {} },
  });
}
