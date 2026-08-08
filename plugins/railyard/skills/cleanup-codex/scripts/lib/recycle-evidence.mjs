/** Recycle attestation, identity, and GUI-preservation evidence checks. */

import path from "node:path";

import {
  LAUNCHER_NOFILE_ATTESTATION_SCHEMA,
  PID_NOFILE_ATTESTATION_SCHEMA,
  RECYCLE_CONFIRMATION_PREFIX,
  RECYCLE_RECEIPT_SCHEMA,
} from "./constants.mjs";
import {
  isGuiHost,
  proxySocketAssociation,
  proxySocketFor,
} from "./inventory.mjs";
import {
  appServerCommandKind,
  exactKeys,
  identityDifferences,
  refuse,
  sha256,
  stableJson,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  exactSnapshotIdentityPresent,
  sameBirthIdentityPresent,
  snapshotIdentity,
} from "./snapshot.mjs";

export function recycleConfirmationToken(receiptEvidence) {
  return `${RECYCLE_CONFIRMATION_PREFIX}${sha256(stableJson(receiptEvidence))}`;
}

export function emptyRecycleResult(platform) {
  return {
    schemaVersion: 1,
    action: "recycle",
    status: "refused",
    selected: [],
    skipped: [],
    warnings: [],
    verification: {
      platform,
      readOnly: false,
      mutationAttempted: false,
      complete: false,
      missingEvidence: [],
      mode: null,
      receipt: null,
      before: null,
      actions: [],
      after: null,
      guiPreserved: false,
      controlSockets: [],
      servers: [],
    },
  };
}

export function canonicalPathOrRefuse(value, canonicalPath, code) {
  if (typeof value !== "string" || !path.isAbsolute(value)) refuse(code);
  let canonical;
  try {
    canonical = canonicalPath(value);
  } catch {
    refuse(code);
  }
  if (typeof canonical !== "string" || !path.isAbsolute(canonical)) refuse(code);
  return canonical;
}

export function executableEvidenceOrRefuse(value, {
  canonicalPath,
  fileIdentity,
  uid,
  code,
  requireOwner = false,
}) {
  const canonical = canonicalPathOrRefuse(value, canonicalPath, code);
  let evidence;
  try {
    evidence = fileIdentity(canonical);
  } catch {
    refuse(code);
  }
  if (
    !evidence
    || evidence.path !== canonical
    || !Number.isInteger(evidence.dev)
    || !Number.isInteger(evidence.ino)
    || !Number.isInteger(evidence.mode)
    || !Number.isInteger(evidence.nlink)
    || !Number.isFinite(evidence.mtimeMs)
    || !Number.isInteger(evidence.size)
    || typeof evidence.digest !== "string"
    || !/^[0-9a-f]{64}$/.test(evidence.digest)
    || evidence.regular !== true
    || evidence.symlink !== false
    || evidence.executable !== true
    || evidence.nlink !== 1
    || (evidence.mode & 0o022) !== 0
    || (evidence.mode & 0o6000) !== 0
    || (requireOwner && evidence.uid !== 0 && evidence.uid !== uid)
  ) refuse(code);
  return {
    path: canonical,
    dev: evidence.dev,
    ino: evidence.ino,
    mode: evidence.mode & 0o777,
    nlink: evidence.nlink,
    mtimeMs: evidence.mtimeMs,
    size: evidence.size,
    digest: evidence.digest,
    ...(Number.isInteger(evidence.uid) ? { uid: evidence.uid } : {}),
  };
}

export function revalidateExecutableEvidence(expected, dependencies, uid, code) {
  const current = executableEvidenceOrRefuse(expected.path, {
    canonicalPath: dependencies.canonicalPath,
    fileIdentity: dependencies.fileIdentity,
    uid,
    code,
    requireOwner: true,
  });
  if (
    current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.mode !== expected.mode
    || current.nlink !== expected.nlink
    || current.mtimeMs !== expected.mtimeMs
    || current.size !== expected.size
    || current.digest !== expected.digest
  ) refuse(code);
  return current;
}

export function normalizedSocketOwners(owners) {
  if (!Array.isArray(owners)) refuse("daemon-socket-ownership-ambiguous");
  const normalized = owners.map((owner) => {
    if (!exactKeys(owner, ["pid", "uid"]) || !Number.isInteger(owner.pid) || !Number.isInteger(owner.uid)) {
      refuse("daemon-socket-ownership-ambiguous");
    }
    return { pid: owner.pid, uid: owner.uid };
  }).sort((left, right) => left.pid - right.pid || left.uid - right.uid);
  if (new Set(normalized.map((owner) => `${owner.pid}:${owner.uid}`)).size !== normalized.length) {
    refuse("daemon-socket-ownership-ambiguous");
  }
  return normalized;
}

