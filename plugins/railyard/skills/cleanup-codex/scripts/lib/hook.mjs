/** SessionEnd hook: receipts, target collection, and the bounded cleanup pass. */

import fs from "node:fs";
import { performance } from "node:perf_hooks";
import {
  DEFAULT_THRESHOLDS,
  EXIT_CODES,
  HOOK_COMMAND_TIMEOUT_MS,
  HOOK_GRACE_MS,
  HOOK_POST_SIGNAL_MS,
  HOOK_RECEIPT_SCHEMA,
  HOOK_STDIN_POLL_MS,
  HOOK_STDIN_WAIT_MS,
  HOOK_TOTAL_BUDGET_MS,
  LSOF,
  MAX_HOOK_ANCESTORS,
  MAX_HOOK_INPUT_BYTES,
  MAX_HOOK_TARGETS,
  PS,
  UUID_PATTERN,
} from "./constants.mjs";
import {
  writeLatestHookReceipt,
} from "./hook-receipts.mjs";
import {
  collectExactProcessEvidence,
  collectExactProcessIdentity,
  proxyCommandIdentity,
} from "./inventory.mjs";
import {
  CleanupRefusal,
  appServerCommandKind,
  callerUid,
  commandEvidenceAgrees,
  defaultRunner,
  identityDifferences,
  parsePsOutput,
  refuse,
  safeRun,
  sha256,
  sleepSync,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  signalExactPid,
  skippedIdentity,
} from "./reap.mjs";
import {
  createMutationLock,
  sameBirthIdentityPresent,
} from "./snapshot.mjs";

export function hookAncestor(startPid, runner) {
  let pid = startPid;
  const seen = new Set();
  for (let depth = 0; depth < MAX_HOOK_ANCESTORS; depth += 1) {
    if (!Number.isInteger(pid) || pid <= 1 || seen.has(pid)) return null;
    seen.add(pid);
    const run = safeRun(runner, PS, [
      "-p",
      String(pid),
      "-o",
      "pid=,ppid=,pgid=,uid=,lstart=,command=",
    ]);
    if (run.status !== 0) return null;
    const rows = parsePsOutput(run.stdout, "rawCommand").parsed;
    if (rows.length !== 1 || rows[0].pid !== pid) return null;
    const row = rows[0];
    if (appServerCommandKind(row.rawCommand) === "server") {
      const observation = collectExactProcessEvidence(pid, { runner });
      if (
        observation?.state !== "present"
        || !validObservedIdentity(observation.identity)
        || identityDifferences(
          row,
          observation.identity,
          ["pid", "parentPid", "processGroupId", "uid", "startTime"],
        ).length
        || !commandEvidenceAgrees(row.rawCommand, observation)
      ) return null;
      return observation;
    }
    pid = row.parentPid;
  }
  return null;
}

export function hookThreadMarker(expandedCommand, plainCommand) {
  if (!expandedCommand.startsWith(plainCommand)) return { kind: "invalid" };
  const suffix = expandedCommand.slice(plainCommand.length);
  if (suffix && !/^\s/.test(suffix)) return { kind: "invalid" };
  const matches = [...suffix.matchAll(/(?:^|\s)CODEX_THREAD_ID=([^\s]+)(?=\s|$)/g)];
  if (!matches.length) return { kind: "absent" };
  if (matches.length !== 1 || !UUID_PATTERN.test(matches[0][1])) return { kind: "invalid" };
  return { kind: "present", threadId: matches[0][1].toLowerCase() };
}

export function hookUnsafeCommand(command) {
  return appServerCommandKind(command) !== null
    || proxyCommandIdentity(command) !== null
    || /(?:^|\s)app-server\s+daemon(?:\s|$)/i.test(command)
    || /(?:^|\/)codex-app-server(?:\s|$)/i.test(command);
}

