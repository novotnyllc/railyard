/** Private state store: read, lock, atomic write, headroom and pruning. */

import fs from "node:fs";
import path from "node:path";

import {
  boundedIssue,
  error,
  isObject,
  opaqueId,
  ownEntries,
  result,
} from "./bounds.mjs";
import {
  safeStat,
} from "./paths.mjs";
import {
  ELIGIBLE_RETENTION_MS,
  MAX_JSON_BYTES,
  MAX_STATE_BYTES,
  NEGATIVE_CAPABILITY_STATES,
  SETTLEMENT_HEADROOM_BYTES,
  STATE_LOCK_TTL_MS,
} from "./registries.mjs";

export function privateFileIssue(file, { missingOk = true, maxBytes = MAX_JSON_BYTES } = {}) {
  const before = safeStat(file);
  if (!before) return missingOk ? null : "file_missing";
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) return "unsafe_file_type";
  if (before.size > maxBytes) return "file_too_large";
  if (typeof process.getuid === "function" && before.uid !== process.getuid()) return "unexpected_file_owner";
  if ((before.mode & 0o077) !== 0) return "unsafe_file_mode";
  return null;
}

export function readPrivateJson(file, { missingOk = true, maxBytes = MAX_JSON_BYTES } = {}) {
  const issue = privateFileIssue(file, { missingOk, maxBytes });
  if (issue) return error(issue, { source: "state" });
  if (!safeStat(file)) return result(true, "file_absent", { value: null });
  let fd;
  try {
    const before = fs.lstatSync(file);
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const after = fs.fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || !after.isFile() || after.nlink !== 1 || after.size > maxBytes) {
      return error("file_changed_during_read", { source: "state" });
    }
    const bytes = fs.readFileSync(fd, "utf8");
    if (Buffer.byteLength(bytes) > maxBytes) return error("file_too_large", { source: "state" });
    try {
      const value = JSON.parse(bytes);
      const bounded = boundedIssue(value);
      return bounded ? error(bounded, { source: "state" }) : result(true, "file_loaded", { value });
    } catch {
      return error("invalid_json", { source: "state" });
    }
  } catch (cause) {
    return error(cause?.code === "ELOOP" ? "unsafe_file_type" : "file_read_failed", { source: "state" });
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function ensurePrivateDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return "unsafe_state_directory";
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "unexpected_state_directory_owner";
  if ((stat.mode & 0o077) !== 0) return "unsafe_state_directory_mode";
  return null;
}

/**
 * A crashed holder used to leave the O_EXCL lock behind forever, wedging every
 * mutating command on `state_lock_held` with no recovery path. The lock file
 * records its pid: if that process is gone, or the lock predates the TTL, it is
 * dead and safe to break exactly once.
 */
export function breakStaleLock(lock, now) {
  let stat;
  try { stat = fs.lstatSync(lock); } catch { return false; }
  if (!stat.isFile()) return false;
  let alive = false;
  try {
    const pid = JSON.parse(fs.readFileSync(lock, "utf8")).pid;
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
      // ESRCH: gone. EPERM: alive under another uid, so not ours to break.
      try { process.kill(pid, 0); alive = true; } catch (cause) { alive = cause?.code === "EPERM"; }
    }
  } catch { /* unreadable or truncated lock: age decides */ }
  if (alive || now - stat.mtimeMs < STATE_LOCK_TTL_MS) return false;
  try {
    // Unlink by identity so a lock replaced between stat and unlink survives.
    const current = fs.lstatSync(lock);
    if (current.dev !== stat.dev || current.ino !== stat.ino) return false;
    fs.unlinkSync(lock);
    return true;
  } catch { return false; }
}

export function withStateLock(file, action, { now = Date.now() } = {}) {
  const directory = path.dirname(file);
  const directoryIssue = ensurePrivateDirectory(directory);
  if (directoryIssue) return error(directoryIssue);
  const lock = `${file}.lock`;
  let lockFd;
  let lockIdentity;
  try {
    const open = () => fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      lockFd = open();
    } catch (cause) {
      if (cause?.code !== "EEXIST" || !breakStaleLock(lock, now)) throw cause;
      lockFd = open(); // one retry; a live racer still yields state_lock_held
    }
    lockIdentity = fs.fstatSync(lockFd);
    fs.writeFileSync(lockFd, JSON.stringify({ owner: opaqueId("lock", `${process.pid}:${Date.now()}:${crypto.randomUUID()}`), pid: process.pid }) + "\n", "utf8");
    fs.fsyncSync(lockFd);
    return action();
  } catch (cause) {
    return error(cause?.code === "EEXIST" ? "state_lock_held" : "state_lock_failed");
  } finally {
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch { /* no-op */ }
      try {
        const current = fs.lstatSync(lock);
        if (lockIdentity && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) fs.unlinkSync(lock);
      } catch { /* retain an ambiguous or replaced lock */ }
    }
  }
}

