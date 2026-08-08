/** Exact-PID signalling and snapshot reaping. */

import {
  DEFAULT_GRACE_MS,
  DEFAULT_POST_SIGNAL_MS,
  EXIT_CODES,
} from "./constants.mjs";
import {
  collectExactProcessIdentity,
} from "./inventory.mjs";
import {
  CleanupRefusal,
  callerUid,
  identityDifferences,
  refuse,
  sleepSync,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  createMutationLock,
  sameBirthIdentityPresent,
  validateSnapshotObject,
} from "./snapshot.mjs";

export function signalExactPid(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) refuse("signal-target-invalid");
  process.kill(pid, signal);
}

export function emptyReapResult(platform) {
  return {
    schemaVersion: 1,
    action: "reap",
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
      ownerProof: "unverified",
      termPids: [],
      killPids: [],
      postKillVerifiedPids: [],
      snapshot: null,
      controlSockets: [],
      servers: [],
    },
  };
}

export function skippedIdentity(pid, observation, expected) {
  if (observation?.state === "absent") return { pid, reasons: ["already-absent"] };
  if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
    return { pid, reasons: ["identity-unavailable"] };
  }
  const changed = identityDifferences(expected, observation.identity);
  return changed.length
    ? { pid, reasons: changed.map((field) => `identity-changed:${field}`) }
    : null;
}

