/** The recycle state machine. */

import {
  EXIT_CODES,
} from "./constants.mjs";
import {
  childrenByParent,
  classifyInventory,
  descendantsOf,
} from "./inventory.mjs";
import {
  CleanupRefusal,
  callerUid,
  exactKeys,
  refuse,
  safeFailureCode,
  sha256,
  stableJson,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  applicableParentOrRefuse,
  assertExpectedIdentityGone,
  assertGuiPreserved,
  assertOldTreeGone,
  auditProxySelection,
  buildRecycleReceipt,
  canonicalPathOrRefuse,
  emptyRecycleResult,
  executableEvidenceOrRefuse,
  guiBaselinesOrRefuse,
  normalizeDaemonSample,
  normalizedSocketOwners,
  revalidateExecutableEvidence,
  revalidateSnapshot,
  validateLauncherNofileAttestation,
  validatePidNofileAttestation,
} from "./recycle-evidence.mjs";
import {
  buildExactTreeSnapshot,
  exactSnapshotIdentityPresent,
  snapshotIdentity,
} from "./snapshot.mjs";

export function recycleServer(options, deps) {
  const platform = options?.platform ?? process.platform;
  const uid = options?.uid ?? callerUid();
  const result = emptyRecycleResult(platform);
  let exitCode = EXIT_CODES.refused;
  let release = null;

  try {
    if (platform !== "darwin") refuse("unsupported-platform");
    if (!Number.isInteger(options?.pid) || options.pid <= 0) refuse("recycle-pid-required");
    if (!Number.isInteger(options?.minSoftLimit) || options.minSoftLimit <= 0) {
      refuse("invalid-minimum-soft-limit");
    }
    if (!deps?.inventory || typeof deps.readIdentity !== "function") refuse("recycle-evidence-unavailable");
    if (
      typeof deps.canonicalPath !== "function"
      || typeof deps.fileIdentity !== "function"
      || typeof deps.sampleDaemonEvidence !== "function"
    ) refuse("recycle-evidence-unavailable");

    const classified = classifyInventory(deps.inventory, { now: options.now ?? Date.now() });
    result.verification.servers = classified.result.verification.servers;
    result.verification.controlSockets = classified.result.verification.controlSockets;
    if (
      !classified.result.verification.complete
      || classified.result.verification.missingEvidence.length
    ) refuse("inventory-incomplete");
    const server = classified.result.verification.servers.find((candidate) => candidate.pid === options.pid);
    if (!server) refuse("selected-pid-not-app-server");
    if (server.classification === "gui") refuse("selected-server-is-gui");
    if (server.classification !== "detached" || server.missingEvidence.length) {
      refuse("selected-server-ambiguous");
    }
    if (server.uid !== uid) refuse("selected-server-wrong-user");
    if (server.controlSocket.state !== "owned" || server.controlSocket.ownerPid !== server.pid) {
      refuse("selected-socket-ambiguous");
    }
    const socket = canonicalPathOrRefuse(
      server.controlSocket.path,
      deps.canonicalPath,
      "selected-socket-ambiguous",
    );
    auditProxySelection(deps.inventory, server, socket, deps.canonicalPath);

    const narrowedInspection = {
      selected: [{ pid: server.pid }],
      verification: { servers: classified.result.verification.servers },
    };
    const snapshot = buildExactTreeSnapshot({
      inventory: deps.inventory,
      inspection: narrowedInspection,
      readIdentity: deps.readIdentity,
      now: options.now ?? Date.now(),
      uid,
    });
    const guiBaselines = guiBaselinesOrRefuse(
      classified.result.verification.servers,
      deps.readIdentity,
    );
    const parent = applicableParentOrRefuse(server, deps.inventory, deps.readIdentity, uid);
    const executable = executableEvidenceOrRefuse(snapshot.owner.executable, {
      canonicalPath: deps.canonicalPath,
      fileIdentity: deps.fileIdentity,
      uid,
      code: "selected-executable-invalid",
      requireOwner: true,
    });
    if (executable.path !== snapshot.owner.executable) refuse("selected-executable-noncanonical");

    const mode = options.unmanaged === true ? "unmanaged" : "managed";
    result.verification.mode = mode;
    const takeDaemonSample = (owner = snapshot.owner, sampleExecutable = executable) => normalizeDaemonSample(
      deps.sampleDaemonEvidence({ socket, executable: sampleExecutable, ownerPid: owner.pid }),
      {
        mode,
        owner,
        socket,
        executable: sampleExecutable,
        uid,
        canonicalPath: deps.canonicalPath,
      },
    );
    const firstSample = takeDaemonSample();
    const secondSample = takeDaemonSample();
    if (stableJson(firstSample) !== stableJson(secondSample)) refuse("daemon-attestation-unstable");

    if (!options.attestorPath) refuse("nofile-attestor-required");
    const attestor = executableEvidenceOrRefuse(options.attestorPath, {
      canonicalPath: deps.canonicalPath,
      fileIdentity: deps.fileIdentity,
      uid,
      code: "nofile-attestor-invalid",
      requireOwner: true,
    });
    if (typeof deps.attestNofile !== "function") refuse("nofile-attestor-unavailable");

    let launcher = null;
    let launcherNofileAttestation = null;
    let replacementExecutable = executable;
    if (mode === "unmanaged") {
      if (!options.launcher) refuse("unmanaged-launcher-required");
      launcher = executableEvidenceOrRefuse(options.launcher, {
        canonicalPath: deps.canonicalPath,
        fileIdentity: deps.fileIdentity,
        uid,
        code: "unmanaged-launcher-invalid",
        requireOwner: true,
      });
      if (typeof deps.attestLauncher !== "function") refuse("launcher-attestor-unavailable");
      launcherNofileAttestation = deps.attestLauncher(launcher, {
        attestorPath: attestor.path,
      });
      revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      replacementExecutable = executableEvidenceOrRefuse(
        launcherNofileAttestation?.replacementExecutable,
        {
          canonicalPath: deps.canonicalPath,
          fileIdentity: deps.fileIdentity,
          uid,
          code: "replacement-executable-invalid",
          requireOwner: true,
        },
      );
      validateLauncherNofileAttestation(
        launcherNofileAttestation,
        launcher,
        replacementExecutable,
        options.minSoftLimit,
      );
    }

    const initialOwner = deps.readIdentity(snapshot.owner.pid);
    if (!exactSnapshotIdentityPresent(snapshot.owner, initialOwner)) refuse("recycle-identity-changed");
    const oldNofileAttestation = deps.attestNofile(initialOwner.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    validatePidNofileAttestation(oldNofileAttestation, initialOwner.identity, 1);

    const daemonEvidenceDigest = sha256(stableJson(secondSample));
    const authorization = {
      minimumSoftNofile: options.minSoftLimit,
      attestor,
      launcher,
      replacementExecutable,
      oldNofileAttestation,
      launcherNofileAttestation,
    };
    const receipt = buildRecycleReceipt(
      snapshot,
      mode,
      socket,
      daemonEvidenceDigest,
      authorization,
      parent,
    );
    result.verification.receipt = receipt;
    result.verification.before = {
      pid: snapshot.owner.pid,
      identity: receipt.server,
      parent: receipt.parent,
      socket: { path: socket, ownerPid: snapshot.owner.pid },
      targetPids: snapshot.targets.map((target) => target.pid),
      daemonEvidenceDigest,
      softNofile: oldNofileAttestation.softNofile,
    };
    const selectedRoles = new Map([
      [snapshot.owner.pid, "server"],
      ...snapshot.targets.map((target) => [target.pid, target.role]),
    ]);
    result.selected = receipt.selectedPids.map((pid) => ({
      pid,
      role: selectedRoles.get(pid) ?? "target",
    }));
    if (mode === "managed" && typeof deps.restartManagedExact !== "function") {
      refuse("managed-restart-exact-pid-unsupported");
    }
    if (!options.confirmation) refuse("confirmation-required");
    if (options.confirmation !== receipt.confirmationToken) refuse("confirmation-mismatch");

    if (!deps.lock || typeof deps.lock.acquire !== "function") refuse("mutation-lock-unavailable");
    try {
      release = deps.lock.acquire();
    } catch (error) {
      refuse(error?.code === "ELOCKED" || error?.code === "mutation-lock-held"
        ? "mutation-lock-held"
        : "mutation-lock-unavailable");
    }
    revalidateExecutableEvidence(executable, deps, uid, "selected-executable-changed");
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    if (launcher) revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
    if (replacementExecutable !== executable) {
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
    }

    const finalSample = takeDaemonSample();
    if (stableJson(secondSample) !== stableJson(finalSample)) refuse("daemon-attestation-unstable");
    revalidateSnapshot(snapshot, deps.readIdentity);
    if (parent && !exactSnapshotIdentityPresent(parent, deps.readIdentity(parent.pid))) {
      refuse("parent-evidence-changed");
    }
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    const freshOwner = deps.readIdentity(snapshot.owner.pid);
    if (!exactSnapshotIdentityPresent(snapshot.owner, freshOwner)) refuse("recycle-identity-changed");
    const lockedOldNofileAttestation = deps.attestNofile(freshOwner.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const oldSoftNofile = validatePidNofileAttestation(
      lockedOldNofileAttestation,
      freshOwner.identity,
      1,
    );
    if (stableJson(lockedOldNofileAttestation) !== stableJson(oldNofileAttestation)) {
      refuse("pid-nofile-attestation-changed");
    }
    if (launcher) {
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      const lockedLauncherNofileAttestation = deps.attestLauncher(launcher, {
        attestorPath: attestor.path,
      });
      revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      validateLauncherNofileAttestation(
        lockedLauncherNofileAttestation,
        launcher,
        replacementExecutable,
        options.minSoftLimit,
      );
      if (stableJson(lockedLauncherNofileAttestation) !== stableJson(launcherNofileAttestation)) {
        refuse("launcher-nofile-attestation-changed");
      }
    }
    result.verification.before.softNofile = oldSoftNofile;

    if (typeof deps.collectInventory !== "function") refuse("proxy-recheck-unavailable");
    const lockedInventory = deps.collectInventory();
    const lockedClassified = classifyInventory(lockedInventory, { now: options.now ?? Date.now() });
    if (
      !lockedClassified.result.verification.complete
      || lockedClassified.result.verification.missingEvidence.length
    ) refuse("inventory-recheck-incomplete");
    const lockedServer = lockedClassified.result.verification.servers.find((item) => item.pid === snapshot.owner.pid);
    if (!lockedServer || lockedServer.classification !== "detached") {
      refuse("selected-server-recheck-incomplete");
    }
    const lockedProxyPids = auditProxySelection(
      lockedInventory,
      lockedServer,
      socket,
      deps.canonicalPath,
    );
    const confirmedProxyPids = snapshot.targets
      .filter((target) => target.role === "proxy")
      .map((target) => target.pid)
      .sort((left, right) => left - right);
    if (stableJson(lockedProxyPids) !== stableJson(confirmedProxyPids)) refuse("proxy-set-changed");
    const lockedChildren = childrenByParent(lockedInventory.processes ?? []);
    const lockedTargetPids = unique([
      ...descendantsOf(snapshot.owner.pid, lockedChildren).descendants.map((item) => item.pid),
      ...lockedProxyPids,
    ]).filter((pid) => pid !== snapshot.owner.pid).sort((left, right) => left - right);
    const confirmedTargetPids = snapshot.targets
      .map((target) => target.pid)
      .sort((left, right) => left - right);
    if (stableJson(lockedTargetPids) !== stableJson(confirmedTargetPids)) refuse("exact-tree-changed");

    revalidateSnapshot(snapshot, deps.readIdentity);
    if (parent && !exactSnapshotIdentityPresent(parent, deps.readIdentity(parent.pid))) {
      refuse("parent-evidence-changed");
    }
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    const mutationSample = takeDaemonSample();
    if (stableJson(secondSample) !== stableJson(mutationSample)) refuse("daemon-attestation-unstable");

    let replacementPid;
    if (mode === "managed") {
      if (typeof deps.reapResidue !== "function") refuse("residue-reaper-unavailable");
      revalidateExecutableEvidence(executable, deps, uid, "selected-executable-changed");
      result.verification.mutationAttempted = true;
      let restarted;
      try {
        restarted = deps.restartManagedExact({
          executable: executable.path,
          expectedIdentity: receipt.server,
          socketPath: socket,
        });
      } catch {
        refuse("managed-restart-failed");
      }
      if (
        !restarted
        || restarted.status !== "restarted"
        || restarted.backend !== "pid"
        || !Number.isInteger(restarted.pid)
        || restarted.pid <= 0
        || restarted.pid === snapshot.owner.pid
        || canonicalPathOrRefuse(restarted.socketPath, deps.canonicalPath, "managed-restart-invalid") !== socket
      ) refuse("managed-restart-invalid");
      replacementPid = restarted.pid;
      result.verification.actions.push({ kind: "native-daemon-restart", oldPid: snapshot.owner.pid, newPid: replacementPid });
      const residue = deps.reapResidue(snapshot);
      if (residue?.exitCode !== EXIT_CODES.healthy) {
        refuse(safeFailureCode(
          residue?.result?.verification?.missingEvidence?.[0],
          "residue-reap-incomplete",
        ));
      }
      result.verification.actions.push({
        kind: "reap-exact-residue",
        pids: snapshot.targets.map((target) => target.pid),
      });
    } else {
      if (typeof deps.stopUnmanaged !== "function" || typeof deps.launchUnmanaged !== "function") {
        refuse("unmanaged-lifecycle-unavailable");
      }
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
      const stopped = deps.stopUnmanaged(snapshot);
      result.verification.mutationAttempted = stopped?.mutationAttempted === true;
      if (stopped?.exitCode !== EXIT_CODES.healthy) {
        refuse(safeFailureCode(stopped?.failureCode, "unmanaged-stop-incomplete"));
      }
      result.verification.actions.push({
        kind: "stop-exact-unmanaged-tree",
        pids: receipt.selectedPids,
      });
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
      result.verification.mutationAttempted = true;
      const launched = deps.launchUnmanaged({ launcher: launcher.path, socketPath: socket });
      if (!Number.isInteger(launched?.pid) || launched.pid <= 0 || launched.pid === snapshot.owner.pid) {
        refuse("unmanaged-launch-invalid");
      }
      replacementPid = launched.pid;
      result.verification.actions.push({ kind: "launch-selected-wrapper", pid: replacementPid, launcher: launcher.path });
    }

    if (typeof deps.waitForReady !== "function") refuse("readiness-verifier-unavailable");
    const ready = deps.waitForReady({
      pid: replacementPid,
      socketPath: socket,
      mode,
      executable: replacementExecutable.path,
    });
    if (!ready) refuse("replacement-readiness-timeout");
    if (ready.failureCode) {
      refuse(safeFailureCode(ready.failureCode, "replacement-readiness-timeout"));
    }
    if (
      !validObservedIdentity(ready.identity)
      || ready.identity.pid !== replacementPid
      || ready.identity.uid !== uid
      || ready.identity.executable !== replacementExecutable.path
    ) refuse("replacement-identity-invalid");
    const freshReplacement = deps.readIdentity(replacementPid);
    if (!exactSnapshotIdentityPresent(ready.identity, freshReplacement)) {
      refuse("replacement-identity-changed");
    }
    revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
    takeDaemonSample(freshReplacement.identity, replacementExecutable);
    const readySocket = canonicalPathOrRefuse(ready.socket?.path, deps.canonicalPath, "replacement-socket-invalid");
    const readyOwners = normalizedSocketOwners(ready.socket?.owners);
    if (
      ready.socket?.ready !== true
      || readySocket !== socket
      || readyOwners.length !== 1
      || readyOwners[0].pid !== replacementPid
      || readyOwners[0].uid !== uid
    ) refuse("replacement-socket-invalid");
    if (
      !exactKeys(ready.descriptors, ["count", "highest"])
      || !Number.isInteger(ready.descriptors.count)
      || ready.descriptors.count < 0
      || (ready.descriptors.highest !== null
        && (!Number.isInteger(ready.descriptors.highest) || ready.descriptors.highest < 0))
      || !Number.isInteger(ready.directChildren)
      || ready.directChildren < 0
    ) refuse("replacement-metrics-invalid");
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const replacementNofileAttestation = deps.attestNofile(freshReplacement.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const replacementSoftNofile = validatePidNofileAttestation(
      replacementNofileAttestation,
      freshReplacement.identity,
      options.minSoftLimit,
    );
    assertOldTreeGone(snapshot, deps.readIdentity);
    assertExpectedIdentityGone(
      parent,
      deps.readIdentity,
      "old-parent-survivor",
      "old-parent-verification-unknown",
    );
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    result.verification.after = {
      pid: replacementPid,
      identity: snapshotIdentity(freshReplacement.identity, "server"),
      socket: { path: readySocket, ownerPid: replacementPid, ready: true },
      softNofile: replacementSoftNofile,
      descriptors: { count: ready.descriptors.count, highest: ready.descriptors.highest },
      directChildren: ready.directChildren,
      oldTreeGone: true,
      oldParent: parent ? { pid: parent.pid, gone: true } : { applicable: false },
    };
    result.verification.guiPreserved = true;
    result.verification.complete = true;
    result.status = "healthy";
    exitCode = EXIT_CODES.healthy;
  } catch (error) {
    const code = error instanceof CleanupRefusal ? error.code : "recycle-evidence-failed";
    result.verification.missingEvidence.push(code);
    if (result.verification.mutationAttempted) {
      result.status = "failed";
      exitCode = EXIT_CODES.failed;
    } else {
      result.status = "refused";
      exitCode = EXIT_CODES.refused;
    }
  } finally {
    if (release) {
      try {
        release();
      } catch {
        result.verification.missingEvidence.push("mutation-lock-release-failed");
        result.verification.complete = false;
        if (result.verification.mutationAttempted) {
          result.status = "failed";
          exitCode = EXIT_CODES.failed;
        } else {
          result.status = "refused";
          exitCode = EXIT_CODES.refused;
        }
      }
    }
  }
  result.verification.missingEvidence = unique(result.verification.missingEvidence);
  return { result, exitCode };
}
