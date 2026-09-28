/**
 * Desktop idle gate: read-only signals that the desktop app's Codex work is
 * running. Every signal that cannot be read or tied to the selected server is
 * unknown, and unknown counts as busy.
 */

import fs from "node:fs";
import path from "node:path";

import {
  DESKTOP_LATEST_THREADS,
  DESKTOP_OPEN_TURN_WINDOW_MS,
  DESKTOP_ROLLOUT_TAIL_BYTES,
  DESKTOP_THREAD_QUERY_LIMIT,
  LSAPPINFO,
  LSOF,
  SQLITE3,
} from "./constants.mjs";
import { childrenByParent, descendantsOf } from "./inventory.mjs";
import { defaultRunner, safeRun } from "./process-evidence.mjs";

// Every thread counts as desktop activity except those a known non-desktop
// client started. An unknown or new originator counts, so a renamed desktop
// originator (the local DB already holds `codex_work_desktop`) cannot make a
// busy app look idle. Threads from builds that recorded no originator are
// classified by their source instead.
// With no originator, `vscode` still counts: the desktop app used that source
// for its own top-level threads.
const NON_DESKTOP_ORIGINATORS = new Set(["codex_exec", "codex_cli_rs", "codex_cli", "codex_vscode"]);
const NON_DESKTOP_SOURCES = new Set(["exec", "cli", "mcp"]);
export function countsAsDesktopThread(row) {
  const originator = typeof row?.originator === "string" ? row.originator.trim() : "";
  if (originator) return !NON_DESKTOP_ORIGINATORS.has(originator);
  const source = typeof row?.source === "string" ? row.source.trim() : "";
  // Subagent threads record a JSON source.
  return !(NON_DESKTOP_SOURCES.has(source) || source.startsWith("{"));
}

const TURN_STARTS = new Set(["task_started", "turn_started"]);
const TURN_ENDS = new Set(["task_complete", "turn_complete", "turn_completed", "turn_aborted", "task_aborted"]);
const TOOL_CALLS = new Set(["function_call", "custom_tool_call", "local_shell_call"]);
const TOOL_OUTPUTS = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output"]);

// The Codex home the selected server uses: the one directory holding the
// Codex databases (state/logs/queue) it has open. The live desktop server
// often holds only logs and queue open, so the state database is read from
// that same directory (stateDatabaseIn). No open Codex database, or more than
// one home, is not tied to the server.
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
  return { home, openState: states.size ? [...states][0] : null };
}

// A rollout's last turn: "open" when a turn started without a completion or a
// tool call has no output yet (with when that turn began, if recorded),
// "closed" otherwise, and "unknown" when the tail cannot be read as events.
export function readTurn(text, { partial = false } = {}) {
  if (typeof text !== "string") return { state: "unknown", openedAtMs: null };
  const lines = text.split("\n");
  if (partial) lines.shift(); // the first line of a tail read may be cut
  const unterminated = !text.endsWith("\n") && lines.at(-1)?.trim();
  let boundary = null;
  let openedAtMs = null;
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
      if (unterminated && index === lines.length - 1) return { state: "open", openedAtMs };
      return { state: "unknown", openedAtMs: null };
    }
    events += 1;
    const payload = event?.payload;
    if (event?.type === "event_msg" && TURN_STARTS.has(payload?.type)) {
      boundary = "open";
      const at = Date.parse(event.timestamp ?? "");
      openedAtMs = Number.isFinite(at) ? at : null;
      pending.clear();
    } else if (event?.type === "event_msg" && TURN_ENDS.has(payload?.type)) {
      boundary = "closed";
      openedAtMs = null;
      pending.clear();
    } else if (event?.type === "response_item" && typeof payload?.call_id === "string") {
      if (TOOL_CALLS.has(payload.type)) pending.add(payload.call_id);
      else if (TOOL_OUTPUTS.has(payload.type)) pending.delete(payload.call_id);
    }
  }
  if (pending.size || boundary === "open") return { state: "open", openedAtMs };
  if (boundary === "closed") return { state: "closed", openedAtMs: null };
  // No turn boundary: a whole file never ran a turn; a cut tail cannot tell.
  return { state: partial && events ? "unknown" : "closed", openedAtMs: null };
}

