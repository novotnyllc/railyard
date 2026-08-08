/** Attestation validation and the dependency bundle recycleServer runs against. */

import fs from "node:fs";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_GRACE_MS,
  DEFAULT_POST_SIGNAL_MS,
  DEFAULT_READY_POLL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  EXIT_CODES,
  LSOF,
  MAX_ATTESTATION_BYTES,
  MAX_PID_RECORD_BYTES,
  PGREP,
  PS,
} from "./constants.mjs";
import {
  collectExactProcessIdentity,
  collectMacOSInventory,
} from "./inventory.mjs";
import {
  CleanupRefusal,
  appServerCommandKind,
  callerUid,
  defaultRunner,
  exactKeys,
  parseControlSockets,
  parseDescriptors,
  refuse,
  safeFailureCode,
  safeRun,
  sha256,
  sleepSync,
  socketPath,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  reapSnapshot,
  signalExactPid,
} from "./reap.mjs";
import {
  createMutationLock,
  exactSnapshotIdentityPresent,
  sameBirthIdentityPresent,
  sameSignalIdentityPresent,
} from "./snapshot.mjs";

export function defaultCanonicalPath(value, fsApi = fs) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("path-not-absolute");
  return (fsApi.realpathSync.native ?? fsApi.realpathSync)(value);
}

export function sameFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