export function writePrivateJsonLocked(file, value) {
  const serialized = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) return error("state_capacity_exceeded");
  const directory = path.dirname(file);
  const destinationIssue = privateFileIssue(file, { missingOk: true, maxBytes: MAX_STATE_BYTES });
  if (destinationIssue) return error(destinationIssue);
  let temp;
  try {
    temp = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
    const tempFd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeFileSync(tempFd, serialized, "utf8");
      fs.fsyncSync(tempFd);
    } finally {
      fs.closeSync(tempFd);
    }
    const finalIssue = privateFileIssue(file, { missingOk: true, maxBytes: MAX_STATE_BYTES });
    if (finalIssue) return error(finalIssue);
    fs.renameSync(temp, file);
    temp = null;
    try {
      const dirFd = fs.openSync(directory, fs.constants.O_RDONLY);
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Some supported filesystems cannot fsync a directory. The renamed file is still durable enough for v1.
    }
    return result(true, "state_written");
  } catch {
    return error("state_write_failed");
  } finally {
    if (temp) {
      try { fs.unlinkSync(temp); } catch { /* our exclusive temp may already be gone */ }
    }
  }
}

export function stateSizeBytes(state) {
  return Buffer.byteLength(JSON.stringify(state));
}

/**
 * Retain active claims, live capability evidence, allocator leases, and recent
 * settlement tombstones.  Only optional learning samples and terminal records
 * older than the published retention window are eligible for compaction.
 */
export function pruneEligibleState(state, now) {
  // Capability records are per hostScope/accountScope/policy/adapter, so a
  // fleet accumulates thousands and never dropped one — the 1 MiB ceiling was
  // reachable and wedged every write permanently. An expired record is already
  // ignored by capabilityFor, so deleting it changes no routing decision. The
  // one exception is a negative "unsupported" record: that is honored past
  // expiry (never retried on a timer), so it is not eligible.
  for (const [id, evidence] of ownEntries(state.capabilities)) {
    if (!isObject(evidence) || Date.parse(evidence.expiresAt) > now) continue;
    if (NEGATIVE_CAPABILITY_STATES.has(evidence.state) && evidence.negativeClass === "unsupported") continue;
    delete state.capabilities[id];
  }
  // Serializing the whole document once per deleted record made compaction of a
  // near-full 1 MiB state quadratic.  A JSON object member costs exactly its own
  // `"key":value` plus the separating comma, so track the total and subtract.
  let size = stateSizeBytes(state);
  const drop = (records, id) => {
    const member = `${JSON.stringify(id)}:${JSON.stringify(records[id])}`;
    size -= Buffer.byteLength(member) + (Object.keys(records).length > 1 ? 1 : 0);
    delete records[id];
  };
  const removeOldest = (records) => {
    const oldest = Object.keys(records)
      .sort((left, right) => String(records[left].at || records[left].updatedAt || "").localeCompare(String(records[right].at || records[right].updatedAt || "")))[0];
    if (oldest) drop(records, oldest);
    return Boolean(oldest);
  };
  while (size > MAX_STATE_BYTES - SETTLEMENT_HEADROOM_BYTES) {
    if (removeOldest(state.learningOutcomes)) continue;
    if (removeOldest(state.learningAggregates)) continue;
    const cutoff = now - ELIGIBLE_RETENTION_MS;
    const terminal = Object.entries(state.reservations)
      .filter(([, reservation]) => ["settled", "no_start"].includes(reservation.phase) && Date.parse(reservation.updatedAt) <= cutoff)
      .sort(([, left], [, right]) => left.updatedAt.localeCompare(right.updatedAt));
    if (terminal.length === 0) break;
    const [reservationId] = terminal[0];
    drop(state.reservations, reservationId);
    for (const [receiptId, tombstone] of ownEntries(state.settlementTombstones)) {
      if (tombstone.reservationId === reservationId && Date.parse(tombstone.at) <= cutoff) drop(state.settlementTombstones, receiptId);
    }
  }
}

export function ensureStateHeadroom(state, now) {
  pruneEligibleState(state, now);
  return stateSizeBytes(state) <= MAX_STATE_BYTES - SETTLEMENT_HEADROOM_BYTES
    ? { ok: true }
    : error("state_headroom_exhausted", { protectedRecordsRetained: true });
}