export function hookAncestorSets(processes, selfPid, parentPid) {
  const byPid = new Map(processes.map((record) => [record.pid, record]));
  const pids = new Set();
  const pgids = new Set();
  let pid = byPid.has(selfPid) ? selfPid : parentPid;
  for (let depth = 0; depth < MAX_HOOK_ANCESTORS + 2 && pid > 1 && !pids.has(pid); depth += 1) {
    pids.add(pid);
    const record = byPid.get(pid);
    if (!record) break;
    pgids.add(record.processGroupId);
    pid = record.parentPid;
  }
  const self = byPid.get(selfPid);
  if (self) pgids.add(self.processGroupId);
  return { pids, pgids };
}

export function hookSignalOrder(targets) {
  const byPid = new Map(targets.map((target) => [target.pid, target]));
  const depth = (target) => {
    let value = 0;
    let current = target;
    const seen = new Set();
    while (byPid.has(current.parentPid) && !seen.has(current.parentPid)) {
      seen.add(current.parentPid);
      current = byPid.get(current.parentPid);
      value += 1;
    }
    return value;
  };
  return targets.slice().sort((left, right) => depth(right) - depth(left) || right.pid - left.pid);
}

export function hookExecutableMap(pids, runner) {
  if (!pids.length) return new Map();
  const run = safeRun(runner, LSOF, [
    "-nP", "-a", "-p", pids.join(","), "-d", "txt", "-Fptn",
  ]);
  if (run.status !== 0) return null;
  const executables = new Map();
  let pid = null;
  let textFile = false;
  for (const line of run.stdout.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) {
      pid = Number(line.slice(1));
      textFile = false;
    } else if (line === "ftxt") {
      textFile = true;
    } else if (line.startsWith("f")) {
      textFile = false;
    } else if (textFile && line.startsWith("n/") && !executables.has(pid)) {
      executables.set(pid, line.slice(1));
      textFile = false;
    }
  }
  return executables;
}

export function collectHookTargets(sessionId, {
  runner,
  uid,
  selfPid,
  parentPid,
  appServer,
}) {
  const plainRun = safeRun(runner, PS, [
    "ww", "-axo", "pid=,ppid=,pgid=,uid=,lstart=,command=",
  ]);
  const expandedRun = safeRun(runner, PS, [
    "eww", "-axo", "pid=,ppid=,pgid=,uid=,lstart=,command=",
  ]);
  if (plainRun.status !== 0 || expandedRun.status !== 0) {
    return { complete: false, reason: "hook-process-list-unavailable", targets: [], skippedGroups: [] };
  }
  const plain = parsePsOutput(plainRun.stdout, "rawCommand");
  const expanded = parsePsOutput(expandedRun.stdout, "expandedCommand");
  if (plain.invalidRows || expanded.invalidRows) {
    return { complete: false, reason: "hook-process-list-incomplete", targets: [], skippedGroups: [] };
  }
  const expandedByPid = new Map(expanded.parsed.map((record) => [record.pid, record]));
  const plainPids = new Set(plain.parsed.map((record) => record.pid));
  const expandedOnlyGroups = new Set(expanded.parsed
    .filter((record) => !plainPids.has(record.pid))
    .map((record) => record.processGroupId));
  const groups = new Map();
  for (const record of plain.parsed) {
    const list = groups.get(record.processGroupId) ?? [];
    list.push(record);
    groups.set(record.processGroupId, list);
  }
  const ancestors = hookAncestorSets(plain.parsed, selfPid, parentPid);
  ancestors.pids.add(appServer.pid);
  ancestors.pgids.add(appServer.processGroupId);
  const desired = sessionId.toLowerCase();
  const targets = [];
  const skippedGroups = [];

  for (const [pgid, members] of groups) {
    const correlated = members.map((member) => {
      const envRecord = expandedByPid.get(member.pid);
      if (!envRecord || identityDifferences(member, envRecord, [
        "pid", "parentPid", "processGroupId", "uid", "startTime",
      ]).length) return null;
      const marker = hookThreadMarker(envRecord.expandedCommand, member.rawCommand);
      return { member, marker };
    });
    if (!correlated.some((item) => item?.marker.threadId === desired)) continue;
    const reasons = [];
    if (correlated.some((item) => item === null)) reasons.push("incomplete-identity");
    if (expandedOnlyGroups.has(pgid)) reasons.push("incomplete-identity");
    if (correlated.some((item) => item?.marker.kind === "invalid")) reasons.push("ambiguous-thread-marker");
    if (members.some((member) => member.uid !== uid)) reasons.push("cross-uid-group");
    if (members.some((member) => ancestors.pids.has(member.pid)) || ancestors.pgids.has(pgid)) {
      reasons.push("hook-or-app-server-group");
    }
    if (members.some((member) => hookUnsafeCommand(member.rawCommand))) reasons.push("shared-runtime-group");
    const threadIds = new Set(correlated.flatMap((item) => item?.marker.threadId ? [item.marker.threadId] : []));
    if ([...threadIds].some((threadId) => threadId !== desired)) reasons.push("mixed-thread-group");
    const tagged = correlated.flatMap((item) => item?.marker.threadId === desired ? [item.member] : []);
    if (tagged.length > MAX_HOOK_TARGETS || targets.length + tagged.length > MAX_HOOK_TARGETS) {
      reasons.push("target-bound-exceeded");
    }
    if (reasons.length) {
      skippedGroups.push({ processGroupId: pgid, reasons: unique(reasons) });
      continue;
    }
    targets.push(...tagged);
  }
  return skippedGroups.length
    ? { complete: false, reason: "hook-group-refused", targets: [], skippedGroups }
    : { complete: true, targets, skippedGroups };
}