export function boundRegularFile(value, fsApi, { readContents = false, checkExecutable = false } = {}) {
  let descriptor = null;
  try {
    const canonical = defaultCanonicalPath(value, fsApi);
    const before = fsApi.lstatSync(canonical);
    if (before.isSymbolicLink() || !before.isFile()) return null;
    descriptor = fsApi.openSync(
      canonical,
      fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW,
    );
    const opened = fsApi.fstatSync(descriptor);
    if (!opened.isFile() || !sameFileStat(before, opened)) return null;
    const contents = readContents ? fsApi.readFileSync(descriptor) : null;
    let executable = false;
    if (checkExecutable) {
      try {
        fsApi.accessSync(canonical, fsApi.constants.X_OK);
        executable = true;
      } catch {}
    }
    const after = fsApi.fstatSync(descriptor);
    const named = fsApi.lstatSync(canonical);
    if (!sameFileStat(opened, after) || !sameFileStat(after, named)) return null;
    return {
      path: canonical,
      stat: after,
      contents,
      executable,
    };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function defaultFileIdentity(value, fsApi = fs) {
  const bound = boundRegularFile(value, fsApi, { readContents: true, checkExecutable: true });
  if (!bound) return null;
  return {
    path: bound.path,
    dev: bound.stat.dev,
    ino: bound.stat.ino,
    mode: bound.stat.mode,
    nlink: bound.stat.nlink,
    mtimeMs: bound.stat.mtimeMs,
    size: bound.stat.size,
    digest: sha256(bound.contents),
    uid: bound.stat.uid,
    regular: true,
    symlink: false,
    executable: bound.executable,
  };
}

export function defaultFileReference(value, fsApi = fs) {
  const bound = boundRegularFile(value, fsApi);
  return bound ? { path: bound.path, dev: bound.stat.dev, ino: bound.stat.ino } : null;
}

export function parseBoundedJsonRun(run, code) {
  if (run?.status !== 0 || run.error || run.signal || typeof run.stdout !== "string") refuse(code);
  const raw = run.stdout.trim();
  if (!raw || Buffer.byteLength(raw) > MAX_ATTESTATION_BYTES) refuse(code);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse(code);
    return parsed;
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    refuse(code);
  }
}

export function runForJson(runner, file, args, code, options = {}) {
  let run;
  try {
    run = runner(file, args, options);
  } catch {
    refuse(code);
  }
  return parseBoundedJsonRun(run, code);
}

export function normalizeRecordedStartTime(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

export function readNativePidRecord({ fsApi, codexHome, uid }) {
  const file = path.join(codexHome, "app-server-daemon", "app-server.pid");
  let before;
  try {
    before = fsApi.lstatSync(file);
  } catch (error) {
    return error?.code === "ENOENT" ? { state: "absent" } : { state: "invalid" };
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== uid
    || before.nlink !== 1
    || (before.mode & 0o022) !== 0
    || before.size <= 0
    || before.size > MAX_PID_RECORD_BYTES
  ) return { state: "invalid" };

  let descriptor = null;
  try {
    descriptor = fsApi.openSync(file, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.uid !== uid
      || opened.nlink !== 1
      || (opened.mode & 0o022) !== 0
      || opened.size <= 0
      || opened.size > MAX_PID_RECORD_BYTES
    ) return { state: "invalid" };
    const parsed = JSON.parse(fsApi.readFileSync(descriptor, "utf8"));
    const processStartTime = normalizeRecordedStartTime(parsed?.processStartTime);
    if (
      !exactKeys(parsed, ["pid", "processStartTime"])
      || !Number.isInteger(parsed.pid)
      || parsed.pid <= 0
      || !processStartTime
    ) return { state: "invalid" };
    return {
      state: "valid",
      uid,
      regular: true,
      symlink: false,
      pid: parsed.pid,
      processStartTime,
    };
  } catch {
    return { state: "invalid" };
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function nativeDaemonVersion(runner, executable) {
  const parsed = runForJson(
    runner,
    executable,
    ["app-server", "daemon", "version"],
    "daemon-version-unavailable",
  );
  if (
    parsed.status !== "running"
    || !Object.hasOwn(parsed, "backend")
    || (parsed.backend !== null && parsed.backend !== "pid")
    || typeof parsed.managedCodexPath !== "string"
    || typeof parsed.socketPath !== "string"
  ) refuse("daemon-version-invalid");
  return {
    status: parsed.status,
    backend: parsed.backend,
    managedCodexPath: parsed.managedCodexPath,
    socketPath: parsed.socketPath,
  };
}

export function socketOwnersForPath(socket, { runner, readIdentity, canonicalPath, ownerPid }) {
  const run = safeRun(runner, LSOF, ["-nP", "-U", "-Fpcfn"]);
  if (run.status !== 0) refuse("daemon-socket-ownership-unavailable");
  const owners = [];
  for (const item of parseControlSockets(run.stdout)) {
    let observedPath;
    try {
      observedPath = canonicalPath(item.path);
    } catch {
      if (path.resolve(item.path) === path.resolve(socket)) {
        refuse("daemon-socket-ownership-ambiguous");
      }
      continue;
    }
    if (observedPath !== socket) continue;
    if (item.ownerPid !== ownerPid) {
      const command = safeRun(runner, PS, ["-p", String(item.ownerPid), "-o", "command="]);
      if (command.status !== 0 || appServerCommandKind(command.stdout.trim()) !== "proxy") {
        owners.push({ pid: item.ownerPid, uid: -1 });
      }
      continue;
    }
    const observation = readIdentity(item.ownerPid, { runner });
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("daemon-socket-ownership-unavailable");
    }
    owners.push({ pid: item.ownerPid, uid: observation.identity.uid });
  }
  return [...new Map(owners.map((owner) => [`${owner.pid}:${owner.uid}`, owner])).values()];
}

export function exactTreeSignalOrder(snapshot) {
  const byPid = new Map(snapshot.targets.map((target) => [target.pid, target]));
  const depths = new Map();
  for (const target of snapshot.targets) {
    if (target.role !== "descendant") {
      depths.set(target.pid, 0);
      continue;
    }
    const chain = [];
    let current = target;
    while (current?.role === "descendant" && !depths.has(current.pid)) {
      chain.push(current);
      const parent = byPid.get(current.parentPid);
      if (!parent) break;
      current = parent;
    }
    let depth = depths.has(current?.pid) ? depths.get(current.pid) + 1 : 0;
    while (chain.length) {
      const item = chain.pop();
      depths.set(item.pid, depth);
      depth += 1;
    }
  }
  return [
    ...snapshot.targets.slice().sort((left, right) => (
      depths.get(right.pid) - depths.get(left.pid) || right.pid - left.pid
    )),
    snapshot.owner,
  ];
}

export function stopExactUnmanagedTree(snapshot, {
  readIdentity,
  signalProcess,
  sleep,
  graceMs,
  postSignalMs,
}) {
  const ordered = exactTreeSignalOrder(snapshot);
  let mutationAttempted = false;
  const outcome = (exitCode, failureCode = null) => ({ exitCode, mutationAttempted, failureCode });
  try {
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (!exactSnapshotIdentityPresent(expected, observation)) {
        return outcome(EXIT_CODES.refused, "unmanaged-identity-changed");
      }
      try {
        signalProcess(expected.pid, "SIGTERM");
        mutationAttempted = true;
      } catch (error) {
        if (error?.code !== "ESRCH") return outcome(EXIT_CODES.failed, "unmanaged-term-failed");
      }
    }
    sleep(graceMs);
    const killed = [];
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (
        observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !sameBirthIdentityPresent(expected, observation)
      ) continue;
      if (!sameSignalIdentityPresent(expected, observation)) {
        return outcome(EXIT_CODES.failed, "unmanaged-post-term-identity-unverified");
      }
      try {
        signalProcess(expected.pid, "SIGKILL");
        mutationAttempted = true;
        killed.push(expected);
      } catch (error) {
        if (error?.code !== "ESRCH") return outcome(EXIT_CODES.failed, "unmanaged-kill-failed");
      }
    }
    if (killed.length) sleep(postSignalMs);
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (
        observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !sameBirthIdentityPresent(expected, observation)
      ) continue;
      return outcome(EXIT_CODES.failed, "unmanaged-survivor");
    }
    return outcome(EXIT_CODES.healthy);
  } catch {
    return outcome(
      mutationAttempted ? EXIT_CODES.failed : EXIT_CODES.refused,
      mutationAttempted ? "unmanaged-stop-evidence-failed" : "unmanaged-preflight-evidence-failed",
    );
  }
}