export function normalizeDaemonSample(sample, {
  mode,
  owner,
  socket,
  executable,
  uid,
  canonicalPath,
}) {
  if (!exactKeys(sample, ["managedExecutable", "pidRecord", "socketOwners", "version"])) {
    refuse("daemon-attestation-invalid");
  }
  if (!exactKeys(sample.version, ["backend", "managedCodexPath", "socketPath", "status"])) {
    refuse("daemon-attestation-invalid");
  }
  const observedSocket = canonicalPathOrRefuse(
    sample.version.socketPath,
    canonicalPath,
    "daemon-socket-path-invalid",
  );
  if (sample.version.status !== "running" || observedSocket !== socket) {
    refuse("daemon-attestation-conflict");
  }
  const socketOwners = normalizedSocketOwners(sample.socketOwners);
  if (
    socketOwners.length !== 1
    || socketOwners[0].pid !== owner.pid
    || socketOwners[0].uid !== uid
  ) refuse("daemon-socket-ownership-conflict");

  let configuredManagedPath = null;
  if (mode === "managed") {
    if (sample.version.backend !== "pid") refuse("managed-daemon-attestation-missing");
    const managedPath = canonicalPathOrRefuse(
      sample.version.managedCodexPath,
      canonicalPath,
      "managed-executable-invalid",
    );
    if (managedPath !== executable.path) refuse("managed-executable-conflict");
    if (
      !exactKeys(sample.managedExecutable, ["dev", "ino", "path"])
      || canonicalPathOrRefuse(sample.managedExecutable.path, canonicalPath, "managed-executable-invalid") !== executable.path
      || sample.managedExecutable.dev !== executable.dev
      || sample.managedExecutable.ino !== executable.ino
    ) refuse("managed-executable-conflict");
    if (
      !exactKeys(sample.pidRecord, [
        "pid",
        "processStartTime",
        "regular",
        "state",
        "symlink",
        "uid",
      ])
      || sample.pidRecord.state !== "valid"
      || sample.pidRecord.regular !== true
      || sample.pidRecord.symlink !== false
      || sample.pidRecord.pid !== owner.pid
      || sample.pidRecord.uid !== uid
      || sample.pidRecord.processStartTime !== owner.startTime
    ) refuse("managed-pid-record-conflict");
  } else {
    if (sample.version.backend !== null) {
      refuse("unmanaged-daemon-attestation-conflict");
    }
    if (sample.version.managedCodexPath !== null) {
      configuredManagedPath = canonicalPathOrRefuse(
        sample.version.managedCodexPath,
        canonicalPath,
        "unmanaged-daemon-attestation-conflict",
      );
    }
    if (sample.managedExecutable !== null || !exactKeys(sample.pidRecord, ["state"])) {
      refuse("unmanaged-daemon-attestation-conflict");
    }
    if (sample.pidRecord.state !== "absent") refuse("unmanaged-daemon-attestation-conflict");
  }

  return {
    version: {
      status: "running",
      backend: sample.version.backend,
      socketPath: observedSocket,
      managedCodexPath: mode === "managed" ? executable.path : configuredManagedPath,
    },
    socketOwners,
    managedExecutable: mode === "managed"
      ? { path: executable.path, dev: executable.dev, ino: executable.ino }
      : null,
    pidRecord: mode === "managed"
      ? {
          state: "valid",
          uid,
          regular: true,
          symlink: false,
          pid: owner.pid,
          processStartTime: owner.startTime,
        }
      : { state: "absent" },
  };
}

export function buildRecycleReceipt(snapshot, mode, socket, daemonEvidenceDigest, authorization, parent) {
  const core = {
    schema: RECYCLE_RECEIPT_SCHEMA,
    mode,
    socketPath: socket,
    daemonEvidenceDigest,
    minimumSoftNofile: authorization.minimumSoftNofile,
    attestor: authorization.attestor,
    launcher: authorization.launcher,
    replacementExecutable: authorization.replacementExecutable,
    oldNofileAttestation: authorization.oldNofileAttestation,
    launcherNofileAttestation: authorization.launcherNofileAttestation,
    server: snapshotIdentity(snapshot.owner, snapshot.owner.role),
    parent: parent ? snapshotIdentity(parent, parent.role) : null,
    targets: snapshot.targets.map((target) => snapshotIdentity(target, target.role)),
    selectedPids: [snapshot.owner.pid, ...snapshot.targets.map((target) => target.pid)]
      .sort((left, right) => left - right),
  };
  const confirmationToken = recycleConfirmationToken(core);
  return {
    ...core,
    digest: confirmationToken.slice(RECYCLE_CONFIRMATION_PREFIX.length),
    confirmationToken,
  };
}

