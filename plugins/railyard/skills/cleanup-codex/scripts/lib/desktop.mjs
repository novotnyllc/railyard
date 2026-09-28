/**
 * Desktop recycle: quit and relaunch the ChatGPT/Codex app that hosts a GUI
 * app-server, then reap exact leftovers of the old server's tree.
 *
 * The host app is asked to quit gracefully and is never signalled. Only exact
 * recorded descendants of the selected app-server are reaped, through the
 * same machinery as `reap`.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  DEFAULT_DESKTOP_IDLE_SECONDS,
  DEFAULT_DESKTOP_POLL_MS,
  DEFAULT_DESKTOP_QUIT_TIMEOUT_MS,
  DEFAULT_DESKTOP_RELAUNCH_TIMEOUT_MS,
  DEFAULT_GRACE_MS,
  DEFAULT_MIN_SOFT_NOFILE,
  DEFAULT_POST_SIGNAL_MS,
  DESKTOP_RECEIPT_SCHEMA,
  EXIT_CODES,
  LAUNCHCTL,
  OPEN,
  OSASCRIPT,
  PLUTIL,
  SNAPSHOT_SCHEMA,
} from "./constants.mjs";
import {
  childrenByParent,
  classifyInventory,
  collectExactProcessIdentity,
  collectMacOSInventory,
  descendantsOf,
} from "./inventory.mjs";
import {
  CleanupRefusal,
  callerUid,
  defaultRunner,
  REVALIDATED_IDENTITY_FIELDS,
  identityDifferences,
  refuse,
  safeFailureCode,
  safeRun,
  sleepSync,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  reapSnapshot,
  signalExactPid,
} from "./reap.mjs";
import {
  assertExpectedIdentityGone,
  assertGuiPreserved,
  assertOldTreeGone,
  recycleConfirmationToken,
} from "./recycle-evidence.mjs";
import { desktopBusyReasons, readDesktopActivity } from "./desktop-activity.mjs";
import { armRelaunchWatchdog, validRelaunchPath } from "./desktop-watchdog.mjs";
import {
  createMutationLock,
  observeBirth,
  stillExactlyPresent,
  processBirthObservation,
  snapshotIdentity,
  validateSnapshotObject,
} from "./snapshot.mjs";

const MAIN_APP_EXECUTABLE = /^(\/.+\/(?:Codex|ChatGPT)\.app)\/Contents\/MacOS\/(?:Codex|ChatGPT)$/i;

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

export function readLaunchdMaxfiles(runner = defaultRunner) {
  const run = safeRun(runner, LAUNCHCTL, ["limit", "maxfiles"], { timeout: 5_000 });
  if (run.status !== 0) return null;
  const match = /maxfiles\s+(\S+)\s+(\S+)/.exec(run.stdout);
  if (!match) return null;
  const parse = (value) => (value === "unlimited" ? "unlimited" : Number.isInteger(Number(value)) ? Number(value) : null);
  const soft = parse(match[1]);
  const hard = parse(match[2]);
  return soft === null || hard === null ? null : { soft, hard };
}

export function launchdMaxfilesWarning(limits, minimum = DEFAULT_MIN_SOFT_NOFILE) {
  if (!limits || !Number.isInteger(limits.soft) || limits.soft >= minimum) return null;
  return {
    code: "desktop-launchd-maxfiles-low",
    observed: limits.soft,
    threshold: minimum,
    message: `launchd maxfiles soft limit ${limits.soft} is below ${minimum}, and GUI apps inherit it;`
      + ` raise it with a root LaunchDaemon that runs \`launchctl limit maxfiles ${minimum} unlimited\` at boot`
      + " (or Roundhouse machine config). A desktop recycle only resets the descriptor count until then",
    authorizesAction: false,
  };
}

// GUI apps inherit launchd's maxfiles soft limit, but the Codex app-server can
// raise its own. A descriptor at or above launchd's soft limit proves the
// server is not capped there, so launchd advice only applies below it.
export function appearsCappedByLaunchd(server, limits) {
  return Number.isInteger(limits?.soft)
    && Number.isInteger(server?.highestDescriptor)
    && server.highestDescriptor < limits.soft;
}

// Human-facing next steps for inspect: a GUI server under descriptor pressure
// that still looks capped by launchd is recycled by relaunching its app.
export function desktopRecommendations(inspection, limits, minimum = DEFAULT_MIN_SOFT_NOFILE) {
  const recommendations = [];
  const pressured = new Set(inspection.warnings
    .filter((warning) => warning.code === "fd-count-pressure" || warning.code === "highest-fd-pressure")
    .map((warning) => warning.pid));
  for (const server of inspection.verification.servers ?? []) {
    if (server.classification !== "gui" || !pressured.has(server.pid)) continue;
    if (!appearsCappedByLaunchd(server, limits)) continue;
    recommendations.push({
      code: "desktop-recycle-recommended",
      pid: server.pid,
      command: `recycle --pid ${server.pid} --desktop`,
      message: `GUI app-server ${server.pid} is under descriptor pressure: quit and relaunch the Codex desktop app`
        + ` (cleanup-codex recycle --pid ${server.pid} --desktop)`,
    });
  }
  const limitWarning = launchdMaxfilesWarning(limits, minimum);
  if (limitWarning && recommendations.length) {
    recommendations.push({ pid: null, ...limitWarning });
  }
  return recommendations;
}

export function readBundleIdentifier(runner, bundlePath) {
  const run = safeRun(runner, PLUTIL, [
    "-extract",
    "CFBundleIdentifier",
    "raw",
    "-o",
    "-",
    path.join(bundlePath, "Contents", "Info.plist"),
  ], { timeout: 5_000 });
  const value = run.status === 0 ? run.stdout.trim() : "";
  return BUNDLE_ID.test(value) ? value : null;
}

export function findDesktopHost(server, byPid) {
  const seen = new Set([server.pid]);
  let parentPid = server.parentPid;
  while (Number.isInteger(parentPid) && parentPid > 1 && !seen.has(parentPid)) {
    seen.add(parentPid);
    const record = byPid.get(parentPid);
    if (!record) return null;
    const match = MAIN_APP_EXECUTABLE.exec(record.executable ?? "");
    if (match) return { record, bundlePath: match[1] };
    parentPid = record.parentPid;
  }
  return null;
}

export function emptyDesktopResult(platform) {
  return {
    schemaVersion: 1,
    action: "recycle",
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
      mode: "desktop",
      launchdMaxfiles: null,
      idle: null,
      relaunch: null,
      receipt: null,
      before: null,
      actions: [],
      after: null,
      guiPreserved: false,
      servers: [],
    },
  };
}

function hostIdentity(record, bundlePath, bundleId) {
  return {
    pid: record.pid,
    parentPid: record.parentPid,
    processGroupId: record.processGroupId,
    uid: record.uid,
    startTime: record.startTime,
    executable: record.executable,
    bundlePath,
    bundleId,
  };
}

// Link each kept target to its nearest kept recorded ancestor, or the owner.
function linkTargets(owner, kept, recordedParent) {
  const keptPids = new Set(kept.map((target) => target.pid));
  return kept.map((target) => {
    let parentPid = target.parentPid;
    const seen = new Set();
    while (parentPid !== owner.pid && !keptPids.has(parentPid)) {
      if (seen.has(parentPid) || !recordedParent.has(parentPid)) {
        parentPid = owner.pid;
        break;
      }
      seen.add(parentPid);
      parentPid = recordedParent.get(parentPid);
    }
    return { ...target, parentPid };
  });
}

// Snapshot the selected GUI app-server and its exact live descendants. GUI
// trees churn, so a descendant that exits before it is observed is skipped;
// one whose identity changed refuses.
export function desktopTreeSnapshot({ inventory, owner, readIdentity, uid, now, skipped }) {
  const processes = Array.isArray(inventory.processes) ? inventory.processes : [];
  const recordedParent = new Map(processes.map((item) => [item.pid, item.parentPid]));
  const kept = [];
  for (const recorded of descendantsOf(owner.pid, childrenByParent(processes)).descendants) {
    const observation = readIdentity(recorded.pid);
    if (observation?.state === "absent") {
      skipped.push({ pid: recorded.pid, reasons: ["exited-before-snapshot"] });
      continue;
    }
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      // Without exact identity (for example a retitled `npm exec` MCP server)
      // the process is never signalled; it is only reported.
      skipped.push({
        pid: recorded.pid,
        reasons: ["identity-unavailable"],
        startTime: recorded.startTime ?? null,
      });
      continue;
    }
    const identity = observation.identity;
    // A reparented descendant has left the server's tree.
    if (identityDifferences(recorded, identity, ["pid", "parentPid", "uid", "startTime", "processGroupId"]).length) {
      refuse("snapshot-tree-changed");
    }
    if (identity.uid !== uid) {
      skipped.push({ pid: recorded.pid, reasons: ["foreign-user"] });
      continue;
    }
    kept.push(snapshotIdentity(identity, "descendant"));
  }
  return validateSnapshotObject({
    schema: SNAPSHOT_SCHEMA,
    createdAt: new Date(now).toISOString(),
    createdByUid: uid,
    owner: snapshotIdentity(owner, "server"),
    targets: linkTargets(owner, kept, recordedParent),
  }, uid);
}

// Keep only targets whose exact identity is still present, for reaping.
export function stillMatchingResidue(snapshot, readIdentity, uid) {
  const recordedParent = new Map(snapshot.targets.map((target) => [target.pid, target.parentPid]));
  const kept = snapshot.targets.filter((target) => {
    const observation = readIdentity(target.pid);
    return observation?.state === "present"
      && validObservedIdentity(observation.identity)
      && identityDifferences(target, observation.identity).length === 0;
  });
  return validateSnapshotObject({
    ...snapshot,
    targets: linkTargets(snapshot.owner, kept, recordedParent),
  }, uid);
}

// The one completeness rule for choosing a server before the quit and for
// accepting its replacement after the relaunch: no inventory collection error,
// and complete evidence for that server itself. Another server's gap (say a
// VS Code-hosted stdio app-server) is not this recycle's to prove.
export function desktopServerEvidenceGap(verification, server = null) {
  if (verification?.missingEvidence?.length) return "inventory-incomplete";
  if (server && (!Array.isArray(server.missingEvidence) || server.missingEvidence.length)) {
    return "selected-server-ambiguous";
  }
  return null;
}

// PIDs from `pid` up to launchd, or null when any link is missing.
export function processAncestry(pid, byPid) {
  const chain = [];
  let current = pid;
  while (Number.isInteger(current) && current > 1) {
    if (chain.includes(current)) return null;
    const record = byPid.get(current);
    if (!record) return null;
    chain.push(current);
    current = record.parentPid;
  }
  return current === 1 || current === 0 ? chain : null;
}

function desktopEvidence(inventory, { pid, uid, now }, deps) {
  const classified = classifyInventory(inventory, { now });
  const verification = classified.result.verification;
  const inventoryGap = desktopServerEvidenceGap(verification);
  if (inventoryGap) refuse(inventoryGap);
  const server = verification.servers.find((candidate) => candidate.pid === pid);
  if (!server) refuse("selected-pid-not-app-server");
  if (server.classification !== "gui") refuse("selected-server-not-gui");
  const serverGap = desktopServerEvidenceGap(verification, server);
  if (serverGap) refuse(serverGap);
  if (server.uid !== uid) refuse("selected-server-wrong-user");

  const processes = inventory.processes ?? [];
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const host = findDesktopHost(server, byPid);
  if (!host) refuse("desktop-host-unidentified");
  if (host.record.uid !== uid) refuse("desktop-host-wrong-user");
  if (processes.filter((item) => item.executable === host.record.executable).length !== 1) {
    refuse("desktop-host-ambiguous");
  }
  // Quitting the host ends every process under it. A recycle run from inside
  // the app (its terminal, or a Codex turn under the server) would kill its
  // own controller before the relaunch, so it refuses instead.
  const selfChain = processAncestry(deps.selfPid, byPid);
  if (!selfChain) refuse("desktop-self-ancestry-unknown");
  if (selfChain.includes(host.record.pid) || selfChain.includes(server.pid)) {
    refuse("desktop-recycle-inside-app");
  }
  const hostObservation = deps.readIdentity(host.record.pid);
  if (
    hostObservation?.state !== "present"
    || !validObservedIdentity(hostObservation.identity)
    || identityDifferences(host.record, hostObservation.identity, REVALIDATED_IDENTITY_FIELDS).length
  ) refuse("desktop-host-changed");
  let bundleId = null;
  try {
    bundleId = deps.readBundleIdentifier(host.bundlePath);
  } catch {}
  if (typeof bundleId !== "string" || !BUNDLE_ID.test(bundleId)) refuse("desktop-bundle-id-unavailable");
  // The quit is addressed by bundle id, so another running copy of the app
  // (a second install with the same id) could be the one that quits.
  const otherBundles = unique(processes
    .map((item) => MAIN_APP_EXECUTABLE.exec(item.executable ?? "")?.[1])
    .filter((bundlePath) => bundlePath && bundlePath !== host.bundlePath));
  for (const bundlePath of otherBundles) {
    let other = null;
    try {
      other = deps.readBundleIdentifier(bundlePath);
    } catch {}
    if (typeof other !== "string" || !BUNDLE_ID.test(other)) refuse("desktop-bundle-id-unavailable");
    if (other === bundleId) refuse("desktop-bundle-id-ambiguous");
  }

  const ownerObservation = deps.readIdentity(server.pid);
  if (
    ownerObservation?.state !== "present"
    || !validObservedIdentity(ownerObservation.identity)
    || ownerObservation.identity.uid !== uid
    || identityDifferences(server, ownerObservation.identity).length
  ) refuse("snapshot-owner-changed");

  // GUI servers hosted by any other app process must survive the recycle.
  const otherGui = verification.servers
    .filter((candidate) => candidate.classification === "gui" && candidate.pid !== server.pid)
    .filter((candidate) => findDesktopHost(candidate, byPid)?.record.pid !== host.record.pid)
    .map((candidate) => {
      const observation = deps.readIdentity(candidate.pid);
      if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
        refuse("gui-baseline-unavailable");
      }
      return observation.identity;
    });

  return {
    servers: verification.servers,
    server,
    owner: ownerObservation.identity,
    host: hostIdentity(host.record, host.bundlePath, bundleId),
    otherGui,
  };
}

export function buildDesktopReceipt(evidence, snapshot, launchdMaxfiles) {
  // The token binds the host instance, bundle, and exact app-server. Its
  // descendants are re-snapshotted under the lock, because GUI trees churn.
  const core = {
    schema: DESKTOP_RECEIPT_SCHEMA,
    mode: "desktop",
    host: evidence.host,
    server: snapshot.owner,
  };
  const confirmationToken = recycleConfirmationToken(core);
  return {
    ...core,
    targets: snapshot.targets,
    selectedPids: [snapshot.owner.pid, ...snapshot.targets.map((target) => target.pid)]
      .sort((left, right) => left - right),
    launchdMaxfiles,
    confirmationToken,
  };
}

function waitUntil(deps, timeoutMs, probe) {
  const deadline = deps.monotonicNow() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    const remaining = deadline - deps.monotonicNow();
    if (remaining <= 0) return null;
    deps.sleep(Math.min(deps.pollMs, remaining));
  }
}

function findRelaunched(inventory, oldHost, oldOwner, uid, now) {
  const classified = classifyInventory(inventory, { now });
  const { verification } = classified.result;
  // A collection error is not proof of a healthy replacement; keep polling.
  // The same rule as the pre-flight: only the candidate's own evidence counts.
  if (desktopServerEvidenceGap(verification)) return null;
  const byPid = new Map((inventory.processes ?? []).map((item) => [item.pid, item]));
  for (const server of verification.servers) {
    if (server.classification !== "gui" || server.uid !== uid) continue;
    if (desktopServerEvidenceGap(verification, server)) continue;
    const serverRecord = byPid.get(server.pid);
    // A reused PID with a new birth is a valid replacement.
    if (!serverRecord || (server.pid === oldOwner.pid && serverRecord.startTime === oldOwner.startTime)) continue;
    const host = findDesktopHost(server, byPid);
    if (!host || host.record.executable !== oldHost.executable) continue;
    if (host.record.pid === oldHost.pid && host.record.startTime === oldHost.startTime) continue;
    return { server, serverRecord, host: host.record };
  }
  return null;
}

// The replacement host and server must still be the processes the inventory saw.
function relaunchStillLive(relaunched, readIdentity) {
  return [relaunched.host, relaunched.serverRecord].every((record) => stillExactlyPresent(record, readIdentity));
}

export function recycleDesktop(options, deps) {
  const platform = options?.platform ?? process.platform;
  const uid = options?.uid ?? callerUid();
  const minSoftLimit = options?.minSoftLimit ?? DEFAULT_MIN_SOFT_NOFILE;
  const now = options?.now ?? Date.now();
  const result = emptyDesktopResult(platform);
  let exitCode = EXIT_CODES.refused;
  let release = null;

  try {
    if (platform !== "darwin") refuse("unsupported-platform");
    if (!Number.isInteger(options?.pid) || options.pid <= 0) refuse("recycle-pid-required");
    if (!Number.isInteger(minSoftLimit) || minSoftLimit <= 0) refuse("invalid-minimum-soft-limit");
    if (
      !deps?.inventory
      || [
        "readIdentity", "collectInventory", "readBundleIdentifier", "readDesktopActivity",
        "quitApp", "launchApp", "armRelaunchWatchdog", "reapResidue", "sleep", "monotonicNow",
      ].some((name) => typeof deps[name] !== "function")
      || !Number.isInteger(deps.selfPid)
    ) refuse("desktop-evidence-unavailable");

    let launchdMaxfiles = null;
    try {
      launchdMaxfiles = deps.readLaunchdMaxfiles?.() ?? null;
    } catch {}
    result.verification.launchdMaxfiles = launchdMaxfiles;

    const context = { pid: options.pid, uid, now };
    const evidence = desktopEvidence(deps.inventory, context, deps);
    result.verification.servers = evidence.servers;
    if (appearsCappedByLaunchd(evidence.server, launchdMaxfiles)) {
      const limitWarning = launchdMaxfilesWarning(launchdMaxfiles, minSoftLimit);
      if (limitWarning) result.warnings.push({ pid: options.pid, ...limitWarning });
    }
    const firstSnapshot = desktopTreeSnapshot({
      inventory: deps.inventory,
      owner: evidence.owner,
      readIdentity: deps.readIdentity,
      uid,
      now,
      skipped: result.skipped,
    });
    const receipt = buildDesktopReceipt(evidence, firstSnapshot, launchdMaxfiles);
    result.verification.receipt = receipt;
    result.verification.before = {
      host: evidence.host,
      pid: evidence.server.pid,
      descriptors: {
        count: evidence.server.descriptorCount,
        highest: evidence.server.highestDescriptor,
      },
      descendants: evidence.server.descendants,
      targetPids: firstSnapshot.targets.map((target) => target.pid),
    };
    result.selected = receipt.selectedPids.map((pid) => ({
      pid,
      role: pid === evidence.server.pid ? "server" : "descendant",
    }));
    // Quitting interrupts any running turn, so only an idle app is recycled.
    const idleSeconds = options.idleSeconds ?? DEFAULT_DESKTOP_IDLE_SECONDS;
    if (!Number.isInteger(idleSeconds) || idleSeconds < 0) refuse("invalid-idle-seconds");
    // The process tree is read after the activity probe, so a child started
    // while the probe ran is still seen.
    const checkIdle = (inventorySource) => {
      let activity = null;
      try {
        activity = deps.readDesktopActivity({ serverPid: receipt.server.pid, nowMs: options.now ?? Date.now() });
      } catch {}
      let inventory = null;
      try {
        inventory = typeof inventorySource === "function" ? inventorySource() : inventorySource;
      } catch {}
      const reasons = desktopBusyReasons({
        activity,
        inventory,
        serverPid: receipt.server.pid,
        bundleId: receipt.host.bundleId,
        nowMs: options.now ?? Date.now(),
        idleMs: idleSeconds * 1000,
      });
      result.verification.idle = {
        idle: reasons.length === 0,
        idleSeconds,
        reasons,
        unknown: activity?.complete ? null : activity?.unknown ?? "desktop-activity-unavailable",
        lastActivityAt: Number.isFinite(activity?.latestActivityMs) && activity.latestActivityMs > 0
          ? new Date(activity.latestActivityMs).toISOString()
          : null,
      };
      if (reasons.length) refuse("desktop-busy");
      return inventory;
    };
    checkIdle(deps.inventory);
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

    // Re-derive everything from a fresh inventory under the lock.
    result.skipped = [];
    const lockedInventory = deps.collectInventory();
    const locked = desktopEvidence(lockedInventory, context, deps);
    const lockedSnapshot = desktopTreeSnapshot({
      inventory: lockedInventory,
      owner: locked.owner,
      readIdentity: deps.readIdentity,
      uid,
      now,
      skipped: result.skipped,
    });
    if (buildDesktopReceipt(locked, lockedSnapshot, launchdMaxfiles).confirmationToken !== receipt.confirmationToken) {
      refuse("desktop-identity-changed");
    }
    // Descendants churn; report what the locked snapshot will actually act on.
    const lockedSelectedPids = [lockedSnapshot.owner.pid, ...lockedSnapshot.targets.map((target) => target.pid)]
      .sort((left, right) => left - right);
    result.verification.receipt = { ...receipt, targets: lockedSnapshot.targets, selectedPids: lockedSelectedPids };
    result.verification.before.targetPids = lockedSnapshot.targets.map((target) => target.pid);
    result.selected = lockedSelectedPids.map((pid) => ({
      pid,
      role: pid === lockedSnapshot.owner.pid ? "server" : "descendant",
    }));
    assertGuiPreserved(evidence.otherGui, deps.readIdentity);
    const lockedInventoryAfterIdle = checkIdle(() => deps.collectInventory());
    // The app can restart on its own during the idle check; quit only the bound births.
    if (!stillExactlyPresent(receipt.host, deps.readIdentity)
      || !stillExactlyPresent(receipt.server, deps.readIdentity)) {
      refuse("desktop-identity-changed");
    }
    // The relaunch target must be usable before anything is quit.
    if (!validRelaunchPath(receipt.host.bundlePath)
      || !receipt.host.executable.startsWith(`${receipt.host.bundlePath}/Contents/MacOS/`)) {
      refuse("desktop-relaunch-path-invalid");
    }
    // One last activity read, immediately before the quit: a turn started
    // while the process inventory above ran is still caught.
    checkIdle(lockedInventoryAfterIdle);
    // A detached watchdog reopens the app if this process dies after the
    // quit, the quit lands after this process gives up, or anything throws.
    let watchdog = null;
    try {
      watchdog = deps.armRelaunchWatchdog({
        hostPid: receipt.host.pid,
        hostStartTime: receipt.host.startTime,
        bundlePath: receipt.host.bundlePath,
      });
    } catch {}
    if (!watchdog?.ok) refuse("desktop-watchdog-unavailable");
    result.verification.watchdog = { armed: true, pid: watchdog.pid ?? null };

    // Ask the app to quit. The host is never signalled. The quit event can
    // land even when osascript reports failure, so record the attempt first.
    result.verification.mutationAttempted = true;
    result.verification.actions.push({ kind: "quit-desktop-app", bundleId: receipt.host.bundleId, hostPid: receipt.host.pid });
    let quit = null;
    try {
      quit = deps.quitApp(receipt.host.bundleId);
    } catch {}
    const failures = quitAndRestore({ receipt, lockedSnapshot, evidence, quit, uid, now, deps, result });
    if (failures.length) {
      result.verification.missingEvidence.push(...failures);
      result.status = "failed";
      exitCode = EXIT_CODES.failed;
    } else {
      result.verification.guiPreserved = true;
      result.verification.complete = true;
      result.status = "healthy";
      exitCode = EXIT_CODES.healthy;
    }
  } catch (error) {
    const code = error instanceof CleanupRefusal ? error.code : "desktop-recycle-evidence-failed";
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
        result.status = result.verification.mutationAttempted ? "failed" : "refused";
        exitCode = result.verification.mutationAttempted ? EXIT_CODES.failed : EXIT_CODES.refused;
      }
    }
  }
  result.verification.missingEvidence = unique(result.verification.missingEvidence);
  return { result, exitCode };
}

// Everything after the quit request. It never throws: once the app is not
// shown running, the relaunch always happens (from `finally` if need be), and
// every failure is returned to be reported beside it.
function quitAndRestore({ receipt, lockedSnapshot, evidence, quit, uid, now, deps, result }) {
  const failures = [];
  const fail = (error, fallback) => {
    failures.push(error instanceof CleanupRefusal ? error.code : fallback);
  };
  let launchAttempted = false;
  let relaunched = null;
  const relaunch = () => {
    launchAttempted = true;
    let launched = null;
    try {
      launched = deps.launchApp(receipt.host.bundlePath, receipt.host.bundleId);
    } catch {}
    result.verification.actions.push({ kind: "relaunch-desktop-app", bundlePath: receipt.host.bundlePath, ok: launched?.ok === true });
    result.verification.relaunch = { attempted: true, requested: launched?.ok === true, verified: false };
    if (!launched?.ok) failures.push("desktop-relaunch-failed");
    return launched?.ok === true;
  };
  try {
    // Even a failed request may have delivered the quit event, so always wait.
    const quitTimeoutMs = deps.quitTimeoutMs ?? DEFAULT_DESKTOP_QUIT_TIMEOUT_MS;
    const hostGone = waitUntil(deps, quitTimeoutMs, () => observeBirth(receipt.host, deps.readIdentity) === "gone");
    if (!hostGone) {
      // Still running (say, a dialog is open): nothing is forced, and the
      // armed watchdog reopens the app if the quit lands later.
      if (observeBirth(receipt.host, deps.readIdentity) === "present") {
        failures.push(quit?.ok ? "desktop-host-quit-timeout" : "desktop-quit-request-failed");
        result.warnings.push({
          code: "desktop-quit-may-still-land",
          pid: receipt.host.pid,
          message: "the app did not quit in time; if it quits within 10 minutes, the watchdog reopens it",
          authorizesAction: false,
        });
        return failures;
      }
      failures.push("desktop-host-quit-unverified");
    }

    // The app is closed (or cannot be shown running): reopen that exact
    // bundle at once, then check what the quit left behind.
    if (relaunch()) {
      relaunched = waitUntil(deps, deps.relaunchTimeoutMs ?? DEFAULT_DESKTOP_RELAUNCH_TIMEOUT_MS, () => {
        try {
          const found = findRelaunched(deps.collectInventory(), receipt.host, receipt.server, uid, now);
          return found && relaunchStillLive(found, deps.readIdentity) ? found : null;
        } catch {
          return null;
        }
      });
      if (!relaunched) failures.push("desktop-relaunch-timeout");
    }
    if (!waitUntil(deps, quitTimeoutMs, () => observeBirth(receipt.server, deps.readIdentity) === "gone")) {
      failures.push("desktop-server-survived-host");
    }

    // Reap exact leftovers of the old app-server tree. They are bound to exact
    // identities, so the new app's processes are never mistaken for them.
    try {
      const residue = stillMatchingResidue(lockedSnapshot, deps.readIdentity, uid);
      if (residue.targets.length) {
        const ownerReplacement = relaunched?.serverRecord.pid === lockedSnapshot.owner.pid
          ? { pid: relaunched.serverRecord.pid, startTime: relaunched.serverRecord.startTime }
          : null;
        const reaped = deps.reapResidue(residue, { ownerReplacement });
        if (reaped?.exitCode !== EXIT_CODES.healthy) {
          refuse(safeFailureCode(reaped?.result?.verification?.missingEvidence?.[0], "residue-reap-incomplete"));
        }
      }
      result.verification.actions.push({ kind: "reap-exact-residue", pids: residue.targets.map((target) => target.pid) });
    } catch (error) {
      fail(error, "residue-reap-incomplete");
    }
    for (const [check, fallback] of [
      [() => assertOldTreeGone(lockedSnapshot, deps.readIdentity), "old-tree-verification-unknown"],
      [() => assertExpectedIdentityGone(receipt.host, deps.readIdentity, "old-host-survivor", "old-host-verification-unknown"), "old-host-verification-unknown"],
      [() => assertGuiPreserved(evidence.otherGui, deps.readIdentity), "gui-verification-unknown"],
    ]) {
      try {
        check();
      } catch (error) {
        fail(error, fallback);
      }
    }
    warnUnidentifiedSurvivors(result, deps);
    if (relaunched && !relaunchStillLive(relaunched, deps.readIdentity)) {
      failures.push("replacement-identity-changed");
      relaunched = null;
    }
    if (relaunched) {
      result.verification.relaunch.verified = true;
      result.verification.after = {
        hostPid: relaunched.host.pid,
        pid: relaunched.server.pid,
        descriptors: {
          count: relaunched.server.descriptorCount,
          highest: relaunched.server.highestDescriptor,
        },
        descendants: relaunched.server.descendants,
        oldTreeGone: !failures.some((code) => code.startsWith("old-tree")),
      };
    }
  } catch (error) {
    fail(error, "desktop-recycle-evidence-failed");
  } finally {
    // Whatever failed above, an app that is not shown running is reopened.
    if (!launchAttempted && observeBirth(receipt.host, deps.readIdentity) !== "present") {
      try {
        relaunch();
      } catch {}
    }
  }
  return failures;
}

function warnUnidentifiedSurvivors(result, deps) {
  if (typeof deps.readBirth !== "function") return;
  for (const item of result.skipped.filter((entry) => entry.reasons.includes("identity-unavailable"))) {
    let birth = null;
    try {
      birth = deps.readBirth(item.pid);
    } catch {}
    if (birth?.state === "present" && item.startTime && birth.startTime === item.startTime) {
      result.warnings.push({
        code: "desktop-unidentified-survivor",
        pid: item.pid,
        message: `old descendant ${item.pid} outlived the app but lacks exact identity, so it was not signalled`,
        authorizesAction: false,
      });
    }
  }
}

export function createDefaultDesktopDependencies({
  inventory,
  runner = defaultRunner,
  uid = callerUid(),
  readIdentity = null,
  signalProcess = signalExactPid,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  monotonicNow = () => performance.now(),
  lock = createMutationLock({ uid }),
  quitTimeoutMs = DEFAULT_DESKTOP_QUIT_TIMEOUT_MS,
  relaunchTimeoutMs = DEFAULT_DESKTOP_RELAUNCH_TIMEOUT_MS,
  pollMs = DEFAULT_DESKTOP_POLL_MS,
  selfPid = process.pid,
  spawnProcess = spawn,
} = {}) {
  readIdentity ??= (pid) => collectExactProcessIdentity(pid, { runner });
  return {
    inventory,
    selfPid,
    collectInventory: () => collectMacOSInventory({ runner, platform: "darwin" }),
    readIdentity,
    readBundleIdentifier: (bundlePath) => readBundleIdentifier(runner, bundlePath),
    readLaunchdMaxfiles: () => readLaunchdMaxfiles(runner),
    readBirth: (pid) => processBirthObservation(pid, runner),
    readDesktopActivity: ({ serverPid, nowMs }) => readDesktopActivity({ runner, serverPid, nowMs }),
    // The bundle id is validated against BUNDLE_ID, so it cannot break out of
    // the AppleScript string literal.
    quitApp(bundleId) {
      if (!BUNDLE_ID.test(bundleId)) return { ok: false };
      const run = safeRun(runner, OSASCRIPT, ["-e", `tell application id "${bundleId}" to quit`], { timeout: 20_000 });
      return { ok: run.status === 0 };
    },
    // Reopen the exact bundle that was quit. Only if that path fails (say it
    // was translocated) fall back to the bundle id, which no other running
    // copy shares (checked before the quit).
    launchApp(bundlePath, bundleId) {
      if (!validRelaunchPath(bundlePath)) return { ok: false };
      if (safeRun(runner, OPEN, [bundlePath], { timeout: 20_000 }).status === 0) return { ok: true };
      if (!BUNDLE_ID.test(bundleId ?? "")) return { ok: false };
      return { ok: safeRun(runner, OPEN, ["-b", bundleId], { timeout: 20_000 }).status === 0 };
    },
    armRelaunchWatchdog: (args) => armRelaunchWatchdog(args, { spawnProcess }),
    reapResidue(snapshot, { ownerReplacement = null } = {}) {
      return reapSnapshot(snapshot, {
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
    },
    sleep,
    monotonicNow,
    quitTimeoutMs,
    relaunchTimeoutMs,
    pollMs,
    lock,
  };
}
