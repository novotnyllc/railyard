/**
 * The one run loop every mutating mode shares: reap, detached recycle and
 * desktop recycle.
 *
 *   prepare  → read-only evidence; a refusal here never mutates anything
 *   confirm  → the operator's token must match the prepared receipt
 *   lock     → the per-user mutation lock is held for the rest of the run
 *   mutate   → rechecks under the lock, then the mutation itself
 *
 * `mutate` reports through one handle, `txn`: `txn.attempted()` before it
 * changes anything, `txn.fail(code)` for a failure it records and carries on
 * past, and a thrown error to stop. The runner owns
 * `verification.mutationAttempted` and settles the status: a stop before any
 * attempt is a refusal, a stop or a recorded failure after one is a failure.
 * The lock is always released, and the exit code follows from the status.
 */

import { EXIT_CODES } from "./constants.mjs";
import { CleanupRefusal, refuse, unique } from "./process-evidence.mjs";

// A lock for a nested run whose caller already holds the mutation lock (the
// residue reap inside a recycle): it takes nothing and releases nothing.
export const LOCK_HELD_BY_CALLER = Object.freeze({ acquire: () => null });

function acquireMutationLock(lock) {
  if (!lock || typeof lock.acquire !== "function") refuse("mutation-lock-unavailable");
  try {
    return lock.acquire();
  } catch (error) {
    refuse(error?.code === "ELOCKED" || error?.code === "mutation-lock-held"
      ? "mutation-lock-held"
      : "mutation-lock-unavailable");
  }
}

/**
 * Run one mutation transaction against `result` (a mode's empty result).
 *
 * - `prepare()` returns the plan `mutate` acts on.
 * - `confirmToken(plan)`, when given, names the token the operator must echo
 *   back as `confirmation`; modes without a token (reap) omit it.
 * - `mutate(plan, txn)` reports as described above; its return is ignored.
 * - `unexpected: { code, status }` settles an error that is not a
 *   CleanupRefusal, and a failed lock release, before any attempt: reap
 *   treats both as "failed", the recycles as "refused". After an attempt
 *   they are always "failed".
 */
export function runMutation(result, { lock, confirmation = null } = {}, {
  prepare,
  confirmToken = null,
  mutate,
  unexpected,
}) {
  const verification = result.verification;
  let failed = false;
  const txn = {
    attempted() {
      verification.mutationAttempted = true;
    },
    // A recorded failure is kept even if the run stops later.
    fail(code) {
      verification.mutationAttempted = true;
      failed = true;
      verification.missingEvidence.push(code);
    },
    get hasAttempted() {
      return verification.mutationAttempted;
    },
    get hasFailed() {
      return failed;
    },
  };
  const settle = (fallback) => (verification.mutationAttempted ? "failed" : fallback);
  let release = null;
  try {
    const plan = prepare();
    if (confirmToken) {
      if (!confirmation) refuse("confirmation-required");
      if (confirmation !== confirmToken(plan)) refuse("confirmation-mismatch");
    }
    release = acquireMutationLock(lock);
    mutate(plan, txn);
    if (failed) {
      result.status = "failed";
    } else {
      verification.complete = true;
      result.status = "healthy";
    }
  } catch (error) {
    const refusal = error instanceof CleanupRefusal;
    verification.missingEvidence.push(refusal ? error.code : unexpected.code);
    result.status = settle(refusal ? "refused" : unexpected.status);
  } finally {
    if (release) {
      try {
        release();
      } catch {
        verification.missingEvidence.push("mutation-lock-release-failed");
        verification.complete = false;
        result.status = settle(unexpected.status);
      }
    }
  }
  verification.missingEvidence = unique(verification.missingEvidence);
  return { result, exitCode: EXIT_CODES[result.status] };
}
