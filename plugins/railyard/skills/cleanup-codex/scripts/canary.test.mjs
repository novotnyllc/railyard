import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync as spawnChildSync } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  collectExactProcessIdentity,
  createDefaultRecycleDependencies,
  recycleServer,
} from "./cleanup-codex.mjs";

import {
  inventory,
  processRecord,
  sameExactIdentity,
} from "./test-support.mjs";

test("isolated managed recycle canary replaces a real Unix-socket fixture", {
  skip: process.platform !== "darwin" || !fs.existsSync("/usr/bin/nc"),
  timeout: 10_000,
}, () => {
  const directory = fs.realpathSync(fs.mkdtempSync("/tmp/cleanup-codex-canary."));
  const codex = "/usr/bin/nc";
  const socket = path.join(directory, "app-server-control.sock");
  const codexHome = path.join(directory, "codex-home");
  const daemonDirectory = path.join(codexHome, "app-server-daemon");
  const pidRecord = path.join(daemonDirectory, "app-server.pid");
  const attestor = path.join(directory, "nofile-attestor.cjs");
  const attestationState = path.join(directory, "attestations.json");
  const launcher = path.join(directory, "launch-fixture.mjs");
  const tracked = [];
  const signalCalls = [];
  let activeIdentity = null;
  let restartCalls = 0;
  let nativeSocketUnlinks = 0;

  const sleep = (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  };
  const waitFor = (probe, label, timeout = 3_000) => {
    const deadline = Date.now() + timeout;
    do {
      const value = probe();
      if (value) return value;
      sleep(20);
    } while (Date.now() < deadline);
    throw new Error(`timed out waiting for ${label}`);
  };
  const runActual = (file, args, options = {}) => {
    const run = spawnChildSync(file, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeout ?? 5_000,
    });
    return {
      status: run.status,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      error: run.error ?? null,
    };
  };
  const exactLiveIdentity = (pid) => {
    const observation = collectExactProcessIdentity(pid, { runner: runActual });
    return observation?.state === "present" ? observation.identity : null;
  };
  const writeState = (identity) => {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(attestationState, "utf8")); } catch {}
    state[identity.pid] = {
      pid: identity.pid,
      uid: identity.uid,
      processStartTime: identity.startTime,
      softNofile: 8192,
    };
    fs.writeFileSync(attestationState, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(attestationState, 0o600);
  };
  const launchServer = () => {
    const launched = runActual(process.execPath, [launcher, codex, socket]);
    assert.equal(launched.status, 0, launched.stderr);
    const pid = Number(launched.stdout.trim());
    assert.ok(Number.isInteger(pid) && pid > 0);
    let observedIdentity = null;
    let identity;
    try {
      identity = waitFor(() => {
        observedIdentity = exactLiveIdentity(pid);
        return observedIdentity?.parentPid === 1 && fs.existsSync(socket) ? observedIdentity : null;
      }, "orphaned Unix-socket fixture");
    } catch (error) {
      throw new Error(
        `${error.message}; pid=${pid} socket=${fs.existsSync(socket)} identity=${JSON.stringify(observedIdentity)}`,
      );
    }
    tracked.push(identity);
    writeState(identity);
    fs.writeFileSync(pidRecord, JSON.stringify({
      pid: identity.pid,
      processStartTime: identity.startTime,
    }), { mode: 0o600 });
    fs.chmodSync(pidRecord, 0o600);
    return identity;
  };
  const stopNativeFixture = (identity) => {
    const current = exactLiveIdentity(identity.pid);
    assert.ok(sameExactIdentity(identity, current));
    process.kill(identity.pid, "SIGTERM");
    waitFor(() => exactLiveIdentity(identity.pid) === null, "old fixture exit");
  };

  try {
    fs.mkdirSync(daemonDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(launcher, [
      "import { spawn } from 'node:child_process';",
      "const child = spawn(process.argv[2], ['-d', '-lU', process.argv[3]], {detached:true,stdio:'ignore'});",
      "child.unref();",
      "console.log(child.pid);",
    ].join("\n"), { mode: 0o600 });
    fs.writeFileSync(attestor, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `const state = JSON.parse(fs.readFileSync(${JSON.stringify(attestationState)}, 'utf8'));`,
      "const index = process.argv.indexOf('--pid');",
      "const record = state[process.argv[index + 1]];",
      "if (index < 0 || !record || process.argv[index + 2] !== '--json') process.exit(2);",
      "process.stdout.write(JSON.stringify({schema:'codex-nofile-attestation-v1',...record}));",
    ].join("\n"), { mode: 0o755 });
    activeIdentity = launchServer();

    const originalIdentity = activeIdentity;
    const fixtureInventory = inventory({
      processes: [processRecord({
        pid: originalIdentity.pid,
        parentPid: originalIdentity.parentPid,
        processGroupId: originalIdentity.processGroupId,
        uid: originalIdentity.uid,
        startTime: originalIdentity.startTime,
        executable: originalIdentity.executable,
        rawCommand: `/usr/local/bin/codex app-server --listen unix://${socket}`,
      })],
      descriptors: {
        [originalIdentity.pid]: { complete: true, count: 1, highest: 3 },
      },
      controlSockets: {
        complete: true,
        items: [{ path: socket, ownerPid: originalIdentity.pid }],
      },
    });
    const runner = (file, args, options = {}) => {
      if (file === codex && args.join(" ") === "app-server daemon version") {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            backend: "pid",
            managedCodexPath: codex,
            socketPath: socket,
          }),
          stderr: "",
        };
      }
      if (file === "/usr/sbin/lsof" && args.join(" ") === "-nP -U -Fpcfn") {
        return runActual(file, [
          "-nP", "-a", "-p", String(activeIdentity.pid), "-U", "-Fpcfn",
        ], options);
      }
      if (file === "/bin/ps" && args.join(" ") === "-axo pid=,ppid=") {
        return {
          status: 0,
          stdout: `${activeIdentity.pid} ${activeIdentity.parentPid}\n`,
          stderr: "",
        };
      }
      return runActual(file, args, options);
    };
    const guardedFs = new Proxy(fs, {
      get(target, property) {
        if (property !== "unlinkSync") return Reflect.get(target, property);
        return (value) => {
          if (path.resolve(value) === socket) throw new Error("cleanup attempted socket unlink");
          return target.unlinkSync(value);
        };
      },
    });
    const dependencies = createDefaultRecycleDependencies({
      inventory: fixtureInventory,
      runner,
      fsApi: guardedFs,
      env: { CODEX_HOME: codexHome },
      uid: process.getuid(),
      signalProcess(pid, signal) {
        signalCalls.push([pid, signal]);
        throw new Error("Agent Utilities must not signal the managed server");
      },
      sleep,
      readyTimeoutMs: 2_000,
      readyPollMs: 20,
      lock: { acquire: () => () => {} },
    });
    dependencies.collectInventory = () => fixtureInventory;
    dependencies.restartManagedExact = ({ expectedIdentity }) => {
      assert.equal(expectedIdentity.pid, activeIdentity.pid);
      assert.equal(expectedIdentity.startTime, activeIdentity.startTime);
      restartCalls += 1;
      stopNativeFixture(activeIdentity);
      if (fs.existsSync(socket)) {
        fs.unlinkSync(socket);
        nativeSocketUnlinks += 1;
      }
      activeIdentity = launchServer();
      return {
        status: "restarted",
        backend: "pid",
        pid: activeIdentity.pid,
        socketPath: socket,
      };
    };
    const options = {
      platform: "darwin",
      uid: process.getuid(),
      pid: originalIdentity.pid,
      unmanaged: false,
      confirmation: null,
      attestorPath: attestor,
      minSoftLimit: 8192,
    };

    const receiptPass = recycleServer(options, dependencies);
    assert.equal(receiptPass.exitCode, EXIT_CODES.refused);
    assert.equal(receiptPass.result.verification.mutationAttempted, false);
    assert.equal(restartCalls, 0);
    const confirmation = receiptPass.result.verification.receipt.confirmationToken;

    const outcome = recycleServer({ ...options, confirmation }, dependencies);

    assert.equal(outcome.exitCode, EXIT_CODES.healthy);
    assert.equal(outcome.result.verification.complete, true);
    assert.equal(restartCalls, 1);
    assert.notEqual(activeIdentity.pid, originalIdentity.pid);
    assert.equal(exactLiveIdentity(originalIdentity.pid), null);
    assert.equal(outcome.result.verification.after.pid, activeIdentity.pid);
    assert.equal(outcome.result.verification.after.socket.ownerPid, activeIdentity.pid);
    assert.equal(outcome.result.verification.after.softNofile, 8192);
    assert.ok(outcome.result.verification.actions.some((action) => action.kind === "native-daemon-restart"));
    assert.deepEqual(signalCalls, []);
    assert.ok(nativeSocketUnlinks <= 1);
  } finally {
    for (const identity of tracked) {
      const current = exactLiveIdentity(identity.pid);
      if (sameExactIdentity(identity, current)) {
        try { process.kill(identity.pid, "SIGKILL"); } catch {}
      }
    }
    try { if (fs.existsSync(socket)) fs.unlinkSync(socket); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("controlled process-group canary signals only fixture identities", {
  timeout: 5_000,
  // macOS-only: drives real spawned processes through the host's exact-identity
  // tooling, which the reaper (a no-op off macOS) only ever runs on darwin.
  // Matches the guard the sibling canary test above already carries.
  skip: process.platform !== "darwin" && "macOS-only host process identity",
}, async () => {
  const childProgram = [
    "process.on('SIGTERM', () => {});",
    "console.log('ready');",
    "setInterval(() => {}, 1000);",
  ].join("");
  const ownerProgram = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], {stdio:['ignore','pipe','ignore']});`,
    "process.on('SIGTERM', () => {});",
    "child.once('exit', () => process.exit(0));",
    "child.stdout.once('data', () => console.log(child.pid));",
    "setInterval(() => {}, 1000);",
  ].join("");
  const owner = spawnChild(process.execPath, ["-e", ownerProgram], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [line] = await once(owner.stdout, "data");
  const childPid = Number(String(line).trim());
  assert.ok(Number.isInteger(childPid) && childPid > 0);

  const uid = process.getuid();
  const observedOwner = collectExactProcessIdentity(owner.pid);
  const observedChild = collectExactProcessIdentity(childPid);
  assert.equal(observedOwner.state, "present");
  assert.equal(observedChild.state, "present");
  const ownerIdentity = {
    role: "server",
    ...observedOwner.identity,
    commandIdentity: "codex app-server",
  };
  const childIdentity = {
    role: "descendant",
    ...observedChild.identity,
    commandIdentity: "process",
  };
  const states = new Map([[owner.pid, ownerIdentity], [childPid, childIdentity]]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    uid,
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      assert.ok(states.has(pid));
      const current = collectExactProcessIdentity(pid);
      assert.equal(current.state, "present");
      assert.ok(sameExactIdentity(states.get(pid), current.identity));
      signals.push([pid, signal]);
      process.kill(pid, signal);
      if (pid === owner.pid || signal === "SIGKILL") states.delete(pid);
    },
    sleep: () => {},
  });

  try {
    const outcome = dependencies.stopUnmanaged({
      owner: ownerIdentity,
      targets: [childIdentity],
    });
    assert.equal(outcome.exitCode, EXIT_CODES.healthy);
    assert.equal(outcome.mutationAttempted, true);
    assert.deepEqual(signals, [
      [childPid, "SIGTERM"],
      [owner.pid, "SIGTERM"],
      [childPid, "SIGKILL"],
    ]);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("fixture owner survived")), 2_000);
      owner.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } finally {
    for (const expected of [childIdentity, ownerIdentity]) {
      const observation = collectExactProcessIdentity(expected.pid);
      if (observation.state === "present" && sameExactIdentity(expected, observation.identity)) {
        try { process.kill(expected.pid, "SIGKILL"); } catch {}
      }
    }
  }
});
