/**
 * Desktop recycle: quit and relaunch the ChatGPT/Codex app that hosts a GUI
 * app-server, then reap exact leftovers of the old server's tree.
 *
 * The host app is asked to quit gracefully and is never signalled. Only exact
 * recorded descendants of the selected app-server are reaped, through the
 * same machinery as `reap`.
 */

import fs from "node:fs";
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
  LSOF,
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
const MAIN_APP_BUNDLE = /^\/.+\/(?:Codex|ChatGPT)\.app$/i;

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
    || identityDifferences(host.record, hostObservation.identity, HOST_IDENTITY_FIELDS).length
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

// Threads the desktop app starts carry its originator; CLI, `codex exec` and
// editor threads do not, and their work is not interrupted by a desktop quit.
export const DESKTOP_ORIGINATORS = ["Codex Desktop", "codex-chrome-extension-sidepanel"];
const DESKTOP_THREAD_LIMIT = 20;
const ROLLOUT_TAIL_BYTES = 256 * 1024;
// A turn can sit silent for many minutes inside one tool call, so every
// rollout touched this recently is checked for an open turn, not only the newest.
const OPEN_TURN_WINDOW_MS = 30 * 60 * 1000;
const TURN_STARTS = new Set(["task_started", "turn_started"]);
const TURN_ENDS = new Set(["task_complete", "turn_complete", "turn_completed", "turn_aborted", "task_aborted"]);
const TOOL_CALLS = new Set(["function_call", "custom_tool_call", "local_shell_call"]);
const TOOL_OUTPUTS = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output"]);

// The Codex home the selected server is using, from its own open files: its
// state/logs/queue databases live directly in that home. More than one home,
// or none, is not tied to the server.
export function codexHomeFromOpenFiles(lsofOutput) {
  const homes = new Set();
  const states = new Set();
  for (const line of String(lsofOutput ?? "").split("\n")) {
    if (!line.startsWith("n/")) continue;
    const name = line.slice(1);
    const match = /^(\/.+)\/(state|logs|queue)_\d+\.sqlite(?:-wal|-shm)?$/.exec(name);
    if (!match) continue;
    homes.add(match[1]);
    if (match[2] === "state") states.add(name.replace(/-(?:wal|shm)$/, ""));
  }
  if (homes.size !== 1 || states.size > 1) return null;
  const [home] = homes;
  const database = states.size ? [...states][0] : path.join(home, "state_5.sqlite");
  // The path goes into a SQLite URI; anything URI-special is not used.
  return /[?#%]/.test(database) ? null : { home, database };
}

// Whether a rollout's last turn is still running: "open" when a turn started
// without a completion or a tool call has no output yet, "closed" otherwise,
// and "unknown" when the tail cannot be read as whole events.
export function rolloutTurnState(text, { partial = false } = {}) {
  if (typeof text !== "string") return "unknown";
  const lines = text.split("\n");
  if (partial) lines.shift(); // the first line of a tail read may be cut
  const unterminated = !text.endsWith("\n") && lines.at(-1)?.trim();
  let boundary = null;
  let events = 0;
  const pending = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // A last line still being written means the rollout is being written.
      if (unterminated && index === lines.length - 1) return "open";
      return "unknown";
    }
    events += 1;
    const payload = event?.payload;
    if (event?.type === "event_msg" && TURN_STARTS.has(payload?.type)) {
      boundary = "open";
      pending.clear();
    } else if (event?.type === "event_msg" && TURN_ENDS.has(payload?.type)) {
      boundary = "closed";
      pending.clear();
    } else if (event?.type === "response_item" && typeof payload?.call_id === "string") {
      if (TOOL_CALLS.has(payload.type)) pending.add(payload.call_id);
      else if (TOOL_OUTPUTS.has(payload.type)) pending.delete(payload.call_id);
    }
  }
  if (pending.size || boundary === "open") return "open";
  if (boundary === "closed") return "closed";
  // No turn boundary: a whole file never ran a turn; a cut tail cannot tell.
  return partial && events ? "unknown" : "closed";
}

function readRolloutTail(fsApi, rollout) {
  const length = Math.min(rollout.size, ROLLOUT_TAIL_BYTES);
  const start = rollout.size - length;
  const fd = fsApi.openSync(rollout.path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fsApi.readSync(fd, buffer, 0, length, start);
    return { text: buffer.subarray(0, read).toString("utf8"), partial: start > 0 };
  } finally {
    fsApi.closeSync(fd);
  }
}

