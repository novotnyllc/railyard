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
import { LOCK_HELD_BY_CALLER, runMutation } from "./transaction.mjs";

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
// the recycle's own reader, signaller and sleep, under the mutation lock the
// recycle already holds.
export function residueReaper({ uid, readIdentity, signalProcess, sleep, graceMs, postSignalMs }) {
  return (snapshot, { ownerReplacement = null } = {}) => reapSnapshot(snapshot, {
    platform: "darwin",
    uid,
    readIdentity,
    signalProcess,
    sleep,
    graceMs,
    postSignalMs,
    lock: LOCK_HELD_BY_CALLER,
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
    // An unexpected error fails a reap even before a signal: exit 3 means "look".
    unexpected: { code: "reap-failed", status: "failed" },
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
    mutate: (plan, txn) => reapLocked(snapshot, result, txn, {
      readIdentity,
      signalProcess,
      sleep,
      graceMs,
      postSignalMs,
      ownerReplacement,
    }),
  });
}

// Everything reap does under the lock. A failure after a signal is recorded
// on `txn` as it happens and ends the signalling; anything before a signal
// refuses.
function reapLocked(snapshot, result, txn, {
  readIdentity,
  signalProcess,
  sleep,
  graceMs,
  postSignalMs,
  ownerReplacement,
}) {
  let identityRefused = false;

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
      txn.attempted();
      signalProcess(target.pid, "SIGTERM");
      result.verification.termPids.push(target.pid);
      termTargets.push(target);
    } catch (error) {
      if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
      else {
        txn.fail("signal-or-wait-failed");
      }
      if (txn.hasFailed) break;
    }
  }

  if (!txn.hasFailed && result.verification.termPids.length) {
    try {
      sleep(graceMs);
    } catch {
      txn.fail("signal-or-wait-failed");
    }
  }

  const killedTargets = [];
  if (!txn.hasFailed) {
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
        txn.attempted();
        signalProcess(target.pid, "SIGKILL");
        result.verification.killPids.push(target.pid);
        killedTargets.push(target);
      } catch (error) {
        if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
        else {
          txn.fail("signal-or-wait-failed");
        }
      }
    }
  }

  if (!txn.hasFailed && killedTargets.length) {
    try {
      sleep(postSignalMs);
    } catch {
      txn.fail("signal-or-wait-failed");
    }
  }
  if (!txn.hasFailed) {
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
      txn.fail(verdict === "present" ? "post-kill-survivor" : "post-kill-verification-unknown");
    }
  }

  if (txn.hasFailed || !identityRefused) return;
  // Before any signal an identity change is a refusal; after one it is an
  // incomplete reap.
  if (!txn.hasAttempted) refuse("target-identity-changed");
  txn.fail("target-identity-changed");
  txn.fail("incomplete-after-mutation");
}
