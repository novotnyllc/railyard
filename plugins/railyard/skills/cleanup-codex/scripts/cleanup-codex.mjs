#!/usr/bin/env node

/**
 * cleanup-codex is the invocable entry point: the Codex SessionEnd hook runs
 * `cleanup --hook` against this file, and the tests import from it. It keeps
 * argument parsing, inventory rendering, and the CLI; the implementation lives
 * in `lib/`.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_GRACE_MS,
  DEFAULT_MIN_SOFT_NOFILE,
  DEFAULT_POST_SIGNAL_MS,
  DEFAULT_READY_POLL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  DEFAULT_THRESHOLDS,
  EXIT_CODES,
  THRESHOLD_FLAGS,
} from "./lib/constants.mjs";
import {
  hookInspectionResult,
  hookStatusOutcome,
  inspectHook,
  parseHookPayload,
  readHookPayload,
} from "./lib/hook.mjs";
import {
  pruneHookReceipts,
} from "./lib/hook-receipts.mjs";
import {
  classifyInventory,
  collectExactProcessIdentity,
  collectMacOSInventory,
  invalidResult,
} from "./lib/inventory.mjs";
import {
  CleanupRefusal,
  callerUid,
  defaultRunner,
  sleepSync,
  unique,
  validThreshold,
} from "./lib/process-evidence.mjs";
import {
  emptyReapResult,
  reapSnapshot,
  signalExactPid,
} from "./lib/reap.mjs";
import {
  recycleServer,
} from "./lib/recycle.mjs";
import {
  createDefaultRecycleDependencies,
  strictLauncherPath,
} from "./lib/recycle-deps.mjs";
import {
  buildExactTreeSnapshot,
  createMutationLock,
  readSnapshotSecure,
  writeSnapshotAtomic,
} from "./lib/snapshot.mjs";

export * from "./lib/constants.mjs";
export * from "./lib/hook.mjs";
export * from "./lib/hook-receipts.mjs";
export * from "./lib/inventory.mjs";
export * from "./lib/process-evidence.mjs";
export * from "./lib/reap.mjs";
export * from "./lib/recycle.mjs";
export * from "./lib/recycle-deps.mjs";
export * from "./lib/recycle-evidence.mjs";
export * from "./lib/snapshot.mjs";

export function parseCliArgs(argv) {
  let action = "inspect";
  let actionSeen = false;
  let json = false;
  let help = false;
  let hook = false;
  let snapshot = null;
  let pid = null;
  let confirmation = null;
  let unmanaged = false;
  let launcher = null;
  let nofileAttestor = null;
  let minSoftLimit = DEFAULT_MIN_SOFT_NOFILE;
  let minSoftLimitSeen = false;
  let error = null;
  const thresholds = { ...DEFAULT_THRESHOLDS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--hook") {
      if (hook) error = "duplicate-hook-argument";
      hook = true;
      continue;
    }
    if (arg === "--unmanaged") {
      if (unmanaged) error = "duplicate-unmanaged-argument";
      unmanaged = true;
      continue;
    }

    const separator = arg.indexOf("=");
    const flag = separator < 0 ? arg : arg.slice(0, separator);
    const inlineValue = separator < 0 ? undefined : arg.slice(separator + 1);
    const takeValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[index + 1];
      if (!next || next.startsWith("-")) return undefined;
      index += 1;
      return next;
    };
    if (flag === "--snapshot") {
      const value = takeValue();
      if (!value || snapshot !== null) error = "invalid-snapshot-argument";
      else snapshot = value;
      continue;
    }
    if (["--pid", "--confirm", "--launcher", "--nofile-attestor", "--min-soft-limit"].includes(flag)) {
      const value = takeValue();
      if (flag === "--pid") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0 || pid !== null) error = "invalid-recycle-pid";
        else pid = parsed;
      } else if (flag === "--confirm") {
        if (!value || confirmation !== null) error = "invalid-confirmation-token";
        else confirmation = value;
      } else if (flag === "--launcher") {
        if (!value || launcher !== null) error = "invalid-launcher-argument";
        else launcher = value;
      } else if (flag === "--nofile-attestor") {
        if (!value || nofileAttestor !== null) error = "invalid-nofile-attestor-argument";
        else nofileAttestor = value;
      } else {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) error = "invalid-minimum-soft-limit";
        else {
          minSoftLimit = parsed;
          minSoftLimitSeen = true;
        }
      }
      continue;
    }
    const threshold = THRESHOLD_FLAGS.get(flag);
    if (threshold) {
      const value = takeValue();
      const parsed = validThreshold(value);
      if (parsed === null) error = "invalid-threshold";
      else thresholds[threshold] = parsed;
      continue;
    }

    if (!arg.startsWith("-") && !actionSeen) {
      actionSeen = true;
      if (arg === "inspect" || arg === "cleanup" || arg === "reap" || arg === "recycle") action = arg;
      else {
        action = "invalid";
        error = "invalid-action";
      }
      continue;
    }

    error = "invalid-arguments";
  }

  if (action === "reap" && !snapshot) error = "snapshot-required";
  if (action === "recycle" && pid === null) error = "recycle-pid-required";
  if (action === "recycle" && snapshot !== null) error = "snapshot-not-allowed-for-recycle";
  if (action !== "recycle" && (
    pid !== null
    || confirmation !== null
    || unmanaged
    || launcher
    || nofileAttestor
    || minSoftLimitSeen
  )) {
    error = "recycle-argument-without-recycle";
  }
  if (action === "recycle" && !unmanaged && launcher !== null) error = "launcher-requires-unmanaged";
  if (hook && snapshot !== null) error = "hook-snapshot-not-allowed";
  if (hook && action !== "cleanup") error = "hook-requires-cleanup";
  if (!hook && action === "cleanup") error = "cleanup-requires-hook";
  return {
    action,
    json,
    help,
    hook,
    snapshot,
    pid,
    confirmation,
    unmanaged,
    launcher,
    nofileAttestor,
    minSoftLimit,
    thresholds,
    error,
  };
}

export function renderHuman(result) {
  const servers = result.verification.servers ?? [];
  const lines = [
    `cleanup-codex ${result.action}: ${result.status}`,
    `read-only: ${result.verification.readOnly ? "yes" : "no"}; mutation attempted: ${result.verification.mutationAttempted ? "yes" : "no"}`,
  ];
  if (result.action === "inspect" && servers.length === 0) lines.push("app-servers: none observed");
  for (const server of servers) {
    lines.push(
      `app-server pid ${server.pid}: ${server.classification} (${server.classificationReason})`,
      `  parent=${server.parentPid} pgid=${server.processGroupId} uid=${server.uid}`,
      `  executable=${server.executable ?? "unknown"} identity=${server.commandIdentity}`,
      `  started=${server.startTime ?? "unknown"} age_hours=${server.ageHours ?? "unknown"}`,
      `  descriptors=${server.descriptorCount ?? "unknown"} highest=${server.highestDescriptor ?? "unknown"}`,
      `  descendants=${server.descendants.total} direct=${server.descendants.direct}`,
      `  remote_proxies=${server.remoteProxyClients.length}${server.remoteProxyClients.length ? ` pids=${server.remoteProxyClients.map((proxy) => proxy.pid).join(",")}` : ""}`,
      `  control_socket=${server.controlSocket.path ?? "not observed"} owner=${server.controlSocket.ownerPid ?? "unknown"}`,
    );
    if (server.missingEvidence.length) {
      lines.push(`  refusal: missing ${server.missingEvidence.join(", ")}`);
    }
  }
  const selectionLabel = result.action === "inspect"
    ? "selected for inspection only"
    : result.action === "recycle"
      ? "selected recycle identities"
      : "selected snapshot targets";
  lines.push(`${selectionLabel}: ${result.selected.length ? result.selected.map((item) => item.pid).join(", ") : "none"}`);
  if (result.action === "recycle" && result.verification.receipt) {
    lines.push(
      `mode: ${result.verification.receipt.mode}`,
      `confirmation token: ${result.verification.receipt.confirmationToken}`,
    );
  }
  for (const item of result.skipped) {
    lines.push(`skipped pid ${item.pid}: ${item.reasons.join(", ")}`);
  }
  for (const warning of result.warnings) {
    lines.push(`warning pid ${warning.pid}: ${warning.message}; does not authorize action`);
  }
  if (result.verification.missingEvidence.length) {
    lines.push(`refused: missing ${result.verification.missingEvidence.join(", ")}`);
  }
  return lines.join("\n");
}

export function usage() {
  return [
    "Usage: cleanup-codex [inspect [--snapshot path] | cleanup --hook | reap --snapshot path | recycle --pid PID] [--json]",
    "",
    "Inspection is the default action; --snapshot records an exact tree for an explicit later reap.",
    "Recycle requires --nofile-attestor PATH on the receipt-producing pass; rerun the same command with --confirm TOKEN.",
    "Unmanaged receipt and recycle also require --unmanaged and --launcher PATH (or RAILYARD_CODEX_BIN).",
    "Threshold options: --fd-count-warn, --highest-fd-warn, --age-hours-warn, --descendant-warn",
    "Exit codes: 0 healthy, 1 warning, 2 refused/invalid, 3 attempted cleanup verification failure.",
  ].join("\n");
}

export function runCli(argv = process.argv.slice(2), {
  runner = defaultRunner,
  platform = process.platform,
  now = Date.now(),
  uid = callerUid(),
  inventory: suppliedInventory = null,
  readIdentity = (pid, { runner: identityRunner = runner } = {}) => (
    collectExactProcessIdentity(pid, { runner: identityRunner })
  ),
  fsApi = fs,
  env = process.env,
  signalProcess = signalExactPid,
  spawnProcess = spawn,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyPollMs = DEFAULT_READY_POLL_MS,
  monotonicNow = () => performance.now(),
  hookParentPid = process.ppid,
  hookInput,
  lockPath,
  lock = createMutationLock({ fsApi, uid, ...(lockPath ? { lockPath } : {}) }),
  recycleDependencies = null,
  write = (text) => console.log(text),
} = {}) {
  const parsed = parseCliArgs(argv);
  if (parsed.help) {
    write(usage());
    return EXIT_CODES.healthy;
  }
  if (parsed.error || !["inspect", "cleanup", "reap", "recycle"].includes(parsed.action)) {
    const result = invalidResult(parsed.error ?? "invalid-action", platform);
    write(parsed.json ? JSON.stringify(result, null, 2) : renderHuman(result));
    return EXIT_CODES.refused;
  }

  if (parsed.hook) {
    // One status -> exit-code table for every hook outcome, in both output
    // modes. Reporting is the only difference JSON makes.
    const report = (outcome) => {
      if (parsed.json) write(JSON.stringify(hookInspectionResult(outcome, platform, parsed.thresholds), null, 2));
      return hookStatusOutcome(outcome.status).exitCode;
    };
    if (platform !== "darwin" || env.RAILYARD_CLEANUP_CODEX_HOOK_DISABLED === "1") {
      // Non-macOS or explicitly disabled: no-op before touching stdin — the
      // hook must never block on the payload or report a refusal here.
      return report({ status: "disabled", receipt: null, receiptPath: null });
    }
    const payload = hookInput === undefined ? readHookPayload(fsApi) : parseHookPayload(hookInput);
    if (!payload) return report({ status: "unavailable", receipt: null, receiptPath: null });
    const outcome = inspectHook({
      platform,
      runner,
      fsApi,
      env,
      uid,
      now,
      parentPid: hookParentPid,
      thresholds: parsed.thresholds,
      sessionId: payload.sessionId,
      readIdentity,
      signalProcess,
      sleep,
      lock,
    });
    return report(outcome);
  }

  if (parsed.action === "reap") {
    let snapshot;
    try {
      snapshot = readSnapshotSecure(parsed.snapshot, { fsApi, uid });
    } catch (error) {
      const result = emptyReapResult(platform);
      result.verification.missingEvidence.push(
        error instanceof CleanupRefusal ? error.code : "snapshot-file-unavailable",
      );
      write(parsed.json ? JSON.stringify(result, null, 2) : renderHuman(result));
      return EXIT_CODES.refused;
    }
    const outcome = reapSnapshot(snapshot, {
      platform,
      uid,
      readIdentity,
      signalProcess,
      sleep,
      graceMs,
      postSignalMs,
      lock,
    });
    write(parsed.json ? JSON.stringify(outcome.result, null, 2) : renderHuman(outcome.result));
    return outcome.exitCode;
  }

  const inventory = suppliedInventory ?? collectMacOSInventory({ runner, platform });
  if (parsed.action === "recycle") {
    const launcher = parsed.unmanaged
      ? strictLauncherPath({ explicit: parsed.launcher, env, fsApi })
      : null;
    const attestorPath = parsed.nofileAttestor ?? env.RAILYARD_NOFILE_ATTESTOR ?? null;
    const dependencies = recycleDependencies ?? createDefaultRecycleDependencies({
      inventory,
      runner,
      fsApi,
      env,
      uid,
      readIdentity,
      signalProcess,
      spawnProcess,
      sleep,
      graceMs,
      postSignalMs,
      readyTimeoutMs,
      readyPollMs,
      monotonicNow,
      lock,
    });
    const outcome = recycleServer({
      platform,
      uid,
      pid: parsed.pid,
      unmanaged: parsed.unmanaged,
      confirmation: parsed.confirmation,
      launcher,
      attestorPath,
      minSoftLimit: parsed.minSoftLimit,
      now,
    }, dependencies);
    write(parsed.json ? JSON.stringify(outcome.result, null, 2) : renderHuman(outcome.result));
    return outcome.exitCode;
  }
  const classified = classifyInventory(inventory, {
    now,
    thresholds: parsed.thresholds,
  });
  const { result } = classified;
  let exitCode = classified.exitCode;
  if (suppliedInventory === null && result.verification.complete) {
    result.verification.hookReceipts = pruneHookReceipts({ fsApi, env, uid, readIdentity });
  }
  if (parsed.snapshot) {
    try {
      const snapshot = buildExactTreeSnapshot({ inventory, inspection: result, readIdentity, now, uid });
      writeSnapshotAtomic(parsed.snapshot, snapshot, { fsApi, uid });
      result.verification.snapshot = {
        created: true,
        ownerPid: snapshot.owner.pid,
        targetPids: snapshot.targets.map((target) => target.pid),
      };
    } catch (error) {
      const code = error instanceof CleanupRefusal ? error.code : "snapshot-write-failed";
      result.status = "refused";
      result.selected = [];
      result.verification.complete = false;
      result.verification.missingEvidence = unique([...result.verification.missingEvidence, code]);
      result.verification.snapshot = { created: false, reason: code };
      exitCode = EXIT_CODES.refused;
    }
  }
  write(parsed.json ? JSON.stringify(result, null, 2) : renderHuman(result));
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runCli();
}
