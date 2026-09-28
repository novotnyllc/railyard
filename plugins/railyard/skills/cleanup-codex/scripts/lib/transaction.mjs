/**
 * The one run loop every mutating mode shares: reap, detached recycle and
 * desktop recycle.
 *
 *   prepare  → read-only evidence; a refusal here never mutates anything
 *   confirm  → the operator's token must match the prepared receipt
 *   lock     → the per-user mutation lock is held for the rest of the run
 *   mutate   → rechecks under the lock, then the mutation itself
 *
 * A refusal is a failure once `verification.mutationAttempted` is set, the
 * lock is always released, and the exit code follows from the final status.
 */

import { EXIT_CODES } from "./constants.mjs";
import { CleanupRefusal, refuse, unique } from "./process-evidence.mjs";

// Statuses are named after the exit codes they map to.
export function exitCodeForStatus(status) {
  return Object.hasOwn(EXIT_CODES, status) ? EXIT_CODES[status] : EXIT_CODES.failed;
}

export function acquireMutationLock(lock) {
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
 * - `mutate(plan)` returns failure codes (none means healthy) or throws a
 *   CleanupRefusal to refuse. A code it already recorded is not repeated.
 * - `unexpectedCode` names any error that is not a CleanupRefusal.
 * - `errorsFail` makes an unexpected error or a failed lock release a failure
 *   even before any mutation (reap's contract: its exit code 3 means "look").
 */
export function runMutation(result, { lock, confirmation = null } = {}, {
  prepare,
  confirmToken = null,
  mutate,
  unexpectedCode,
  errorsFail = false,
}) {
  const verification = result.verification;
  let release = null;
  try {
    const plan = prepare();
    if (confirmToken) {
      if (!confirmation) refuse("confirmation-required");
      if (confirmation !== confirmToken(plan)) refuse("confirmation-mismatch");
    }
    release = acquireMutationLock(lock);
    const failures = mutate(plan) ?? [];
    if (failures.length) {
      for (const code of failures) {
        if (!verification.missingEvidence.includes(code)) verification.missingEvidence.push(code);
      }
      result.status = "failed";
    } else {
      verification.complete = true;
      result.status = "healthy";
    }
  } catch (error) {
    const refusal = error instanceof CleanupRefusal;
    verification.missingEvidence.push(refusal ? error.code : unexpectedCode);
    result.status = verification.mutationAttempted || (errorsFail && !refusal) ? "failed" : "refused";
  } finally {
    if (release) {
      try {
        release();
      } catch {
        verification.missingEvidence.push("mutation-lock-release-failed");
        verification.complete = false;
        result.status = verification.mutationAttempted || errorsFail ? "failed" : "refused";
      }
    }
  }
  verification.missingEvidence = unique(verification.missingEvidence);
  return { result, exitCode: exitCodeForStatus(result.status) };
}