export function directChildCount(pid, runner) {
  const run = safeRun(runner, PGREP, ["-P", String(pid)]);
  if (run.status === 1 && !run.stdout.trim()) return 0;
  if (run.status !== 0) return null;
  const values = run.stdout.split(/\r?\n/).filter(Boolean);
  return values.every((value) => /^\d+$/.test(value) && Number(value) > 0)
    ? new Set(values).size
    : null;
}

export function descriptorMetrics(pid, runner) {
  const run = safeRun(runner, LSOF, ["-nP", "-a", "-p", String(pid), "-Ff"]);
  return run.status === 0 ? parseDescriptors(run.stdout) : { complete: false };
}

export function strictLauncherPath({ explicit, env, fsApi }) {
  if (explicit) return explicit;
  if (env.RAILYARD_CODEX_BIN) return env.RAILYARD_CODEX_BIN;
  const candidates = [];
  for (const directory of String(env.PATH ?? "").split(path.delimiter)) {
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, "codex"));
  }
  candidates.push(path.join(os.homedir(), ".local", "bin", "codex"));
  for (const candidate of unique(candidates)) {
    try {
      fsApi.accessSync(candidate, fsApi.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function createDefaultRecycleDependencies({
  inventory,
  runner = defaultRunner,
  fsApi = fs,
  env = process.env,
  uid = callerUid(),
  readIdentity = null,
  signalProcess = signalExactPid,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyPollMs = DEFAULT_READY_POLL_MS,
  monotonicNow = () => performance.now(),
  lock = createMutationLock({ fsApi, uid }),
  spawnProcess = spawn,
} = {}) {
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  readIdentity ??= (pid, { runner: identityRunner = runner } = {}) => (
    collectExactProcessIdentity(pid, { runner: identityRunner })
  );
  const canonicalPath = (value) => defaultCanonicalPath(value, fsApi);
  const fileIdentity = (value) => defaultFileIdentity(value, fsApi);
  const fileReference = (value) => defaultFileReference(value, fsApi);
  return {
    inventory,
    collectInventory() {
      return collectMacOSInventory({ runner, platform: "darwin" });
    },
    readIdentity,
    canonicalPath,
    fileIdentity,
    sampleDaemonEvidence({ socket, executable, ownerPid }) {
      const version = nativeDaemonVersion(runner, executable.path);
      const canonicalSocket = canonicalPath(version.socketPath);
      const managedPath = canonicalPath(version.managedCodexPath);
      let managedExecutable = null;
      if (version.backend === "pid") {
        managedExecutable = fileReference(managedPath);
      }
      return {
        version: {
          status: version.status,
          backend: version.backend,
          socketPath: canonicalSocket,
          managedCodexPath: managedPath,
        },
        socketOwners: socketOwnersForPath(socket, {
          runner,
          readIdentity,
          canonicalPath,
          ownerPid,
        }),
        managedExecutable,
        pidRecord: readNativePidRecord({ fsApi, codexHome, uid }),
      };
    },
    attestNofile(identity, { attestorPath }) {
      return runForJson(
        runner,
        attestorPath,
        ["--pid", String(identity.pid), "--json"],
        "pid-nofile-attestation-unavailable",
      );
    },
    attestLauncher(launcher, { attestorPath }) {
      return runForJson(
        runner,
        attestorPath,
        ["--launcher", launcher.path, "--json"],
        "launcher-nofile-attestation-unavailable",
      );
    },
    reapResidue(snapshot) {
      return reapSnapshot(snapshot, {
        platform: "darwin",
        uid,
        readIdentity,
        signalProcess,
        sleep,
        graceMs,
        postSignalMs,
        lock: { acquire: () => () => {} },
      });
    },
    stopUnmanaged(snapshot) {
      return stopExactUnmanagedTree(snapshot, {
        readIdentity,
        signalProcess,
        sleep,
        graceMs,
        postSignalMs,
      });
    },
    launchUnmanaged({ launcher, socketPath }) {
      try {
        const child = spawnProcess(
          launcher,
          ["app-server", "--listen", `unix://${socketPath}`],
          { detached: true, stdio: "ignore", shell: false },
        );
        child.once("error", () => {});
        child.unref();
        return { pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null };
      } catch {
        return { pid: null };
      }
    },
    waitForReady({ pid, socketPath, mode, executable }) {
      const deadline = monotonicNow() + readyTimeoutMs;
      const remainingTime = () => Math.floor(deadline - monotonicNow());
      const boundedRunner = (file, args) => {
        const timeout = remainingTime();
        return timeout > 0
          ? runner(file, args, { timeout })
          : { status: null, stdout: "", stderr: "", error: true };
      };
      let lastFailureCode = "replacement-readiness-timeout";
      do {
        try {
          const identity = readIdentity(pid, { runner: boundedRunner });
          if (
            identity?.state !== "present"
            || !validObservedIdentity(identity.identity)
            || identity.identity.pid !== pid
          ) {
            lastFailureCode = "replacement-identity-not-ready";
          } else {
            const version = nativeDaemonVersion(boundedRunner, executable);
            let failureCode = null;
            if (canonicalPath(version.socketPath) !== socketPath) {
              failureCode = "replacement-socket-path-mismatch";
            } else if (!((mode === "managed" && version.backend === "pid")
              || (mode === "unmanaged" && version.backend === null))) {
              failureCode = "replacement-daemon-mode-mismatch";
            }
            let owners;
            if (!failureCode) {
              owners = socketOwnersForPath(socketPath, {
                runner: boundedRunner,
                readIdentity,
                canonicalPath,
                ownerPid: pid,
              });
              if (owners.length !== 1 || owners[0].pid !== pid || owners[0].uid !== uid) {
                failureCode = "replacement-socket-ownership-mismatch";
              }
            }
            const descriptors = failureCode ? null : descriptorMetrics(pid, boundedRunner);
            if (!failureCode && !descriptors.complete) {
              failureCode = "replacement-descriptors-unavailable";
            }
            const directChildren = failureCode ? null : directChildCount(pid, boundedRunner);
            if (!failureCode && !Number.isInteger(directChildren)) {
              failureCode = "replacement-child-baseline-unavailable";
            }
            if (!failureCode) {
              return {
                identity: identity.identity,
                socket: { path: socketPath, ready: true, owners },
                descriptors: { count: descriptors.count, highest: descriptors.highest },
                directChildren,
              };
            }
            lastFailureCode = failureCode;
          }
        } catch (error) {
          lastFailureCode = safeFailureCode(
            error?.code,
            "replacement-readiness-evidence-unavailable",
          );
        }
        const remaining = remainingTime();
        if (remaining <= 0) break;
        sleep(Math.min(readyPollMs, remaining));
      } while (true);
      return { failureCode: lastFailureCode };
    },
    lock,
  };
}