const HOOK_IDENTITY_FIELDS = ["pid", "parentPid", "processGroupId", "uid", "startTime"];
const HOOK_COMMAND_FIELDS = [...HOOK_IDENTITY_FIELDS, "rawCommand"];

/**
 * One collect-and-correlate round. Nothing is ever signalled on a single scan:
 * a target only survives if the previous scan saw the same exact identity, a
 * target that changed refuses the whole pass, and one that disappeared between
 * scans is recorded as verified gone. `executables` additionally requires a
 * known text-file path per target.
 */
function stableTargets(sessionId, context, {
  prior = null,
  fields = HOOK_IDENTITY_FIELDS,
  executables = null,
  refuseCode = "hook-targets-changed",
  record = null,
} = {}) {
  const round = collectHookTargets(sessionId, context);
  if (record) record.skippedGroups = round.skippedGroups;
  if (!round.complete) refuse(round.reason);
  if (!prior) return { targets: round.targets, vanished: [] };
  const before = new Map(prior.map((target) => [target.pid, target]));
  const stable = round.targets.flatMap((target) => {
    const earlier = before.get(target.pid);
    const executable = executables?.get(target.pid);
    if (!earlier || (executables && !executable) || identityDifferences(earlier, target, fields).length) return [];
    return [executables ? { ...target, executable } : target];
  });
  if (stable.length !== round.targets.length) refuse(refuseCode);
  const present = new Set(round.targets.map((target) => target.pid));
  return {
    targets: stable,
    vanished: prior.filter((target) => !present.has(target.pid)).map((target) => target.pid),
  };
}

/** Signal every target deepest-first; one that is already gone is verified gone. */
function signalRound(targets, signal, { signalProcess, signalled, verified }) {
  const delivered = [];
  for (const target of hookSignalOrder(targets)) {
    try {
      signalProcess(target.pid, signal);
      signalled.push(target.pid);
      delivered.push(target);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
      verified.push(target.pid);
    }
  }
  return delivered;
}

/**
 * After a KILL a target is gone if it is absent or has been reborn under a
 * different birth identity. A process we can still see but cannot identify is
 * unknown, not a proven survivor.
 */
