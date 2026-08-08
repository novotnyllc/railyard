/** Process-evidence primitives: bounded command runs, ps/lsof parsing, and the small shared utilities every layer needs. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  APP_SERVER_BOOLEAN_FLAGS,
  APP_SERVER_VALUE_FLAGS,
  CODEX_GLOBAL_BOOLEAN_FLAGS,
  CODEX_GLOBAL_VALUE_FLAGS,
  CODEX_GLOBAL_VARIADIC_FLAGS,
  SOCKET_NAME,
} from "./constants.mjs";

export function defaultRunner(file, args, { timeout = 5_000 } = {}) {
  const run = spawnSync(file, args, {
    encoding: "utf8",
    killSignal: "SIGKILL",
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    timeout,
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    error: run.error ?? null,
    signal: run.signal ?? null,
  };
}

export function validThreshold(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function parsePsLine(line, commandField) {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 10) return null;
  const pid = Number(fields[0]);
  const parentPid = Number(fields[1]);
  const processGroupId = Number(fields[2]);
  const uid = Number(fields[3]);
  const start = new Date(fields.slice(4, 9).join(" "));
  const tail = fields.slice(9).join(" ");
  if (
    !Number.isInteger(pid)
    || !Number.isInteger(parentPid)
    || !Number.isInteger(processGroupId)
    || !Number.isInteger(uid)
    || !tail
  ) return null;
  return {
    pid,
    parentPid,
    processGroupId,
    uid,
    startTime: Number.isNaN(start.valueOf()) ? null : start.toISOString(),
    [commandField]: tail,
  };
}

export function parsePsOutput(stdout, commandField) {
  const parsed = [];
  let invalidRows = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const process = parsePsLine(line, commandField);
    if (process) parsed.push(process);
    else invalidRows += 1;
  }
  return { parsed, invalidRows };
}

export function optionEnd(tokens, index, valueFlags, booleanFlags, variadicFlags = null) {
  const token = tokens[index].toLowerCase();
  if (["-h", "--help", "-v", "--version"].includes(token)) return -1;
  const separator = token.indexOf("=");
  const flag = separator < 0 ? token : token.slice(0, separator);
  if (booleanFlags.has(flag)) return index + 1;
  const variadic = variadicFlags?.has(flag);
  if (!valueFlags.has(flag) && !variadic) return null;
  if (!variadic) {
    if (separator >= 0) return index + 1;
    return index + 1 < tokens.length ? index + 2 : -1;
  }
  if (separator >= 0 && !token.slice(separator + 1)) return -1;
  if (separator >= 0) return index + 1;
  const firstValue = tokens[index + 1];
  if (!firstValue || firstValue.startsWith("-")) return -1;
  let next = index + 2;
  while (next < tokens.length && !tokens[next].startsWith("-")) next += 1;
  return next;
}

export function appServerCommandKind(command = "") {
  const tokens = command.trim().split(/\s+/);
  const executable = path.basename(tokens.shift() ?? "").toLowerCase();
  if (executable !== "codex" && executable !== "codex-app-server") return null;
  let index = 0;
  if (executable === "codex") {
    while (tokens[index]?.startsWith("-")) {
      const next = optionEnd(
        tokens,
        index,
        CODEX_GLOBAL_VALUE_FLAGS,
        CODEX_GLOBAL_BOOLEAN_FLAGS,
        CODEX_GLOBAL_VARIADIC_FLAGS,
      );
      if (next === null || next < 0) return null;
      index = next;
    }
    if (tokens[index]?.toLowerCase() !== "app-server") return null;
    index += 1;
  }

  for (; index < tokens.length;) {
    const token = tokens[index].toLowerCase();
    if (!token.startsWith("-")) return token === "proxy" ? "proxy" : null;
    const next = optionEnd(tokens, index, APP_SERVER_VALUE_FLAGS, APP_SERVER_BOOLEAN_FLAGS);
    if (next === null) return "server";
    if (next < 0) return null;
    index = next;
  }
  return "server";
}

export function isAppServerCommand(command = "") {
  return appServerCommandKind(command) === "server";
}

export function commandExecutable(command = "") {
  const first = command.trim().split(/\s+/, 1)[0] ?? "";
  return first.startsWith("/") ? first : "";
}

export function commandName(command = "") {
  return path.basename(command.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
}

export function commandEvidenceAgrees(command, observation) {
  const rawExecutable = command.trim().split(/\s+/, 1)[0] ?? "";
  const observedExecutable = observation.identity?.executable ?? "";
  return Boolean(observation.commandName)
    && path.basename(observedExecutable).toLowerCase() === observation.commandName
    && (rawExecutable.startsWith("/")
      ? rawExecutable === observedExecutable
      : path.basename(rawExecutable).toLowerCase() === observation.commandName);
}

export function parseDescriptors(stdout) {
  const descriptors = new Set();
  let highest = null;
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^f(\d+)/.exec(line);
    if (!match) continue;
    const descriptor = Number(match[1]);
    descriptors.add(descriptor);
    if (highest === null || descriptor > highest) highest = descriptor;
  }
  return {
    complete: true,
    count: descriptors.size,
    highest,
  };
}

export function parseProcessFiles(stdout, psCommand = "") {
  const textPaths = [];
  const controlSockets = [];
  let descriptor = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("f")) {
      descriptor = line.slice(1).replace(/[rwu]$/, "");
      continue;
    }
    if (!line.startsWith("n")) continue;
    const name = line.slice(1);
    if (descriptor === "txt" && name.startsWith("/")) textPaths.push(name);
    const controlSocket = socketPath(name);
    if (controlSocket) controlSockets.push(controlSocket);
  }
  const commandName = path.basename(psCommand.trim());
  const matching = textPaths.filter((candidate) => path.basename(candidate) === commandName);
  return {
    descriptors: parseDescriptors(stdout),
    executable: matching.length === 1
      ? matching[0]
      : textPaths.length === 1
        ? textPaths[0]
        : null,
    controlSockets: unique(controlSockets),
  };
}

export function socketPath(name) {
  const candidate = name.trim();
  const arrow = candidate.lastIndexOf("->");
  const candidatePath = (arrow >= 0 ? candidate.slice(arrow + 2) : candidate).trim();
  return candidatePath.startsWith("/") && path.basename(candidatePath) === SOCKET_NAME
    ? candidatePath
    : null;
}

export function socketEndpoint(value) {
  return /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : null;
}

export function parseControlSockets(stdout) {
  const items = new Map();
  let ownerPid = null;
  let endpoint = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) {
      ownerPid = Number(line.slice(1));
      endpoint = null;
      continue;
    }
    if (line.startsWith("f")) {
      endpoint = null;
      continue;
    }
    if (line.startsWith("d")) {
      endpoint = socketEndpoint(line.slice(1));
      continue;
    }
    if (!line.startsWith("n") || !Number.isInteger(ownerPid)) continue;
    const path = socketPath(line.slice(1));
    if (!path) continue;
    const key = `${ownerPid}:${path}`;
    const item = items.get(key) ?? { path, ownerPid, endpoints: new Set() };
    if (endpoint) item.endpoints.add(endpoint);
    items.set(key, item);
  }
  return [...items.values()].map((item) => ({
    path: item.path,
    ownerPid: item.ownerPid,
    endpoints: [...item.endpoints].sort(),
  }));
}

export function parseProxySocketEvidence(stdout, pids) {
  const evidence = Object.fromEntries(unique(pids).map((pid) => [pid, {
    complete: true,
    paths: [],
    connections: [],
  }]));
  let current = null;
  let endpoint = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^p\d+$/.test(line)) {
      current = evidence[Number(line.slice(1))] ?? null;
      endpoint = null;
      continue;
    }
    if (line.startsWith("f")) {
      endpoint = null;
      continue;
    }
    if (line.startsWith("d")) {
      endpoint = socketEndpoint(line.slice(1));
      continue;
    }
    if (!current || !line.startsWith("n")) continue;
    const name = line.slice(1);
    const path = socketPath(name);
    if (path) current.paths.push(path);
    const peerEndpoint = name.startsWith("->") ? socketEndpoint(name.slice(2)) : null;
    if (endpoint && peerEndpoint) current.connections.push({ endpoint, peerEndpoint });
  }
  for (const item of Object.values(evidence)) {
    item.paths = unique(item.paths);
    item.connections = [...new Map(item.connections.map((connection) => [
      `${connection.endpoint}:${connection.peerEndpoint}`,
      connection,
    ])).values()];
  }
  return evidence;
}

export function safeRun(runner, file, args, options) {
  try {
    const run = runner(file, args, options);
    if (!run || run.error || run.signal) {
      return {
        status: null,
        stdout: run?.stdout ?? "",
        stderr: run?.stderr ?? "",
        error: run?.error ?? run?.signal ?? true,
      };
    }
    return run;
  } catch {
    return { status: null, stdout: "", stderr: "", error: true };
  }
}

export function unique(values) {
  return [...new Set(values)];
}

export class CleanupRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function refuse(code) {
  throw new CleanupRefusal(code);
}

export function safeFailureCode(value, fallback) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
    ? value
    : fallback;
}

export function callerUid() {
  const uid = process.getuid?.();
  return Number.isInteger(uid) ? uid : -1;
}

export function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function validIsoTime(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export const REVALIDATED_IDENTITY_FIELDS = ["pid", "uid", "startTime", "executable", "processGroupId"];

export const BIRTH_IDENTITY_FIELDS = ["pid", "startTime"];

export function identityDifferences(expected, actual, fields = REVALIDATED_IDENTITY_FIELDS) {
  return fields.filter((field) => expected?.[field] !== actual?.[field]);
}

export function validObservedIdentity(identity) {
  return identity
    && Number.isInteger(identity.pid)
    && identity.pid > 0
    && Number.isInteger(identity.parentPid)
    && identity.parentPid >= 0
    && Number.isInteger(identity.processGroupId)
    && identity.processGroupId > 0
    && Number.isInteger(identity.uid)
    && validIsoTime(identity.startTime)
    && typeof identity.executable === "string"
    && identity.executable.startsWith("/");
}

export function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
