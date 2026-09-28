// The shared mutation runner: prepare, confirm, lock, mutate, and settle.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CleanupRefusal,
  EXIT_CODES,
  LOCK_HELD_BY_CALLER,
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
    unexpected: { code: "unexpected", status: "refused" },
    prepare: () => ({ token: "RECYCLE token" }),
    mutate: () => {},
    ...steps,
  });
  assert.equal(outcome.result, result);
  return { ...outcome, lock };
}

test("a completed mutation is healthy and releases the lock once", () => {
  const { result, exitCode, lock } = run({ mutate: (plan, txn) => txn.attempted() });
  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.status, "healthy");
  assert.equal(result.verification.complete, true);
  assert.equal(result.verification.mutationAttempted, true);
  assert.deepEqual(result.verification.missingEvidence, []);
  assert.deepEqual(lock.calls, { acquire: 1, release: 1 });
});

test("a refusal while preparing never takes the lock or mutates", () => {
  let mutated = false;
  const { result, exitCode, lock } = run({
    prepare: () => refuse("inventory-incomplete"),
    mutate: () => {
      mutated = true;
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
      },
    });
    assert.equal(exitCode, EXIT_CODES.refused, code);
    assert.deepEqual(result.verification.missingEvidence, [code]);
    assert.equal(mutated, false);
  }
});

test("a caller-held lock takes and releases nothing", () => {
  const { exitCode } = run({ lock: LOCK_HELD_BY_CALLER });
  assert.equal(exitCode, EXIT_CODES.healthy);
});

test("recorded failures fail the run, mark it attempted, and survive a later stop", () => {
  const recorded = run({
    mutate: (plan, txn) => {
      txn.fail("post-kill-survivor");
      txn.fail("desktop-relaunch-failed");
      txn.fail("desktop-relaunch-failed");
      assert.equal(txn.hasFailed, true);
      assert.equal(txn.hasAttempted, true);
    },
  });
  assert.equal(recorded.exitCode, EXIT_CODES.failed);
  assert.equal(recorded.result.status, "failed");
  assert.equal(recorded.result.verification.complete, false);
  assert.equal(recorded.result.verification.mutationAttempted, true);
  assert.deepEqual(recorded.result.verification.missingEvidence, ["post-kill-survivor", "desktop-relaunch-failed"]);
  assert.equal(recorded.lock.calls.release, 1);

  const stopped = run({
    mutate: (plan, txn) => {
      txn.fail("signal-or-wait-failed");
      throw new TypeError("reader failed");
    },
  });
  assert.equal(stopped.exitCode, EXIT_CODES.failed);
  assert.deepEqual(stopped.result.verification.missingEvidence, ["signal-or-wait-failed", "unexpected"]);
});

test("a stop under the lock is a refusal before any attempt and a failure after", () => {
  const before = run({ mutate: () => refuse("recycle-identity-changed") });
  assert.equal(before.exitCode, EXIT_CODES.refused);
  assert.deepEqual(before.result.verification.missingEvidence, ["recycle-identity-changed"]);
  assert.equal(before.result.verification.mutationAttempted, false);
  assert.equal(before.lock.calls.release, 1);

  const after = run({
    mutate: (plan, txn) => {
      txn.attempted();
      refuse("replacement-readiness-timeout");
    },
  });
  assert.equal(after.exitCode, EXIT_CODES.failed);
  assert.equal(after.result.status, "failed");
  assert.deepEqual(after.result.verification.missingEvidence, ["replacement-readiness-timeout"]);
  assert.equal(after.lock.calls.release, 1);
});

test("an unexpected error settles as the mode says before any attempt", () => {
  const refused = run({ mutate: () => { throw new TypeError("boom"); } });
  assert.equal(refused.exitCode, EXIT_CODES.refused);
  assert.deepEqual(refused.result.verification.missingEvidence, ["unexpected"]);

  const failed = run({
    unexpected: { code: "unexpected", status: "failed" },
    prepare: () => { throw new TypeError("boom"); },
  });
  assert.equal(failed.exitCode, EXIT_CODES.failed);
  assert.deepEqual(failed.result.verification.missingEvidence, ["unexpected"]);

  // A refusal stays a refusal even where unexpected errors fail.
  const stillRefused = run({
    unexpected: { code: "unexpected", status: "failed" },
    prepare: () => refuse("snapshot-schema-invalid"),
  });
  assert.equal(stillRefused.exitCode, EXIT_CODES.refused);
});

test("a failed release overrides the outcome and clears completeness", () => {
  const quiet = run({ lock: countingLock({ releaseError: new Error("unlink") }) });
  assert.equal(quiet.exitCode, EXIT_CODES.refused);
  assert.equal(quiet.result.verification.complete, false);
  assert.deepEqual(quiet.result.verification.missingEvidence, ["mutation-lock-release-failed"]);

  const strict = run({
    unexpected: { code: "unexpected", status: "failed" },
    lock: countingLock({ releaseError: new Error("unlink") }),
  });
  assert.equal(strict.exitCode, EXIT_CODES.failed);

  const attempted = run({
    lock: countingLock({ releaseError: new Error("unlink") }),
    mutate: (plan, txn) => txn.attempted(),
  });
  assert.equal(attempted.exitCode, EXIT_CODES.failed);
  assert.equal(attempted.result.verification.complete, false);
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
