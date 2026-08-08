/** SessionEnd hook receipt file: secure read, atomic write, and pruning. */

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";

import {
  HOOK_RECEIPT_SCHEMA,
  MAX_HOOK_RECEIPT_BYTES,
} from "./constants.mjs";
import {
  callerUid,
  exactKeys,
  sha256,
  stableJson,
  validIsoTime,
  validObservedIdentity,
} from "./process-evidence.mjs";
import {
  exactSnapshotIdentityPresent,
} from "./snapshot.mjs";

export function hookStateDirectory(env) {
  if (env.XDG_STATE_HOME) {
    if (!path.isAbsolute(env.XDG_STATE_HOME)) throw new Error("hook-state-path-invalid");
    return path.join(env.XDG_STATE_HOME, "railyard", "cleanup-codex");
  }
  const home = env.HOME || os.homedir();
  if (!path.isAbsolute(home)) throw new Error("hook-state-path-invalid");
  return path.join(home, "Library", "Application Support", "railyard", "cleanup-codex");
}

export function hookReceiptFilename(appServer) {
  const identityDigest = sha256(stableJson(appServer)).slice(0, 24);
  return `${appServer.pid}-${identityDigest}.json`;
}

export function readHookReceiptSecure(file, { fsApi, uid }) {
  let before;
  let descriptor = null;
  try {
    before = fsApi.lstatSync(file);
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || before.uid !== uid
      || before.nlink !== 1
      || (before.mode & 0o777) !== 0o600
      || before.size <= 0
      || before.size > MAX_HOOK_RECEIPT_BYTES
    ) return null;
    descriptor = fsApi.openSync(file, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return null;
    const receipt = JSON.parse(fsApi.readFileSync(descriptor, "utf8"));
    const after = fsApi.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return null;
    const supportedShape = receipt.schema === HOOK_RECEIPT_SCHEMA
      ? exactKeys(receipt, ["appServer", "cleanup", "missingEvidence", "observedAt", "schema", "status", "verification", "warnings"])
      : receipt.schema === "cleanup-codex-hook-health-v1"
        && exactKeys(receipt, ["appServer", "health", "missingEvidence", "observedAt", "schema", "status", "verification", "warnings"]);
    if (
      !supportedShape
      || !validIsoTime(receipt.observedAt)
      || !exactKeys(receipt.appServer, [
        "commandIdentity",
        "executable",
        "parentPid",
        "pid",
        "processGroupId",
        "startTime",
        "uid",
      ])
      || receipt.appServer.commandIdentity !== "codex app-server"
      || !validObservedIdentity(receipt.appServer)
      || path.basename(file) !== hookReceiptFilename(receipt.appServer)
    ) return null;
    return { receipt, stat: opened };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function pruneHookReceipts({ fsApi = fs, env = process.env, uid = callerUid(), readIdentity }) {
  if (typeof readIdentity !== "function") return { complete: false, pruned: 0 };
  let directory;
  let entries;
  try {
    directory = hookStateDirectory(env);
    const state = fsApi.lstatSync(directory);
    if (state.isSymbolicLink() || !state.isDirectory() || state.uid !== uid || (state.mode & 0o777) !== 0o700) {
      return { complete: false, pruned: 0 };
    }
    entries = fsApi.readdirSync(directory).filter((entry) => /^\d+-[0-9a-f]{24}\.json$/.test(entry));
  } catch (error) {
    return { complete: error?.code === "ENOENT", pruned: 0 };
  }

  let pruned = 0;
  for (const entry of entries) {
    const file = path.join(directory, entry);
    const loaded = readHookReceiptSecure(file, { fsApi, uid });
    if (!loaded) continue;
    let observation;
    try {
      observation = readIdentity(loaded.receipt.appServer.pid);
    } catch {
      continue;
    }
    const provenGone = observation?.state === "absent"
      || (
        observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !exactSnapshotIdentityPresent(loaded.receipt.appServer, observation)
      );
    if (!provenGone) continue;
    try {
      const current = fsApi.lstatSync(file);
      if (
        current.isSymbolicLink()
        || !current.isFile()
        || current.uid !== uid
        || current.dev !== loaded.stat.dev
        || current.ino !== loaded.stat.ino
      ) continue;
      fsApi.unlinkSync(file);
      pruned += 1;
    } catch {}
  }
  return { complete: true, pruned };
}

export function writeLatestHookReceipt(receipt, { fsApi, env, uid }) {
  const directory = hookStateDirectory(env);
  fsApi.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const state = fsApi.lstatSync(directory);
  if (state.isSymbolicLink() || !state.isDirectory() || state.uid !== uid) {
    throw new Error("hook-state-directory-unsafe");
  }
  fsApi.chmodSync(directory, 0o700);
  const destination = path.join(directory, hookReceiptFilename(receipt.appServer));
  try {
    const existing = fsApi.lstatSync(destination);
    if (
      existing.isSymbolicLink()
      || !existing.isFile()
      || existing.uid !== uid
      || existing.nlink !== 1
      || (existing.mode & 0o777) !== 0o600
    ) throw new Error("hook-receipt-unsafe");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = path.join(directory, `.${path.basename(destination)}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor = null;
  try {
    descriptor = fsApi.openSync(
      temporary,
      fsApi.constants.O_WRONLY
        | fsApi.constants.O_CREAT
        | fsApi.constants.O_EXCL
        | fsApi.constants.O_NOFOLLOW,
      0o600,
    );
    fsApi.fchmodSync(descriptor, 0o600);
    fsApi.writeFileSync(descriptor, `${JSON.stringify(receipt)}\n`, "utf8");
    fsApi.fsyncSync(descriptor);
    fsApi.closeSync(descriptor);
    descriptor = null;
    fsApi.renameSync(temporary, destination);
    return destination;
  } catch (error) {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
    try { fsApi.unlinkSync(temporary); } catch {}
    throw error;
  }
}
