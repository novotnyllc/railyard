// The shared mutation runner: prepare, confirm, lock, mutate, and settle.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CleanupRefusal,
  EXIT_CODES,
  acquireMutationLock,
  exitCodeForStatus,
  recycleDesktop,
  recycleServer,
  reapSnapshot,
  refuse,
  runMutation,
} from "./cleanup-codex.mjs";

import {
  confirmedRecycleOptions,
  desktopHarness,
  desktopOptions,
  recycleHarness,
} from "./test-support.mjs";

function emptyResult() {
  return {
    status: "refused",
    verification: { mutationAttempted: false, complete: false, missingEvidence: [] },
  };
}

function countingLock({ acquireError = null, releaseError = null } = {}) {
  const calls = { acquire: 0, release: 0 };
  return {
    calls,
    acquire() {
      calls.acquire += 1;
      if (acquireError) throw acquireError;
      return () => {
        calls.release += 1;
        if (releaseError) throw releaseError;
      };
    },
  };
}

function run({ lock = countingLock(), confirmation = null, ...steps } = {}) {
  const result = emptyResult();
  const outcome = runMutation(result, { lock, confirmation }, {
    unexpectedCode: "unexpected",
    prepare: () => ({ token: "RECYCLE token" }),
    mutate: () => [],
    ...steps,
  });
  assert.equal(outcome.result, result);
  return { ...outcome, lock };
}

test("exit codes follow the status names", () => {
  assert.equal(exitCodeForStatus("healthy"), EXIT_CODES.healthy);
  assert.equal(exitCodeForStatus("warning"), EXIT_CODES.warning);
  assert.equal(exitCodeForStatus("refused"), EXIT_CODES.refused);
  assert.equal(exitCodeForStatus("failed"), EXIT_CODES.failed);
  assert.equal(exitCodeForStatus("unknown-status"), EXIT_CODES.failed);
});

test("a completed mutation is healthy and releases the lock once", () => {
  const { result, exitCode, lock } = run();
  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.status, "healthy");
  assert.equal(result.verification.complete, true);
  assert.deepEqual(result.verification.missingEvidence, []);
  assert.deepEqual(lock.calls, { acquire: 1, release: 1 });
});

test("a refusal while preparing never takes the lock or mutates", () => {
  let mutated = false;
  const { result, exitCode, lock } = run({
    prepare: () => refuse("inventory-incomplete"),
    mutate: () => {
      mutated = true;
      return [];
    },
  });
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.status, "refused");
  assert.deepEqual(result.verification.missingEvidence, ["inventory-incomplete"]);
  assert.equal(mutated, false);
  assert.deepEqual(lock.calls, { acquire: 0, release: 0 });
});

test("a token mode refuses a missing or mismatched confirmation before the lock", () => {
  for (const [confirmation, code] of [[null, "confirmation-required"], ["RECYCLE other", "confirmation-mismatch"]]) {
    let mutated = false;
    const { result, exitCode, lock } = run({
      confirmation,
      confirmToken: (plan) => plan.token,
      mutate: () => {
        mutated = true;
        return [];
      },
    });
    assert.equal(exitCode, EXIT_CODES.refused, code);
    assert.deepEqual(result.verification.missingEvidence, [code]);
    assert.equal(mutated, false);
    assert.equal(lock.calls.acquire, 0);
  }
  const confirmed = run({ confirmation: "RECYCLE token", confirmToken: (plan) => plan.token });
  assert.equal(confirmed.exitCode, EXIT_CODES.healthy);
});

test("a mode without a token needs no confirmation", () => {
  const { exitCode } = run({ confirmation: null });
  assert.equal(exitCode, EXIT_CODES.healthy);
});

test("the plan from prepare reaches mutate", () => {
  let seen = null;
  run({
    prepare: () => ({ receipt: 7 }),
    mutate: (plan) => {
      seen = plan;
      return [];
    },
  });
  assert.deepEqual(seen, { receipt: 7 });
});

test("a held lock and an unusable lock are both refusals", () => {
  for (const [lock, code] of [
    [countingLock({ acquireError: Object.assign(new Error("held"), { code: "ELOCKED" }) }), "mutation-lock-held"],
    [countingLock({ acquireError: new CleanupRefusal("mutation-lock-held") }), "mutation-lock-held"],
    [countingLock({ acquireError: new Error("disk full") }), "mutation-lock-unavailable"],
    [null, "mutation-lock-unavailable"],
    [{}, "mutation-lock-unavailable"],
  ]) {
    let mutated = false;
    const { result, exitCode } = run({
      lock,
      mutate: () => {
        mutated = true;
        return [];
      },
    });
    assert.equal(exitCode, EXIT_CODES.refused, code);
    assert.deepEqual(result.verification.missingEvidence, [code]);
    assert.equal(mutated, false);
  }
  assert.throws(() => acquireMutationLock(null), (error) => error.code === "mutation-lock-unavailable");
});

