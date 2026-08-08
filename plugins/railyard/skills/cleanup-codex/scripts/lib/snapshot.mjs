/** Refusals, exact-identity validation, the tree snapshot file, and the mutation lock. */

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  HOOK_COMMAND_TIMEOUT_MS,
  MAX_SNAPSHOT_BYTES,
  PS,
  SNAPSHOT_SCHEMA,
} from "./constants.mjs";
import {
  childrenByParent,
  descendantsOf,
  proxySocketAssociation,
  proxySocketFor,
} from "./inventory.mjs";
import {
  BIRTH_IDENTITY_FIELDS,
  CleanupRefusal,
  REVALIDATED_IDENTITY_FIELDS,
  callerUid,
  defaultRunner,
  exactKeys,
  identityDifferences,
  parsePsOutput,
  refuse,
  safeRun,
  unique,
  validIsoTime,
  validObservedIdentity,
} from "./process-evidence.mjs";

export const SNAPSHOT_KEYS = ["createdAt", "createdByUid", "owner", "schema", "targets"];

export const SNAPSHOT_IDENTITY_KEYS = [
  "commandIdentity",
  "executable",
  "parentPid",
  "pid",
  "processGroupId",
  "role",
  "startTime",
  "uid",
];

export function validSnapshotIdentity(identity, uid, roles) {
  if (!exactKeys(identity, SNAPSHOT_IDENTITY_KEYS)) return false;
  if (!roles.includes(identity.role)) return false;
  if (!validObservedIdentity(identity) || identity.uid !== uid) return false;
  if (identity.role === "server" && identity.commandIdentity !== "codex app-server") return false;
  if (identity.role === "descendant" && identity.commandIdentity !== "process") return false;
  if (identity.role === "proxy" && identity.commandIdentity !== "codex app-server proxy") return false;
  return true;
}

export function validateSnapshotObject(snapshot, uid) {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)) refuse("snapshot-schema-invalid");
  if (snapshot.schema !== SNAPSHOT_SCHEMA || !validIsoTime(snapshot.createdAt)) {
    refuse("snapshot-schema-invalid");
  }
  if (!Number.isInteger(snapshot.createdByUid) || snapshot.createdByUid !== uid) {
    refuse("snapshot-schema-invalid");
  }
  if (!validSnapshotIdentity(snapshot.owner, uid, ["server"])) refuse("snapshot-schema-invalid");
  if (!Array.isArray(snapshot.targets) || snapshot.targets.length > 10_000) {
    refuse("snapshot-schema-invalid");
  }

  const targets = new Map();
  for (const target of snapshot.targets) {
    if (!validSnapshotIdentity(target, uid, ["descendant", "proxy"])) {
      refuse("snapshot-schema-invalid");
    }
    if (target.pid === snapshot.owner.pid || targets.has(target.pid)) refuse("snapshot-schema-invalid");
    targets.set(target.pid, target);
  }
  const reachesOwner = new Set([snapshot.owner.pid]);
  for (const target of snapshot.targets.filter((item) => item.role === "descendant")) {
    const chain = [];
    const seen = new Set();
    let current = target;
    while (!reachesOwner.has(current.pid)) {
      if (seen.has(current.pid)) refuse("snapshot-schema-invalid");
      seen.add(current.pid);
      chain.push(current.pid);
      if (current.parentPid === snapshot.owner.pid) break;
      const parent = targets.get(current.parentPid);
      if (!parent || parent.role !== "descendant") refuse("snapshot-schema-invalid");
      current = parent;
    }
    for (const pid of chain) reachesOwner.add(pid);
  }
  return snapshot;
}

export function snapshotIdentity(identity, role) {
  return {
    role,
    pid: identity.pid,
    parentPid: identity.parentPid,
    processGroupId: identity.processGroupId,
    uid: identity.uid,
    startTime: identity.startTime,
    executable: identity.executable,
    commandIdentity: role === "server"
      ? "codex app-server"
      : role === "proxy"
        ? "codex app-server proxy"
        : "process",
  };
}