export function applicableParentOrRefuse(server, inventory, readIdentity, uid) {
  if (!Number.isInteger(server.parentPid) || server.parentPid <= 1) return null;
  const recorded = (inventory.processes ?? []).find((item) => item.pid === server.parentPid);
  if (!recorded) refuse("parent-evidence-unavailable");
  if (isGuiHost(recorded)) return null;
  if (recorded.executable !== server.executable) return null;
  let observation;
  try {
    observation = readIdentity(server.parentPid);
  } catch {
    refuse("parent-evidence-unavailable");
  }
  if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
    refuse("parent-evidence-unavailable");
  }
  const identity = observation.identity;
  if (identity.uid !== uid || identity.executable !== server.executable) return null;
  if (identityDifferences(
    recorded,
    identity,
    ["pid", "parentPid", "processGroupId", "startTime"],
  ).length) refuse("parent-evidence-changed");
  return snapshotIdentity(identity, "parent");
}

export function assertExpectedIdentityGone(expected, readIdentity, survivorCode, unknownCode) {
  if (!expected) return;
  let observation;
  try {
    observation = readIdentity(expected.pid);
  } catch {
    refuse(unknownCode);
  }
  if (observation?.state === "absent") return;
  if (
    observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && !sameBirthIdentityPresent(expected, observation)
  ) return;
  refuse(observation?.state === "present" ? survivorCode : unknownCode);
}

export function revalidateSnapshot(snapshot, readIdentity) {
  for (const expected of [snapshot.owner, ...snapshot.targets]) {
    let observation;
    try {
      observation = readIdentity(expected.pid);
    } catch {
      refuse("recycle-identity-unavailable");
    }
    if (!exactSnapshotIdentityPresent(expected, observation)) refuse("recycle-identity-changed");
  }
}

export function validatePidNofileAttestation(attestation, identity, minimum = 1) {
  if (
    !exactKeys(attestation, ["pid", "processStartTime", "schema", "softNofile", "uid"])
    || attestation.schema !== PID_NOFILE_ATTESTATION_SCHEMA
    || attestation.pid !== identity.pid
    || attestation.uid !== identity.uid
    || attestation.processStartTime !== identity.startTime
    || !Number.isInteger(attestation.softNofile)
    || attestation.softNofile < minimum
  ) refuse("pid-nofile-attestation-invalid");
  return attestation.softNofile;
}

export function validateLauncherNofileAttestation(attestation, launcher, replacementExecutable, minimum) {
  if (
    !exactKeys(attestation, ["dev", "ino", "path", "replacementExecutable", "schema", "softNofile"])
    || attestation.schema !== LAUNCHER_NOFILE_ATTESTATION_SCHEMA
    || attestation.path !== launcher.path
    || attestation.dev !== launcher.dev
    || attestation.ino !== launcher.ino
    || attestation.replacementExecutable !== replacementExecutable.path
    || !Number.isInteger(attestation.softNofile)
    || attestation.softNofile < minimum
  ) refuse("launcher-nofile-attestation-invalid");
  return attestation.softNofile;
}

export function assertOldTreeGone(snapshot, readIdentity) {
  for (const expected of [snapshot.owner, ...snapshot.targets]) {
    assertExpectedIdentityGone(
      expected,
      readIdentity,
      "old-tree-survivor",
      "old-tree-verification-unknown",
    );
  }
}

export function guiBaselinesOrRefuse(servers, readIdentity) {
  return servers.filter((server) => server.classification === "gui").map((server) => {
    let observation;
    try {
      observation = readIdentity(server.pid);
    } catch {
      refuse("gui-baseline-unavailable");
    }
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("gui-baseline-unavailable");
    }
    return observation.identity;
  });
}

export function assertGuiPreserved(guiBaselines, readIdentity) {
  for (const expected of guiBaselines) {
    let observation;
    try {
      observation = readIdentity(expected.pid);
    } catch {
      refuse("gui-preservation-unverified");
    }
    if (!exactSnapshotIdentityPresent(expected, observation)) refuse("gui-preservation-failed");
  }
}

export function auditProxySelection(inventory, server, socket, canonicalPath) {
  const linked = [];
  for (const proxy of (inventory.processes ?? [])
    .filter((record) => appServerCommandKind(record.rawCommand) === "proxy")
    .sort((left, right) => left.pid - right.pid)) {
    const evidence = proxySocketFor(inventory.proxySockets, proxy.pid);
    const association = proxySocketAssociation(evidence, inventory.controlSockets);
    if (!association) refuse("unclassified-proxy");
    const proxySocket = canonicalPathOrRefuse(association.path, canonicalPath, "unclassified-proxy");
    if (proxySocket === socket) {
      if (association.ownerPid !== server.pid) refuse("unclassified-proxy");
      linked.push(proxy.pid);
    }
  }
  const classified = (server.remoteProxyClients ?? []).map((proxy) => {
    if (proxy.commandIdentity !== "codex app-server proxy") refuse("unclassified-proxy");
    return proxy.pid;
  }).sort((left, right) => left - right);
  if (stableJson(linked) !== stableJson(classified)) refuse("proxy-selection-incomplete");
  return linked;
}