function readRolloutTail(fsApi, rollout) {
  const length = Math.min(rollout.size, DESKTOP_ROLLOUT_TAIL_BYTES);
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

// The newest `state_N.sqlite` in the Codex home: the one the server has open
// if any, else the highest N on disk. None is unknown.
export function stateDatabaseIn(located, fsApi = fs) {
  if (located.openState) return located.openState;
  let names;
  try {
    names = fsApi.readdirSync(located.home);
  } catch {
    return null;
  }
  const newest = names
    .map((name) => ({ name, version: Number(/^state_(\d+)\.sqlite$/.exec(name)?.[1]) }))
    .filter((entry) => Number.isInteger(entry.version))
    .sort((left, right) => right.version - left.version)[0];
  const database = newest ? path.join(located.home, newest.name) : null;
  // The path goes into a SQLite URI; anything URI-special is not used.
  return database && !/[?#%]/.test(database) ? database : null;
}

// Read-only signals that the desktop app's own Codex work is running: its
// newest thread update or rollout write, any turn or tool call still open in a
// thread active in the last day, and which app is frontmost. The Codex home
// is the directory of the Codex databases the selected server holds open.
// Anything that cannot be read or tied to the server leaves `complete` false
// with an `unknown` code, which counts as busy.
export function readDesktopActivity({ runner = defaultRunner, serverPid, fsApi = fs, nowMs = Date.now() } = {}) {
  const activity = {
    complete: false,
    unknown: null,
    codexHome: null,
    latestActivityMs: null,
    openTurns: [],
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
  const database = stateDatabaseIn(located, fsApi);
  if (!database) return unknown("codex-state-unknown");
  const query = safeRun(runner, SQLITE3, [
    "-readonly",
    "-json",
    `file:${database}?mode=ro`,
    "SELECT id, title, rollout_path, updated_at_ms, originator, source FROM threads WHERE archived = 0"
      + ` ORDER BY updated_at_ms DESC LIMIT ${DESKTOP_THREAD_QUERY_LIMIT}`,
  ], { timeout: 5_000 });
  if (query.status !== 0 || typeof query.stdout !== "string") return unknown("desktop-threads-unreadable");
  let rows;
  try {
    rows = query.stdout.trim() ? JSON.parse(query.stdout) : [];
  } catch {
    return unknown("desktop-threads-unreadable");
  }
  if (!Array.isArray(rows)) return unknown("desktop-threads-unreadable");
  const windowStart = nowMs - DESKTOP_OPEN_TURN_WINDOW_MS;
  // A full page still inside the window may hide older active threads.
  if (rows.length >= DESKTOP_THREAD_QUERY_LIMIT && rows.at(-1)?.updated_at_ms >= windowStart) {
    return unknown("desktop-threads-too-many");
  }
  const counted = rows.filter(countsAsDesktopThread);
  if (!counted.length) return unknown("desktop-threads-none");
  let latest = 0;
  const rollouts = [];
  for (const [index, row] of counted.entries()) {
    const updated = row?.updated_at_ms;
    if (!Number.isFinite(updated) || updated <= 0 || updated > nowMs + 86_400_000) {
      return unknown("desktop-thread-timestamp-invalid");
    }
    const recent = updated >= windowStart;
    if (index >= DESKTOP_LATEST_THREADS && !recent) break;
    latest = Math.max(latest, updated);
    let info = null;
    try {
      if (typeof row.rollout_path === "string" && path.isAbsolute(row.rollout_path)) info = fsApi.statSync(row.rollout_path);
    } catch {}
    if (!Number.isFinite(info?.mtimeMs) || !Number.isInteger(info?.size) || info.size < 0) {
      // A thread active in the window must be readable; an older one whose
      // rollout is gone cannot be running, so it is ignored.
      if (recent) return unknown("desktop-rollout-unreadable");
      continue;
    }
    latest = Math.max(latest, info.mtimeMs);
    if (recent || info.mtimeMs >= windowStart) {
      rollouts.push({ path: row.rollout_path, size: info.size, id: row.id ?? null, title: row.title ?? null });
    }
  }
  activity.latestActivityMs = latest;
  for (const rollout of rollouts) {
    let turn;
    try {
      const tail = readRolloutTail(fsApi, rollout);
      turn = readTurn(tail.text, { partial: tail.partial });
    } catch {
      turn = { state: "unknown" };
    }
    if (turn.state === "unknown") return unknown("desktop-rollout-unreadable");
    if (turn.state === "open") {
      activity.openTurns.push({
        threadId: typeof rollout.id === "string" ? rollout.id : null,
        title: typeof rollout.title === "string" ? rollout.title.slice(0, 80) : null,
        since: Number.isFinite(turn.openedAtMs) ? new Date(turn.openedAtMs).toISOString() : null,
        rollout: rollout.path,
      });
    }
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
  if (!activity?.complete || !Number.isFinite(activity.latestActivityMs)) return ["desktop-activity-unknown"];
  // Without a whole process list, a new child of the server cannot be seen.
  if (!Array.isArray(inventory?.processes) || inventory.collectionErrors?.length) {
    return ["desktop-process-list-unknown"];
  }
  const reasons = [];
  if (nowMs - activity.latestActivityMs < idleMs) reasons.push("codex-activity-recent");
  // An open turn counts even when abandoned (say, after a crash): the refusal
  // names its thread so the user can finish, cancel or archive it.
  if (activity.openTurns?.length) reasons.push("desktop-turn-in-progress");
  if (activity.frontmostBundleId && activity.frontmostBundleId === bundleId) {
    reasons.push("desktop-app-frontmost");
  }
  const started = (item) => Date.parse(item.startTime ?? "");
  if (descendantsOf(serverPid, childrenByParent(inventory.processes)).descendants
    .some((item) => !Number.isFinite(started(item)) || nowMs - started(item) < idleMs)) {
    reasons.push("recent-app-server-child");
  }
  return reasons;
}