function verifyKilled(targets, { readIdentity, runner, verified, missingEvidence }) {
  for (const target of targets) {
    const current = readIdentity(target.pid, { runner });
    const identified = current?.state === "present" && validObservedIdentity(current.identity);
    if (current?.state === "absent" || (identified && !sameBirthIdentityPresent(target, current))) {
      verified.push(target.pid);
    } else {
      missingEvidence.push(identified ? "post-kill-survivor" : "post-kill-verification-unknown");
    }
  }
}

export function inspectHook({
  platform = process.platform,
  runner = defaultRunner,
  fsApi = fs,
  env = process.env,
  uid = callerUid(),
  now = Date.now(),
  monotonicNow = () => performance.now(),
  parentPid = process.ppid,
  selfPid = process.pid,
  thresholds = DEFAULT_THRESHOLDS,
  sessionId = null,
  readIdentity = (pid, { runner: identityRunner = runner } = {}) => (
    collectExactProcessIdentity(pid, { runner: identityRunner })
  ),
  signalProcess = signalExactPid,
  sleep = sleepSync,
  lock = createMutationLock({ fsApi, uid }),
} = {}) {
  if (env.RAILYARD_CLEANUP_CODEX_HOOK_DISABLED === "1") {
    return { status: "disabled", receipt: null, receiptPath: null };
  }
  if (platform !== "darwin") {
    // Non-macOS session ends are a no-op, not a refusal: exit 0 so the
    // harness doesn't log a hook error on every Windows/Linux session.
    return { status: "disabled", receipt: null, receiptPath: null };
  }
  const deadline = monotonicNow() + HOOK_TOTAL_BUDGET_MS;
  const boundedRunner = (file, args) => {
    const remaining = Math.floor(deadline - monotonicNow());
    if (remaining <= 0) return { status: null, stdout: "", stderr: "", error: true };
    return runner(file, args, { timeout: Math.min(HOOK_COMMAND_TIMEOUT_MS, remaining) });
  };
  if (!UUID_PATTERN.test(sessionId ?? "")) {
    return { status: "unavailable", receipt: null, receiptPath: null };
  }
  const observation = hookAncestor(parentPid, boundedRunner);
  if (!observation || observation.identity.uid !== uid) {
    return { status: "unavailable", receipt: null, receiptPath: null };
  }
  const identity = observation.identity;
  const missingEvidence = [];
  const warnings = [];
  const cleanup = {
    action: "session-process-cleanup",
    selectedPids: [],
    termPids: [],
    killPids: [],
    verifiedPids: [],
    skippedGroups: [],
  };
  let release = null;
  let mutationAttempted = false;
  let status = "healthy";
  try {
    const context = { runner: boundedRunner, uid, selfPid, parentPid, appServer: identity };
    const first = stableTargets(sessionId, context, { record: cleanup });

    let lockAttempts = 0;
    while (!release && lockAttempts < 128) {
      lockAttempts += 1;
      try {
        release = lock.acquire();
      } catch (error) {
        if (error?.code !== "mutation-lock-held" && error?.code !== "ELOCKED") throw error;
        if (deadline - monotonicNow() <= 50) refuse("mutation-lock-held");
        sleep(20);
      }
    }
    if (!release) refuse("mutation-lock-held");

    const second = stableTargets(sessionId, context, { prior: first.targets });
    cleanup.verifiedPids.push(...second.vanished);
    const executables = hookExecutableMap(second.targets.map((target) => target.pid), boundedRunner);
    if (!executables) refuse("hook-target-identity-unavailable");
    const third = stableTargets(sessionId, context, {
      prior: second.targets,
      fields: HOOK_COMMAND_FIELDS,
      executables,
    });
    cleanup.verifiedPids.push(...third.vanished);
    cleanup.selectedPids = third.targets.map((target) => target.pid);

    if (third.targets.length) mutationAttempted = true;
    const termTargets = signalRound(third.targets, "SIGTERM", {
      signalProcess, signalled: cleanup.termPids, verified: cleanup.verifiedPids,
    });
    if (termTargets.length) sleep(Math.min(HOOK_GRACE_MS, Math.max(0, deadline - monotonicNow() - 100)));

    const survivors = [];
    for (const target of termTargets) {
      const current = readIdentity(target.pid, { runner: boundedRunner });
      if (current?.state === "absent") {
        cleanup.verifiedPids.push(target.pid);
        continue;
      }
      if (current?.state !== "present" || !validObservedIdentity(current.identity)) {
        refuse("hook-post-term-identity-unavailable");
      }
      if (!sameBirthIdentityPresent(target, current)) {
        cleanup.verifiedPids.push(target.pid);
        continue;
      }
      if (skippedIdentity(target.pid, current, target)) refuse("hook-target-identity-changed");
      survivors.push(target);
    }
    const killTargets = signalRound(survivors, "SIGKILL", {
      signalProcess, signalled: cleanup.killPids, verified: cleanup.verifiedPids,
    });
    if (killTargets.length) sleep(Math.min(HOOK_POST_SIGNAL_MS, Math.max(0, deadline - monotonicNow() - 25)));
    verifyKilled(killTargets, {
      readIdentity, runner: boundedRunner, verified: cleanup.verifiedPids, missingEvidence,
    });

    // A process created during the TERM grace is exact-matched the same way and
    // gets one KILL pass, never a TERM it could outlive.
    const late = stableTargets(sessionId, context);
    if (late.targets.length) {
      const lateExecutables = hookExecutableMap(late.targets.map((target) => target.pid), boundedRunner);
      if (!lateExecutables) refuse("hook-late-target-identity-unavailable");
      const confirmed = stableTargets(sessionId, context, {
        prior: late.targets,
        fields: HOOK_COMMAND_FIELDS,
        executables: lateExecutables,
        refuseCode: "hook-late-targets-changed",
      });
      cleanup.selectedPids.push(...confirmed.targets.map((target) => target.pid));
      if (confirmed.targets.length) mutationAttempted = true;
      const lateKilled = signalRound(confirmed.targets, "SIGKILL", {
        signalProcess, signalled: cleanup.killPids, verified: cleanup.verifiedPids,
      });
      if (lateKilled.length) sleep(Math.min(HOOK_POST_SIGNAL_MS, Math.max(0, deadline - monotonicNow() - 25)));
      verifyKilled(lateKilled, {
        readIdentity, runner: boundedRunner, verified: cleanup.verifiedPids, missingEvidence,
      });
    }

    const final = stableTargets(sessionId, context);
    if (final.targets.length) refuse("hook-final-target-survivor");
    cleanup.selectedPids = unique(cleanup.selectedPids);
    cleanup.verifiedPids = unique(cleanup.verifiedPids);
    if (missingEvidence.length) status = "failed";
  } catch (error) {
    status = mutationAttempted ? "failed" : "refused";
    missingEvidence.push(error instanceof CleanupRefusal ? error.code : "hook-cleanup-failed");
  } finally {
    if (release) {
      try { release(); } catch {
        status = "failed";
        missingEvidence.push("mutation-lock-release-failed");
      }
    }
  }
  const receipt = {
    schema: HOOK_RECEIPT_SCHEMA,
    observedAt: new Date(now).toISOString(),
    status,
    appServer: {
      pid: identity.pid,
      parentPid: identity.parentPid,
      processGroupId: identity.processGroupId,
      uid: identity.uid,
      startTime: identity.startTime,
      executable: identity.executable,
      commandIdentity: "codex app-server",
    },
    cleanup,
    warnings,
    missingEvidence,
    verification: {
      readOnly: false,
      mutationAttempted,
      ancestryBound: MAX_HOOK_ANCESTORS,
      machineWideScan: true,
      targetBound: MAX_HOOK_TARGETS,
      threadIdDigest: sha256(sessionId).slice(0, 16),
    },
  };
  try {
    return {
      status,
      receipt,
      receiptPath: writeLatestHookReceipt(receipt, { fsApi, env, uid }),
    };
  } catch {
    return { status: "unavailable", receipt, receiptPath: null };
  }
}