export function buildExactTreeSnapshot({
  inventory,
  inspection,
  readIdentity,
  now = Date.now(),
  uid = callerUid(),
}) {
  if (inspection?.selected?.length !== 1) refuse("snapshot-selection-ambiguous");
  const ownerPid = inspection.selected[0].pid;
  const server = inspection.verification?.servers?.find((item) => item.pid === ownerPid);
  if (!server || server.classification !== "detached" || server.missingEvidence.length) {
    refuse("snapshot-selection-ambiguous");
  }
  const ownerObservation = readIdentity(ownerPid);
  if (ownerObservation?.state !== "present" || !validObservedIdentity(ownerObservation.identity)) {
    refuse("snapshot-owner-unavailable");
  }
  const owner = ownerObservation.identity;
  if (
    owner.uid !== uid
    || identityDifferences(server, owner).length
    || server.parentPid !== owner.parentPid
  ) refuse("snapshot-owner-changed");

  const processes = Array.isArray(inventory.processes) ? inventory.processes : [];
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const children = childrenByParent(processes);
  const descendantPids = descendantsOf(ownerPid, children).descendants.map((item) => item.pid);
  const proxyPids = (server.remoteProxyClients ?? []).flatMap((proxy) => {
    if (proxy.commandIdentity !== "codex app-server proxy") return [];
    const association = proxySocketAssociation(
      proxySocketFor(inventory.proxySockets, proxy.pid),
      inventory.controlSockets,
    );
    if (association?.ownerPid !== ownerPid) refuse("snapshot-proxy-unclassified");
    return [proxy.pid];
  });
  const proxySet = new Set(proxyPids);
  const targetPids = unique([...descendantPids, ...proxyPids])
    .filter((pid) => pid !== ownerPid)
    .sort((left, right) => left - right);
  const targets = [];
  for (const pid of targetPids) {
    const recorded = byPid.get(pid);
    if (!recorded) refuse("snapshot-tree-changed");
    const observation = readIdentity(pid);
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("snapshot-target-unavailable");
    }
    const identity = observation.identity;
    if (
      identity.uid !== uid
      || identityDifferences(recorded, identity, ["pid", "uid", "startTime", "processGroupId"]).length
      || recorded.parentPid !== identity.parentPid
    ) refuse("snapshot-tree-changed");
    targets.push(snapshotIdentity(identity, proxySet.has(pid) ? "proxy" : "descendant"));
  }

  const timestamp = typeof now === "function" ? now() : now;
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    createdAt: new Date(timestamp).toISOString(),
    createdByUid: uid,
    owner: snapshotIdentity(owner, "server"),
    targets,
  };
  return validateSnapshotObject(snapshot, uid);
}

export function snapshotFileStat(stat, uid) {
  if (stat.isSymbolicLink?.()) refuse("snapshot-file-symlink");
  if (!stat.isFile?.()) refuse("snapshot-file-type");
  if (stat.uid !== uid) refuse("snapshot-file-owner");
  if ((stat.mode & 0o777) !== 0o600) refuse("snapshot-file-mode");
  if (stat.nlink !== 1) refuse("snapshot-file-links");
}

export function lstatOrNull(fsApi, file) {
  try {
    return fsApi.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    refuse("snapshot-file-unavailable");
  }
}

export function unlinkMatchingInode(fsApi, file, expected) {
  if (!expected) return false;
  const retired = path.join(
    path.dirname(file),
    `.cleanup-codex-${randomBytes(12).toString("hex")}.retired`,
  );
  try {
    const current = fsApi.lstatSync(file);
    if (current.isSymbolicLink() || !current.isFile()
      || current.dev !== expected.dev || current.ino !== expected.ino
      || current.uid !== expected.uid) {
      return false;
    }
    fsApi.renameSync(file, retired);
    const moved = fsApi.lstatSync(retired);
    if (moved.isSymbolicLink() || !moved.isFile()
      || moved.dev !== expected.dev || moved.ino !== expected.ino
      || moved.uid !== expected.uid) {
      try {
        if (moved.isFile() && !moved.isSymbolicLink()) {
          fsApi.linkSync(retired, file);
          fsApi.unlinkSync(retired);
        }
      } catch {}
      return false;
    }
    fsApi.unlinkSync(retired);
    return true;
  } catch {
    return false;
  }
}