// Read-only signals that the desktop app's own Codex work is running: its
// newest thread update or rollout write, an open turn in a recent rollout, and
// which app is frontmost. The Codex home and state database come from the
// selected server's open files. Anything that cannot be read or tied to the
// server leaves `complete` false with an `unknown` code, which counts as busy.
export function readDesktopActivity({ runner = defaultRunner, serverPid, fsApi = fs, nowMs = Date.now() } = {}) {
  const activity = {
    complete: false,
    unknown: null,
    codexHome: null,
    latestActivityMs: null,
    turnInProgress: false,
    frontmostBundleId: null,
  };
  const unknown = (code) => {
    activity.unknown = code;
    return activity;
  };
  if (!Number.isInteger(serverPid) || serverPid <= 0) return unknown("desktop-server-unidentified");
  const openFiles = safeRun(runner, LSOF, ["-nP", "-a", "-p", String(serverPid), "-Fn"], { timeout: 10_000 });
  const located = openFiles.status === 0 ? codexHomeFromOpenFiles(openFiles.stdout) : null;
  if (!located) return unknown("codex-home-unknown");
  activity.codexHome = located.home;
  const originators = DESKTOP_ORIGINATORS.map((name) => `'${name}'`).join(", ");
  const query = safeRun(runner, SQLITE3, [
    "-readonly",
    "-json",
    `file:${located.database}?mode=ro`,
    "SELECT rollout_path, updated_at_ms FROM threads WHERE archived = 0"
      + ` AND originator IN (${originators}) ORDER BY updated_at_ms DESC LIMIT ${DESKTOP_THREAD_LIMIT}`,
  ], { timeout: 5_000 });
  if (query.status !== 0 || typeof query.stdout !== "string") return unknown("desktop-threads-unreadable");
  let rows;
  try {
    rows = query.stdout.trim() ? JSON.parse(query.stdout) : [];
  } catch {
    return unknown("desktop-threads-unreadable");
  }
  if (!Array.isArray(rows)) return unknown("desktop-threads-unreadable");
  if (!rows.length) return unknown("desktop-threads-none");
  let latest = 0;
  const rollouts = [];
  for (const row of rows) {
    const updated = row?.updated_at_ms;
    if (!Number.isFinite(updated) || updated <= 0 || updated > nowMs + 86_400_000) {
      return unknown("desktop-thread-timestamp-invalid");
    }
    latest = Math.max(latest, updated);
    if (typeof row.rollout_path !== "string" || !path.isAbsolute(row.rollout_path)) {
      return unknown("desktop-rollout-unreadable");
    }
    let info;
    try {
      info = fsApi.statSync(row.rollout_path);
    } catch {
      return unknown("desktop-rollout-unreadable");
    }
    if (!Number.isFinite(info?.mtimeMs) || !Number.isInteger(info?.size) || info.size < 0) {
      return unknown("desktop-rollout-unreadable");
    }
    latest = Math.max(latest, info.mtimeMs);
    rollouts.push({ path: row.rollout_path, size: info.size, mtimeMs: info.mtimeMs });
  }
  activity.latestActivityMs = latest;
  rollouts.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const [index, rollout] of rollouts.entries()) {
    if (index > 0 && nowMs - rollout.mtimeMs >= OPEN_TURN_WINDOW_MS) continue;
    let state;
    try {
      const tail = readRolloutTail(fsApi, rollout);
      state = rolloutTurnState(tail.text, { partial: tail.partial });
    } catch {
      state = "unknown";
    }
    if (state === "unknown") return unknown("desktop-rollout-unreadable");
    if (state === "open") activity.turnInProgress = true;
  }
  const front = safeRun(runner, LSAPPINFO, ["front"], { timeout: 5_000 });
  const asn = typeof front.stdout === "string" ? front.stdout.trim() : "";
  if (front.status !== 0 || !/^ASN:[0-9a-fx-]+:?$/i.test(asn)) return unknown("frontmost-app-unknown");
  const info = safeRun(runner, LSAPPINFO, ["info", "-only", "bundleid", asn], { timeout: 5_000 });
  const match = typeof info.stdout === "string"
    ? info.stdout.match(/bundle(?:ID|identifier)"?\s*=\s*"([^"]+)"/i)
    : null;
  // An unparsed frontmost app is unknown, which counts as busy.
  if (info.status !== 0 || !match) return unknown("frontmost-app-unknown");
  activity.frontmostBundleId = match[1];
  activity.complete = true;
  return activity;
}

// Reasons the desktop app looks busy; empty means idle enough to recycle.
export function desktopBusyReasons({ activity, inventory, serverPid, bundleId, nowMs, idleMs }) {
  const reasons = [];
  if (!activity?.complete || !Number.isFinite(activity.latestActivityMs) || activity.latestActivityMs <= 0) {
    return ["desktop-activity-unknown"];
  }
  if (nowMs - activity.latestActivityMs < idleMs) reasons.push("codex-activity-recent");
  if (activity.turnInProgress) reasons.push("desktop-turn-in-progress");
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
      || [
        "readIdentity", "collectInventory", "readBundleIdentifier", "readDesktopActivity",
        "quitApp", "launchApp", "reapResidue", "sleep", "monotonicNow",
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
      const inventory = typeof inventorySource === "function" ? inventorySource() : inventorySource;
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
    checkIdle(() => deps.collectInventory());
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
    const probe = (expected) => {
      let observation;
      try {
        observation = deps.readIdentity(expected.pid);
      } catch {
        return "unknown";
      }
      if (goneOrReused(expected, observation)) return "gone";
      return sameBirthIdentityPresent(expected, observation) ? "present" : "unknown";
    };
    const hostGone = waitUntil(deps, quitTimeoutMs, () => probe(receipt.host) === "gone");
    // Still running (say, a dialog is open): the app is not closed, so there is
    // nothing to relaunch and nothing is forced.
    if (!hostGone && probe(receipt.host) === "present") {
      refuse(quit?.ok ? "desktop-host-quit-timeout" : "desktop-quit-request-failed");
    }

    // The app is closed (or cannot be shown running). From here the relaunch is
    // always attempted, and every other failure is reported beside it.
    const failures = [];
    if (!hostGone) failures.push("desktop-host-quit-unverified");
    const attempt = (fallback, step) => {
      try {
        return step();
      } catch (error) {
        failures.push(error instanceof CleanupRefusal ? error.code : fallback);
        return null;
      }
    };
    if (!waitUntil(deps, quitTimeoutMs, () => probe(receipt.server) === "gone")) {
      failures.push("desktop-server-survived-host");
    }

    // Relaunch the exact bundle that was quit, before any residue work, and
    // wait for a fresh host and GUI app-server.
    let launched = null;
    try {
      launched = deps.launchApp(receipt.host.bundlePath);
    } catch {}
    result.verification.actions.push({ kind: "relaunch-desktop-app", bundlePath: receipt.host.bundlePath, ok: launched?.ok === true });
    let relaunched = null;
    if (!launched?.ok) failures.push("desktop-relaunch-failed");
    else {
      relaunched = waitUntil(
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
      if (!relaunched) failures.push("desktop-relaunch-timeout");
    }
    result.verification.relaunch = { attempted: true, requested: launched?.ok === true, verified: Boolean(relaunched) };

    // Reap exact leftovers of the old app-server tree. They are bound to exact
    // identities, so the new app's processes are never mistaken for them.
    attempt("residue-reap-incomplete", () => {
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
      result.verification.actions.push({
        kind: "reap-exact-residue",
        pids: residue.targets.map((target) => target.pid),
      });
    });

    attempt("old-tree-verification-unknown", () => assertOldTreeGone(lockedSnapshot, deps.readIdentity));
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
    attempt("old-host-verification-unknown", () => (
      assertExpectedIdentityGone(receipt.host, deps.readIdentity, "old-host-survivor", "old-host-verification-unknown")
    ));
    attempt("gui-verification-unknown", () => assertGuiPreserved(evidence.otherGui, deps.readIdentity));
    if (relaunched && !relaunchStillLive(relaunched, deps.readIdentity)) {
      failures.push("replacement-identity-changed");
      relaunched = null;
      result.verification.relaunch.verified = false;
    }

    if (relaunched) {
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
    // Reopen the exact bundle that was quit, never whichever copy Launch
    // Services picks for its bundle id.
    launchApp(bundlePath) {
      if (typeof bundlePath !== "string" || !MAIN_APP_BUNDLE.test(bundlePath) || path.normalize(bundlePath) !== bundlePath) {
        return { ok: false };
      }
      const run = safeRun(runner, OPEN, [bundlePath], { timeout: 20_000 });
      return { ok: run.status === 0 };
    },
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
