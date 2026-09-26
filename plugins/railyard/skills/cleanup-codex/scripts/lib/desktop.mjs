/**
 * Desktop recycle: quit and relaunch the ChatGPT/Codex app that hosts a GUI
 * app-server, then reap exact leftovers of the old server's tree.
 *
 * The host app is asked to quit gracefully and is never signalled. Only exact
 * recorded descendants of the selected app-server are reaped, through the
 * same machinery as `reap`.
 */

import fs from "node:fs";
import os from "node:os";
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
  LSAPPINFO,
  OPEN,
  OSASCRIPT,
  PLUTIL,
  SNAPSHOT_SCHEMA,
  SQLITE3,
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
import {
  createMutationLock,
  processBirthObservation,
  sameBirthIdentityPresent,
  snapshotIdentity,
  validateSnapshotObject,
} from "./snapshot.mjs";

const MAIN_APP_EXECUTABLE = /^(\/.+\/(?:Codex|ChatGPT)\.app)\/Contents\/MacOS\/(?:Codex|ChatGPT)$/i;

const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$/;

const HOST_IDENTITY_FIELDS = ["pid", "uid", "startTime", "executable", "processGroupId"];

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

// Human-facing next steps for inspect: GUI servers under descriptor pressure
// are recycled by relaunching their desktop app.
export function desktopRecommendations(inspection, limits, minimum = DEFAULT_MIN_SOFT_NOFILE) {
  const recommendations = [];
  const pressured = new Set(inspection.warnings
    .filter((warning) => warning.code === "fd-count-pressure" || warning.code === "highest-fd-pressure")
    .map((warning) => warning.pid));
  for (const server of inspection.verification.servers ?? []) {
    if (server.classification !== "gui" || !pressured.has(server.pid)) continue;
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

function desktopEvidence(inventory, { pid, uid, now }, deps) {
  const classified = classifyInventory(inventory, { now });
  const verification = classified.result.verification;
  if (verification.missingEvidence.length) refuse("inventory-incomplete");
  const server = verification.servers.find((candidate) => candidate.pid === pid);
  if (!server) refuse("selected-pid-not-app-server");
  if (server.classification !== "gui") refuse("selected-server-not-gui");
  if (server.missingEvidence.length) refuse("selected-server-ambiguous");
  if (server.uid !== uid) refuse("selected-server-wrong-user");

  const processes = inventory.processes ?? [];
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const host = findDesktopHost(server, byPid);
  if (!host) refuse("desktop-host-unidentified");
  if (host.record.uid !== uid) refuse("desktop-host-wrong-user");
  if (processes.filter((item) => item.executable === host.record.executable).length !== 1) {
    refuse("desktop-host-ambiguous");
  }
  const hostObservation = deps.readIdentity(host.record.pid);
  if (
    hostObservation?.state !== "present"
    || !validObservedIdentity(hostObservation.identity)
    || identityDifferences(host.record, hostObservation.identity, HOST_IDENTITY_FIELDS).length
  ) refuse("desktop-host-changed");
  let bundleId = null;
  try {
    bundleId = deps.readBundleIdentifier(host.bundlePath);
  } catch {}
  if (typeof bundleId !== "string" || !BUNDLE_ID.test(bundleId)) refuse("desktop-bundle-id-unavailable");

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

// Read-only signals that Codex work is running: the newest rollout write or
// thread update in Codex's state database, and which app is frontmost.
// Anything unreadable leaves `complete` false, which counts as busy.
export function readDesktopActivity({ runner = defaultRunner, codexHome, fsApi = fs } = {}) {
  const activity = { complete: false, latestActivityMs: null, frontmostBundleId: null };
  const database = path.join(codexHome, "state_5.sqlite");
  const query = safeRun(runner, SQLITE3, [
    "-readonly",
    "-json",
    `file:${database}?mode=ro`,
    "SELECT rollout_path, updated_at_ms FROM threads WHERE archived = 0 ORDER BY updated_at_ms DESC LIMIT 50",
  ], { timeout: 5_000 });
  if (query.status !== 0 || typeof query.stdout !== "string") return activity;
  let rows;
  try {
    rows = query.stdout.trim() ? JSON.parse(query.stdout) : [];
  } catch {
    return activity;
  }
  if (!Array.isArray(rows)) return activity;
  let latest = 0;
  for (const row of rows) {
    if (Number.isFinite(row?.updated_at_ms)) latest = Math.max(latest, row.updated_at_ms);
    if (typeof row?.rollout_path !== "string") continue;
    try {
      latest = Math.max(latest, fsApi.statSync(row.rollout_path).mtimeMs);
    } catch {}
  }
  activity.latestActivityMs = latest;
  const front = safeRun(runner, LSAPPINFO, ["front"], { timeout: 5_000 });
  const asn = typeof front.stdout === "string" ? front.stdout.trim() : "";
  if (front.status !== 0 || !/^ASN:[0-9a-fx-]+:?$/i.test(asn)) return activity;
  const info = safeRun(runner, LSAPPINFO, ["info", "-only", "bundleid", asn], { timeout: 5_000 });
  const match = typeof info.stdout === "string"
    ? info.stdout.match(/bundle(?:ID|identifier)"?\s*=\s*"([^"]+)"/i)
    : null;
  // An unparsed frontmost app is unknown, which counts as busy.
  if (info.status !== 0 || !match) return activity;
  activity.frontmostBundleId = match[1];
  activity.complete = true;
  return activity;
}

// Reasons the desktop app looks busy; empty means idle enough to recycle.
export function desktopBusyReasons({ activity, inventory, serverPid, bundleId, nowMs, idleMs }) {
  const reasons = [];
  if (!activity?.complete) return ["desktop-activity-unknown"];
  if (Number.isFinite(activity.latestActivityMs) && nowMs - activity.latestActivityMs < idleMs) {
    reasons.push("codex-activity-recent");
  }
  if (activity.frontmostBundleId && activity.frontmostBundleId === bundleId) {
    reasons.push("desktop-app-frontmost");
  }
  const processes = Array.isArray(inventory?.processes) ? inventory.processes : [];
  const recentChild = descendantsOf(serverPid, childrenByParent(processes)).descendants.some((item) => {
    const started = Date.parse(item.startTime ?? "");
    return !Number.isFinite(started) || nowMs - started < idleMs;
  });
  if (recentChild) reasons.push("recent-app-server-child");
  return reasons;
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

function goneOrReused(expected, observation) {
  if (observation?.state === "absent") return true;
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && !sameBirthIdentityPresent(expected, observation);
}

function findRelaunched(inventory, oldHost, oldOwner, uid, now) {
  const classified = classifyInventory(inventory, { now });
  // An incomplete inventory is not proof of a healthy replacement; keep polling.
  if (!classified.result.verification.complete) return null;
  const byPid = new Map((inventory.processes ?? []).map((item) => [item.pid, item]));
  for (const server of classified.result.verification.servers) {
    if (server.classification !== "gui" || server.uid !== uid) continue;
    if (server.missingEvidence?.length) continue;
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
  return [relaunched.host, relaunched.serverRecord].every((record) => {
    let observation;
    try {
      observation = readIdentity(record.pid);
    } catch {
      return false;
    }
    return observation?.state === "present"
      && validObservedIdentity(observation.identity)
      && !identityDifferences(record, observation.identity, ["pid", "uid", "startTime", "executable"]).length;
  });
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
      || ["readIdentity", "collectInventory", "readBundleIdentifier", "quitApp", "launchApp", "reapResidue", "sleep", "monotonicNow"]
        .some((name) => typeof deps[name] !== "function")
    ) refuse("desktop-evidence-unavailable");

    let launchdMaxfiles = null;
    try {
      launchdMaxfiles = deps.readLaunchdMaxfiles?.() ?? null;
    } catch {}
    result.verification.launchdMaxfiles = launchdMaxfiles;
    const limitWarning = launchdMaxfilesWarning(launchdMaxfiles, minSoftLimit);
    if (limitWarning) result.warnings.push({ pid: options.pid, ...limitWarning });

    const context = { pid: options.pid, uid, now };
    const evidence = desktopEvidence(deps.inventory, context, deps);
    result.verification.servers = evidence.servers;
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
    const checkIdle = (inventory) => {
      let activity = null;
      try {
        activity = deps.readDesktopActivity?.() ?? null;
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
        lastActivityAt: Number.isFinite(activity?.latestActivityMs) && activity.latestActivityMs > 0
          ? new Date(activity.latestActivityMs).toISOString()
          : null,
      };
      if (reasons.length) refuse("desktop-busy");
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
    checkIdle(lockedInventory);
    // The app can restart on its own during the idle check; quit only the bound births.
    const stillBound = (expected, fields) => {
      let observation;
      try {
        observation = deps.readIdentity(expected.pid);
      } catch {
        return false;
      }
      return observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !identityDifferences(expected, observation.identity, fields).length;
    };
    if (!stillBound(receipt.host, HOST_IDENTITY_FIELDS)
      || !stillBound(receipt.server, ["pid", "uid", "startTime", "executable"])) {
      refuse("desktop-identity-changed");
    }

    // Ask the app to quit. The host is never signalled. The quit event can
    // land even when osascript reports failure, so record the attempt first.
    result.verification.mutationAttempted = true;
    result.verification.actions.push({ kind: "quit-desktop-app", bundleId: receipt.host.bundleId, hostPid: receipt.host.pid });
    let quit = null;
    try {
      quit = deps.quitApp(receipt.host.bundleId);
    } catch {}
    // Even a failed request may have delivered the quit event, so always wait.
    const quitTimeoutMs = deps.quitTimeoutMs ?? DEFAULT_DESKTOP_QUIT_TIMEOUT_MS;
    const hostGone = waitUntil(deps, quitTimeoutMs, () => goneOrReused(receipt.host, deps.readIdentity(receipt.host.pid)));
    if (!hostGone) refuse(quit?.ok ? "desktop-host-quit-timeout" : "desktop-quit-request-failed");
    const serverGone = waitUntil(deps, quitTimeoutMs, () => goneOrReused(receipt.server, deps.readIdentity(receipt.server.pid)));
    if (!serverGone) refuse("desktop-server-survived-host");

    // Reap exact leftovers of the old app-server tree.
    const residue = stillMatchingResidue(lockedSnapshot, deps.readIdentity, uid);
    if (residue.targets.length) {
      const reaped = deps.reapResidue(residue);
      if (reaped?.exitCode !== EXIT_CODES.healthy) {
        refuse(safeFailureCode(reaped?.result?.verification?.missingEvidence?.[0], "residue-reap-incomplete"));
      }
    }
    result.verification.actions.push({
      kind: "reap-exact-residue",
      pids: residue.targets.map((target) => target.pid),
    });

    // Relaunch and wait for a fresh host and GUI app-server.
    let launched = null;
    try {
      launched = deps.launchApp(receipt.host.bundleId);
    } catch {}
    if (!launched?.ok) refuse("desktop-relaunch-failed");
    result.verification.actions.push({ kind: "relaunch-desktop-app", bundleId: receipt.host.bundleId });
    const relaunched = waitUntil(
      deps,
      deps.relaunchTimeoutMs ?? DEFAULT_DESKTOP_RELAUNCH_TIMEOUT_MS,
      () => {
        try {
          const found = findRelaunched(deps.collectInventory(), receipt.host, receipt.server, uid, now);
          return found && relaunchStillLive(found, deps.readIdentity) ? found : null;
        } catch {
          return null;
        }
      },
    );
    if (!relaunched) refuse("desktop-relaunch-timeout");

    assertOldTreeGone(lockedSnapshot, deps.readIdentity);
    if (typeof deps.readBirth === "function") {
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
    assertExpectedIdentityGone(receipt.host, deps.readIdentity, "old-host-survivor", "old-host-verification-unknown");
    assertGuiPreserved(evidence.otherGui, deps.readIdentity);
    if (!relaunchStillLive(relaunched, deps.readIdentity)) refuse("replacement-identity-changed");

    result.verification.after = {
      hostPid: relaunched.host.pid,
      pid: relaunched.server.pid,
      descriptors: {
        count: relaunched.server.descriptorCount,
        highest: relaunched.server.highestDescriptor,
      },
      descendants: relaunched.server.descendants,
      oldTreeGone: true,
    };
    result.verification.guiPreserved = true;
    result.verification.complete = true;
    result.status = "healthy";
    exitCode = EXIT_CODES.healthy;
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
  env = process.env,
} = {}) {
  readIdentity ??= (pid) => collectExactProcessIdentity(pid, { runner });
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  return {
    inventory,
    collectInventory: () => collectMacOSInventory({ runner, platform: "darwin" }),
    readIdentity,
    readBundleIdentifier: (bundlePath) => readBundleIdentifier(runner, bundlePath),
    readLaunchdMaxfiles: () => readLaunchdMaxfiles(runner),
    readBirth: (pid) => processBirthObservation(pid, runner),
    readDesktopActivity: () => readDesktopActivity({ runner, codexHome }),
    // The bundle id is validated against BUNDLE_ID, so it cannot break out of
    // the AppleScript string literal.
    quitApp(bundleId) {
      if (!BUNDLE_ID.test(bundleId)) return { ok: false };
      const run = safeRun(runner, OSASCRIPT, ["-e", `tell application id "${bundleId}" to quit`], { timeout: 20_000 });
      return { ok: run.status === 0 };
    },
    launchApp(bundleId) {
      if (!BUNDLE_ID.test(bundleId)) return { ok: false };
      const run = safeRun(runner, OPEN, ["-b", bundleId], { timeout: 20_000 });
      return { ok: run.status === 0 };
    },
    reapResidue(snapshot) {
      return reapSnapshot(snapshot, {
        platform: "darwin",
        uid,
        readIdentity,
        signalProcess,
        sleep,
        graceMs,
        postSignalMs,
        lock: { acquire: () => () => {} },
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