export function writeSnapshotAtomic(file, snapshot, {
  fsApi = fs,
  uid = callerUid(),
  token = randomBytes(12).toString("hex"),
} = {}) {
  validateSnapshotObject(snapshot, uid);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) refuse("snapshot-file-size");
  const destination = path.resolve(file);
  const existing = lstatOrNull(fsApi, destination);
  if (existing?.isSymbolicLink?.()) refuse("snapshot-file-symlink");
  if (existing) refuse("snapshot-file-exists");
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${token}.tmp`);
  let descriptor = null;
  let temporaryIdentity = null;
  let destinationPublished = false;
  try {
    const flags = fsApi.constants.O_WRONLY
      | fsApi.constants.O_CREAT
      | fsApi.constants.O_EXCL
      | fsApi.constants.O_NOFOLLOW;
    descriptor = fsApi.openSync(temporary, flags, 0o600);
    temporaryIdentity = fsApi.fstatSync(descriptor);
    fsApi.fchmodSync(descriptor, 0o600);
    fsApi.writeFileSync(descriptor, serialized, "utf8");
    fsApi.fsyncSync(descriptor);
    snapshotFileStat(fsApi.fstatSync(descriptor), uid);
    fsApi.closeSync(descriptor);
    descriptor = null;
    fsApi.linkSync(temporary, destination);
    destinationPublished = true;
    fsApi.unlinkSync(temporary);
    snapshotFileStat(fsApi.lstatSync(destination), uid);
    return snapshot;
  } catch (error) {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
    if (destinationPublished) unlinkMatchingInode(fsApi, destination, temporaryIdentity);
    unlinkMatchingInode(fsApi, temporary, temporaryIdentity);
    if (error instanceof CleanupRefusal) throw error;
    if (error?.code === "EEXIST") refuse("snapshot-file-exists");
    refuse("snapshot-write-failed");
  }
}

export function readSnapshotSecure(file, {
  fsApi = fs,
  uid = callerUid(),
} = {}) {
  const source = path.resolve(file);
  const before = lstatOrNull(fsApi, source);
  if (!before) refuse("snapshot-file-missing");
  snapshotFileStat(before, uid);
  if (before.size <= 0 || before.size > MAX_SNAPSHOT_BYTES) refuse("snapshot-file-size");
  let descriptor = null;
  try {
    descriptor = fsApi.openSync(source, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    snapshotFileStat(opened, uid);
    if (opened.dev !== before.dev || opened.ino !== before.ino) refuse("snapshot-file-changed");
    const raw = fsApi.readFileSync(descriptor, "utf8");
    const after = fsApi.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) refuse("snapshot-file-changed");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      refuse("snapshot-schema-invalid");
    }
    return validateSnapshotObject(parsed, uid);
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    if (error?.code === "ELOOP") refuse("snapshot-file-symlink");
    refuse("snapshot-file-unavailable");
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
}

export function processBirthObservation(pid, runner = defaultRunner) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown" };
  const run = safeRun(runner, PS, [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,pgid=,uid=,lstart=,comm=",
  ], { timeout: HOOK_COMMAND_TIMEOUT_MS });
  if (run.status === 1 && !run.stdout.trim()) return { state: "absent" };
  if (run.status !== 0) return { state: "unknown" };
  const rows = parsePsOutput(run.stdout, "psCommand").parsed;
  const identity = rows.length === 1 && rows[0].pid === pid ? rows[0] : null;
  return identity
    ? { state: "present", uid: identity.uid, startTime: identity.startTime }
    : { state: rows.length ? "unknown" : "absent" };
}

export function reclaimDeadMutationLock(fsApi, lockPath, uid, pidIsAlive, readProcessBirth) {
  let before;
  let descriptor = null;
  try {
    before = fsApi.lstatSync(lockPath);
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || before.uid !== uid
      || before.nlink !== 1
      || (before.mode & 0o777) !== 0o600
      || before.size <= 0
      || before.size > 1024
    ) return false;
    descriptor = fsApi.openSync(lockPath, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return false;
    const owner = JSON.parse(fsApi.readFileSync(descriptor, "utf8"));
    const legacy = exactKeys(owner, ["pid", "uid"]);
    const birthBound = exactKeys(owner, ["pid", "uid", "startTime"])
      && validIsoTime(owner.startTime);
    if (
      (!legacy && !birthBound)
      || !Number.isInteger(owner.pid)
      || owner.pid <= 0
      || owner.uid !== uid
    ) return false;
    if (birthBound) {
      const observed = readProcessBirth(owner.pid);
      if (
        observed?.state !== "absent"
        && !(observed?.state === "present" && observed.startTime !== owner.startTime)
      ) return false;
    } else if (pidIsAlive(owner.pid) !== false) return false;
    const current = fsApi.lstatSync(lockPath);
    if (
      current.isSymbolicLink()
      || !current.isFile()
      || current.uid !== uid
      || current.dev !== opened.dev
      || current.ino !== opened.ino
    ) return false;
    fsApi.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function createMutationLock({
  fsApi = fs,
  uid = callerUid(),
  lockPath = path.join(os.tmpdir(), `railyard-cleanup-codex-${uid}.lock`),
  pidIsAlive = processLiveness,
  readProcessBirth = processBirthObservation,
} = {}) {
  return {
    acquire() {
      let descriptor;
      let createdIdentity = null;
      try {
        reclaimDeadMutationLock(fsApi, lockPath, uid, pidIsAlive, readProcessBirth);
        const owner = readProcessBirth(process.pid);
        if (owner?.state !== "present" || owner.uid !== uid || !validIsoTime(owner.startTime)) {
          refuse("mutation-lock-unavailable");
        }
        const flags = fsApi.constants.O_WRONLY
          | fsApi.constants.O_CREAT
          | fsApi.constants.O_EXCL
          | fsApi.constants.O_NOFOLLOW;
        descriptor = fsApi.openSync(lockPath, flags, 0o600);
        createdIdentity = fsApi.fstatSync(descriptor);
        fsApi.fchmodSync(descriptor, 0o600);
        fsApi.writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          uid,
          startTime: owner.startTime,
        })}\n`, "utf8");
        fsApi.fsyncSync(descriptor);
        const held = fsApi.fstatSync(descriptor);
        if (
          !held.isFile()
          || held.uid !== uid
          || (held.mode & 0o777) !== 0o600
          || held.dev !== createdIdentity.dev
          || held.ino !== createdIdentity.ino
        ) {
          refuse("mutation-lock-unsafe");
        }
        return () => {
          try {
            if (!unlinkMatchingInode(fsApi, lockPath, held)) refuse("mutation-lock-changed");
          } finally {
            fsApi.closeSync(descriptor);
          }
        };
      } catch (error) {
        if (descriptor !== undefined) {
          try { fsApi.closeSync(descriptor); } catch {}
        }
        unlinkMatchingInode(fsApi, lockPath, createdIdentity);
        if (error instanceof CleanupRefusal) throw error;
        if (error?.code === "EEXIST" || error?.code === "ELOOP") {
          const locked = new CleanupRefusal("mutation-lock-held");
          locked.cause = error;
          throw locked;
        }
        refuse("mutation-lock-unavailable");
      }
    },
  };
}

export function sameSignalIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(expected, observation.identity, REVALIDATED_IDENTITY_FIELDS).length === 0;
}

export function sameBirthIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(expected, observation.identity, BIRTH_IDENTITY_FIELDS).length === 0;
}

export function exactSnapshotIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(
      expected,
      observation.identity,
      ["pid", "parentPid", "processGroupId", "uid", "startTime", "executable"],
    ).length === 0;
}