test("reported failures fail the run and are recorded once", () => {
  const result = emptyResult();
  const lock = countingLock();
  const { exitCode } = runMutation(result, { lock }, {
    unexpectedCode: "unexpected",
    prepare: () => null,
    mutate: () => {
      result.verification.mutationAttempted = true;
      result.verification.missingEvidence.push("post-kill-survivor");
      return ["post-kill-survivor", "desktop-relaunch-failed", "desktop-relaunch-failed"];
    },
  });
  assert.equal(exitCode, EXIT_CODES.failed);
  assert.equal(result.status, "failed");
  assert.equal(result.verification.complete, false);
  assert.deepEqual(result.verification.missingEvidence, ["post-kill-survivor", "desktop-relaunch-failed"]);
  assert.equal(lock.calls.release, 1);
});

test("a refusal under the lock is a refusal before any mutation and a failure after", () => {
  const before = run({ mutate: () => refuse("recycle-identity-changed") });
  assert.equal(before.exitCode, EXIT_CODES.refused);
  assert.deepEqual(before.result.verification.missingEvidence, ["recycle-identity-changed"]);
  assert.equal(before.lock.calls.release, 1);

  const result = emptyResult();
  const lock = countingLock();
  const after = runMutation(result, { lock }, {
    unexpectedCode: "unexpected",
    prepare: () => null,
    mutate: () => {
      result.verification.mutationAttempted = true;
      refuse("replacement-readiness-timeout");
    },
  });
  assert.equal(after.exitCode, EXIT_CODES.failed);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.verification.missingEvidence, ["replacement-readiness-timeout"]);
  assert.equal(lock.calls.release, 1);
});

test("an unexpected error is named by the mode, and fails only where the mode says so", () => {
  const refused = run({ mutate: () => { throw new TypeError("boom"); } });
  assert.equal(refused.exitCode, EXIT_CODES.refused);
  assert.deepEqual(refused.result.verification.missingEvidence, ["unexpected"]);

  const failed = run({ errorsFail: true, prepare: () => { throw new TypeError("boom"); } });
  assert.equal(failed.exitCode, EXIT_CODES.failed);
  assert.deepEqual(failed.result.verification.missingEvidence, ["unexpected"]);

  // A refusal stays a refusal even where unexpected errors fail.
  const stillRefused = run({ errorsFail: true, prepare: () => refuse("snapshot-schema-invalid") });
  assert.equal(stillRefused.exitCode, EXIT_CODES.refused);
});

test("a failed release overrides the outcome and clears completeness", () => {
  const quiet = run({ lock: countingLock({ releaseError: new Error("unlink") }) });
  assert.equal(quiet.exitCode, EXIT_CODES.refused);
  assert.equal(quiet.result.verification.complete, false);
  assert.deepEqual(quiet.result.verification.missingEvidence, ["mutation-lock-release-failed"]);

  const strict = run({ errorsFail: true, lock: countingLock({ releaseError: new Error("unlink") }) });
  assert.equal(strict.exitCode, EXIT_CODES.failed);

  const result = emptyResult();
  const attempted = runMutation(result, { lock: countingLock({ releaseError: new Error("unlink") }) }, {
    unexpectedCode: "unexpected",
    prepare: () => null,
    mutate: () => {
      result.verification.mutationAttempted = true;
      return [];
    },
  });
  assert.equal(attempted.exitCode, EXIT_CODES.failed);
  assert.equal(result.verification.complete, false);
});

test("reap, detached recycle and desktop recycle all settle through the runner", () => {
  const held = () => ({
    acquire() {
      throw Object.assign(new Error("held"), { code: "ELOCKED" });
    },
  });

  const reap = reapSnapshot({}, { platform: "darwin", uid: 501, lock: held() });
  assert.equal(reap.exitCode, EXIT_CODES.refused);
  assert.deepEqual(reap.result.verification.missingEvidence, ["snapshot-schema-invalid"]);

  const detached = recycleHarness();
  detached.deps.lock = held();
  const recycle = recycleServer(confirmedRecycleOptions(), detached.deps);
  assert.equal(recycle.exitCode, EXIT_CODES.refused);
  assert.deepEqual(recycle.result.verification.missingEvidence, ["mutation-lock-held"]);
  assert.equal(detached.calls.restart, 0);

  const token = recycleDesktop(desktopOptions(), desktopHarness().deps).result.verification.receipt.confirmationToken;
  const desktop = desktopHarness();
  desktop.deps.lock = held();
  const quit = recycleDesktop(desktopOptions({ confirmation: token }), desktop.deps);
  assert.equal(quit.exitCode, EXIT_CODES.refused);
  assert.deepEqual(quit.result.verification.missingEvidence, ["mutation-lock-held"]);
  assert.deepEqual(desktop.calls.quit, []);
});
