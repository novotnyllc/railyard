/** Exact-PID signalling and snapshot reaping. */

import {
  DEFAULT_GRACE_MS,
  DEFAULT_POST_SIGNAL_MS,
} from "./constants.mjs";
import {
  collectExactProcessIdentity,
} from "./inventory.mjs";
import {
  callerUid,
  identityDifferences,
  refuse,
  sleepSync,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  birthVerdict,
  createMutationLock,
  sameBirthIdentityPresent,
  validateSnapshotObject,
} from "./snapshot.mjs";
import { runMutation } from "./transaction.mjs";

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

// The residue reaper a recycle hands its dependencies: reapSnapshot bound to
// the recycle's own reader, signaller and sleep, with no lock of its own
// because the recycle already holds it.
export function residueReaper({ uid, readIdentity, signalProcess, sleep, graceMs, postSignalMs }) {
  return (snapshot, { ownerReplacement = null } = {}) => reapSnapshot(snapshot, {
    platform: "darwin",
    uid,
    readIdentity,
    signalProcess,
    sleep,
    graceMs,
    postSignalMs,
    lock: { acquire: () => () => {} },
    ownerReplacement,
  });
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
  // Recycle only: the exact new birth of the replacement server, which may
  // hold the owner's PID or an old target's PID.
  ownerReplacement = null,
} = {}) {
  const result = emptyReapResult(platform);
  return runMutation(result, { lock }, {
    unexpectedCode: "reap-failed",
    errorsFail: true,
    prepare() {
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
    },
    mutate: () => reapLocked(snapshot, result, {
      readIdentity,
      signalProcess,
      sleep,
      graceMs,
      postSignalMs,
      ownerReplacement,
    }),
  });
}

// Everything reap does under the lock. Returns the failure codes of an
// attempted reap, recorded as they happen so an exception later in the pass
// keeps them; refuses (throws) while nothing has been signalled.
function reapLocked(snapshot, result, {
  readIdentity,
  signalProcess,
  sleep,
  graceMs,
  postSignalMs,
  ownerReplacement,
}) {
  const failures = [];
  let identityRefused = false;
  let attemptedFailure = false;
  const fail = (code) => {
    attemptedFailure = true;
    failures.push(code);
    result.verification.missingEvidence.push(code);
  };

  const ownerObservation = readIdentity(snapshot.owner.pid);
  const replacedByKnownBirth = Boolean(ownerReplacement)
    && ownerObservation?.state === "present"
    && validObservedIdentity(ownerObservation.identity)
    && ownerObservation.identity.pid === ownerReplacement.pid
    && ownerObservation.identity.startTime === ownerReplacement.startTime
    && ownerReplacement.startTime !== snapshot.owner.startTime;
  if (replacedByKnownBirth) {
    result.verification.ownerProof = "replaced";
  } else {
    if (ownerObservation?.state === "present" && validObservedIdentity(ownerObservation.identity)) {
      const changed = identityDifferences(snapshot.owner, ownerObservation.identity);
      refuse(changed.length ? "owner-identity-changed" : "owner-still-live");
    }
    if (ownerObservation?.state !== "absent") refuse("owner-evidence-unavailable");
    result.verification.ownerProof = "absent";
  }

  const active = [];
  for (const target of snapshot.targets) {
    const observation = readIdentity(target.pid);
    if (
      ownerReplacement
      && target.pid === ownerReplacement.pid
      && observation?.state === "present"
      && validObservedIdentity(observation.identity)
      && observation.identity.startTime === ownerReplacement.startTime
      && ownerReplacement.startTime !== target.startTime
    ) {
      result.skipped.push({ pid: target.pid, reasons: ["replaced-by-recycle"] });
      continue;
    }
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
        fail("signal-or-wait-failed");
      }
      if (attemptedFailure) break;
    }
  }

  if (!attemptedFailure && result.verification.termPids.length) {
    try {
      sleep(graceMs);
    } catch {
      fail("signal-or-wait-failed");
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
          fail("signal-or-wait-failed");
        }
      }
    }
  }

  if (!attemptedFailure && killedTargets.length) {
    try {
      sleep(postSignalMs);
    } catch {
      fail("signal-or-wait-failed");
    }
  }
  if (!attemptedFailure) {
    for (const target of killedTargets) {
      const observation = readIdentity(target.pid);
      const verdict = birthVerdict(target, observation);
      if (verdict === "gone") {
        result.verification.postKillVerifiedPids.push(target.pid);
        if (observation.state !== "absent") {
          result.skipped.push({ pid: target.pid, reasons: ["pid-reused-after-kill"] });
        }
        continue;
      }
      fail(verdict === "present" ? "post-kill-survivor" : "post-kill-verification-unknown");
    }
  }

  if (attemptedFailure) return failures;
  if (identityRefused) {
    // Before any signal an identity change is a refusal; after one it is an
    // incomplete reap.
    if (!result.verification.mutationAttempted) refuse("target-identity-changed");
    return ["target-identity-changed", "incomplete-after-mutation"];
  }
  return [];
}