/**
 * One table for every terminal hook status. `complete` feeds the inspection
 * receipt and `exitCode` is what the CLI returns in either output mode. These
 * used to be two separate ladders, and they disagreed: --json reported an
 * attempted-but-failed cleanup as exit 2 (refused) where the non-JSON SessionEnd
 * hook correctly reported 3. The hook never produces "warning", so there is no
 * warning row and no branch for one.
 */
const HOOK_STATUS = Object.freeze({
  healthy: Object.freeze({ exitCode: EXIT_CODES.healthy, complete: true }),
  disabled: Object.freeze({ exitCode: EXIT_CODES.healthy, complete: false }),
  failed: Object.freeze({ exitCode: EXIT_CODES.failed, complete: false }),
  refused: Object.freeze({ exitCode: EXIT_CODES.refused, complete: false }),
  unavailable: Object.freeze({ exitCode: EXIT_CODES.refused, complete: false }),
});

export function hookStatusOutcome(status) {
  return HOOK_STATUS[status] ?? HOOK_STATUS.refused;
}

export function hookInspectionResult(outcome, platform, thresholds) {
  const missingEvidence = [...(outcome.receipt?.missingEvidence ?? [])];
  if (outcome.status === "disabled") missingEvidence.push("hook-disabled");
  if (outcome.status === "unavailable") missingEvidence.push("hook-unavailable");
  return {
    schemaVersion: 1,
    action: "cleanup",
    status: outcome.status,
    selected: [],
    skipped: [],
    warnings: outcome.receipt?.warnings ?? [],
    verification: {
      platform,
      readOnly: outcome.receipt?.verification.readOnly ?? false,
      mutationAttempted: outcome.receipt?.verification.mutationAttempted ?? false,
      complete: hookStatusOutcome(outcome.status).complete,
      thresholds: { ...thresholds },
      missingEvidence: unique(missingEvidence),
      receiptPath: outcome.receiptPath,
      servers: [],
    },
    receipt: outcome.receipt,
  };
}