export function reapSnapshot(snapshot, {
  platform = process.platform,
  uid = callerUid(),
  readIdentity = (pid) => collectExactProcessIdentity(pid),
  signalProcess = signalExactPid,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  lock = createMutationLock({ uid }),
} = {}) {
  const result = emptyReapResult(platform);
  let exitCode = EXIT_CODES.refused;
  let release = null;
  let identityRefused = false;
  let attemptedFailure = false;

  try {
    if (platform !== "darwin") refuse("unsupported-platform");
    validateSnapshotObject(snapshot, uid);
    if (
      !Number.isFinite(graceMs)
      || graceMs < 0
      || graceMs > 10_000
      || !Number.isFinite(postSignalMs)
      || postSignalMs < 0
      || postSignalMs > 10_000
    ) {
      refuse("invalid-grace-period");
    }
    result.verification.snapshot = {
      schema: snapshot.schema,
      ownerPid: snapshot.owner.pid,
      targetPids: snapshot.targets.map((target) => target.pid),
    };
    try {
      release = lock.acquire();
    } catch (error) {
      refuse(error?.code === "mutation-lock-held" || error?.code === "ELOCKED"
        ? "mutation-lock-held"
        : "mutation-lock-unavailable");
    }

    const ownerObservation = readIdentity(snapshot.owner.pid);
    if (ownerObservation?.state === "present" && validObservedIdentity(ownerObservation.identity)) {
      const changed = identityDifferences(snapshot.owner, ownerObservation.identity);
      refuse(changed.length ? "owner-identity-changed" : "owner-still-live");
    }
    if (ownerObservation?.state !== "absent") refuse("owner-evidence-unavailable");
    result.verification.ownerProof = "absent";

    const active = [];
    for (const target of snapshot.targets) {
      const observation = readIdentity(target.pid);
      const skipped = skippedIdentity(target.pid, observation, target);
      if (!skipped) active.push(target);
      else if (skipped.reasons[0] === "already-absent") result.skipped.push(skipped);
      else {
        result.skipped.push(skipped);
        identityRefused = true;
      }
    }
    if (identityRefused) refuse("target-identity-changed");
    result.selected = active.map((target) => ({ pid: target.pid, role: target.role }));

    const termTargets = [];
    for (const target of active) {
      const observation = readIdentity(target.pid);
      const skipped = skippedIdentity(target.pid, observation, target);
      if (skipped) {
        result.skipped.push(skipped);
        if (skipped.reasons[0] !== "already-absent") identityRefused = true;
        if (identityRefused) break;
        continue;
      }
      try {
        result.verification.mutationAttempted = true;
        signalProcess(target.pid, "SIGTERM");
        result.verification.termPids.push(target.pid);
        termTargets.push(target);
      } catch (error) {
        if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
        else {
          attemptedFailure = true;
          result.verification.missingEvidence.push("signal-or-wait-failed");
        }
        if (attemptedFailure) break;
      }
    }

    if (!attemptedFailure && result.verification.termPids.length) {
      try {
        sleep(graceMs);
      } catch {
        attemptedFailure = true;
        result.verification.missingEvidence.push("signal-or-wait-failed");
      }
    }

    const killedTargets = [];
    if (!attemptedFailure) {
      for (const target of termTargets) {
        const observation = readIdentity(target.pid);
        const skipped = skippedIdentity(target.pid, observation, target);
        if (skipped?.reasons[0] === "already-absent") {
          result.skipped.push(skipped);
          continue;
        }
        if (skipped) {
          const reused = !sameBirthIdentityPresent(target, observation);
          result.skipped.push(reused
            ? { pid: target.pid, reasons: ["pid-reused-after-term"] }
            : skipped);
          if (reused) {
            result.verification.postKillVerifiedPids.push(target.pid);
            continue;
          }
          identityRefused = true;
          continue;
        }
        try {
          result.verification.mutationAttempted = true;
          signalProcess(target.pid, "SIGKILL");
          result.verification.killPids.push(target.pid);
          killedTargets.push(target);
        } catch (error) {
          if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
          else {
            attemptedFailure = true;
            result.verification.missingEvidence.push("signal-or-wait-failed");
          }
        }
      }
    }

    if (!attemptedFailure && killedTargets.length) {
      try {
        sleep(postSignalMs);
      } catch {
        attemptedFailure = true;
        result.verification.missingEvidence.push("signal-or-wait-failed");
      }
    }
    if (!attemptedFailure) {
      for (const target of killedTargets) {
        const observation = readIdentity(target.pid);
        if (observation?.state === "absent") {
          result.verification.postKillVerifiedPids.push(target.pid);
          continue;
        }
        if (observation?.state === "present" && validObservedIdentity(observation.identity)) {
          if (!sameBirthIdentityPresent(target, observation)) {
            result.verification.postKillVerifiedPids.push(target.pid);
            result.skipped.push({ pid: target.pid, reasons: ["pid-reused-after-kill"] });
          } else {
            attemptedFailure = true;
            result.verification.missingEvidence.push("post-kill-survivor");
          }
          continue;
        }
        attemptedFailure = true;
        result.verification.missingEvidence.push("post-kill-verification-unknown");
      }
    }

    if (attemptedFailure) {
      result.status = "failed";
      exitCode = EXIT_CODES.failed;
    } else if (identityRefused) {
      result.verification.missingEvidence.push("target-identity-changed");
      if (result.verification.mutationAttempted) {
        result.status = "failed";
        result.verification.missingEvidence.push("incomplete-after-mutation");
        exitCode = EXIT_CODES.failed;
      } else {
        result.status = "refused";
        exitCode = EXIT_CODES.refused;
      }
    } else {
      result.status = "healthy";
      result.verification.complete = true;
      exitCode = EXIT_CODES.healthy;
    }
  } catch (error) {
    const code = error instanceof CleanupRefusal ? error.code : "reap-failed";
    result.status = code === "reap-failed" ? "failed" : "refused";
    result.verification.missingEvidence.push(code);
    exitCode = code === "reap-failed" ? EXIT_CODES.failed : EXIT_CODES.refused;
  } finally {
    if (release) {
      try {
        release();
      } catch {
        result.status = "failed";
        result.verification.complete = false;
        result.verification.missingEvidence.push("mutation-lock-release-failed");
        exitCode = EXIT_CODES.failed;
      }
    }
  }
  result.verification.missingEvidence = unique(result.verification.missingEvidence);
  return { result, exitCode };
}