export function parseHookPayload(input) {
  if (typeof input !== "string" || Buffer.byteLength(input) > MAX_HOOK_INPUT_BYTES) return null;
  try {
    const payload = JSON.parse(input);
    if (
      !payload
      || Array.isArray(payload)
      || typeof payload !== "object"
      || payload.hook_event_name !== "SessionEnd"
      || typeof payload.session_id !== "string"
      || !UUID_PATTERN.test(payload.session_id)
    ) return null;
    return { sessionId: payload.session_id.toLowerCase() };
  } catch {
    return null;
  }
}

export function readHookPayload(fsApi = fs, { sleep = sleepSync } = {}) {
  // fd 0 is a non-blocking pipe under the harness: readSync throws EAGAIN
  // whenever the parent has not written the payload yet. Treating that as
  // "no payload" reported status "unavailable" (exit 2) on healthy session
  // ends, so poll instead — bounded well inside the 2.2s internal budget.
  const deadline = performance.now() + HOOK_STDIN_WAIT_MS;
  try {
    const buffer = Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      let count;
      try {
        count = fsApi.readSync(0, buffer, bytes, buffer.length - bytes, null);
      } catch (error) {
        if (
          (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK")
          && performance.now() < deadline
        ) {
          sleep(HOOK_STDIN_POLL_MS);
          continue;
        }
        throw error;
      }
      if (!count) break;
      bytes += count;
    }
    if (bytes <= 0 || bytes > MAX_HOOK_INPUT_BYTES) return null;
    return parseHookPayload(buffer.subarray(0, bytes).toString("utf8"));
  } catch {
    return null;
  }
}
