#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const EXIT_CODES = Object.freeze({
  healthy: 0,
  warning: 1,
  refused: 2,
  failed: 3,
});

export const DEFAULT_THRESHOLDS = Object.freeze({
  fdCount: 200,
  highestFd: 220,
  ageHours: 72,
  descendants: 75,
});

export const SNAPSHOT_SCHEMA = "cleanup-codex-exact-tree-v1";
const RECYCLE_RECEIPT_SCHEMA = "cleanup-codex-recycle-receipt-v1";
const RECYCLE_CONFIRMATION_PREFIX = "RECYCLE ";

const PID_NOFILE_ATTESTATION_SCHEMA = "codex-nofile-attestation-v1";
const LAUNCHER_NOFILE_ATTESTATION_SCHEMA = "codex-launcher-nofile-attestation-v1";

const DEFAULT_GRACE_MS = 1_500;
const DEFAULT_POST_SIGNAL_MS = 100;
const DEFAULT_MIN_SOFT_NOFILE = 8_192;
const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_READY_POLL_MS = 100;
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_PID_RECORD_BYTES = 4 * 1024;
const MAX_HOOK_RECEIPT_BYTES = 64 * 1024;
const MAX_HOOK_INPUT_BYTES = 16 * 1024;
// ponytail: one bounded SessionEnd pass; chunk only if real residue exceeds the three-second cap.
const MAX_HOOK_TARGETS = 24;
const MAX_HOOK_ANCESTORS = 8;
const HOOK_COMMAND_TIMEOUT_MS = 500;
const HOOK_TOTAL_BUDGET_MS = 2_700;
const HOOK_GRACE_MS = 200;
const HOOK_POST_SIGNAL_MS = 50;
const HOOK_RECEIPT_SCHEMA = "cleanup-codex-hook-cleanup-v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PS = "/bin/ps";
const LSOF = "/usr/sbin/lsof";
const PGREP = "/usr/bin/pgrep";
const SOCKET_NAME = "app-server-control.sock";
const THRESHOLD_FLAGS = new Map([
  ["--fd-count-warn", "fdCount"],
  ["--highest-fd-warn", "highestFd"],
  ["--age-hours-warn", "ageHours"],
  ["--descendant-warn", "descendants"],
]);
const CODEX_GLOBAL_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
]);
const CODEX_GLOBAL_VARIADIC_FLAGS = new Set(["-i", "--image"]);
const CODEX_GLOBAL_BOOLEAN_FLAGS = new Set([
  "--strict-config",
  "--oss",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--search",
  "--no-alt-screen",
]);
const APP_SERVER_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--code-mode-host",
  "--listen",
  "--ws-auth",
  "--ws-token-file",
  "--ws-token-sha256",
  "--ws-shared-secret-file",
  "--ws-issuer",
  "--ws-audience",
  "--ws-max-clock-skew-seconds",
]);
const APP_SERVER_BOOLEAN_FLAGS = new Set([
  "--strict-config",
  "--stdio",
  "--analytics-default-enabled",
]);

function defaultRunner(file, args, { timeout = 5_000 } = {}) {
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

function validThreshold(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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

function parsePsLine(line, commandField) {
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

function parsePsOutput(stdout, commandField) {
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

function optionEnd(tokens, index, valueFlags, booleanFlags, variadicFlags = null) {
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

function appServerCommandKind(command = "") {
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

function isAppServerCommand(command = "") {
  return appServerCommandKind(command) === "server";
}

function commandExecutable(command = "") {
  const first = command.trim().split(/\s+/, 1)[0] ?? "";
  return first.startsWith("/") ? first : "";
}

function commandName(command = "") {
  return path.basename(command.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
}

function commandEvidenceAgrees(command, observation) {
  const rawExecutable = command.trim().split(/\s+/, 1)[0] ?? "";
  const observedExecutable = observation.identity?.executable ?? "";
  return Boolean(observation.commandName)
    && path.basename(observedExecutable).toLowerCase() === observation.commandName
    && (rawExecutable.startsWith("/")
      ? rawExecutable === observedExecutable
      : path.basename(rawExecutable).toLowerCase() === observation.commandName);
}

function parseDescriptors(stdout) {
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

function parseProcessFiles(stdout, psCommand = "") {
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

function socketPath(name) {
  const candidate = name.trim();
  const arrow = candidate.lastIndexOf("->");
  const candidatePath = (arrow >= 0 ? candidate.slice(arrow + 2) : candidate).trim();
  return candidatePath.startsWith("/") && path.basename(candidatePath) === SOCKET_NAME
    ? candidatePath
    : null;
}

function socketEndpoint(value) {
  return /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : null;
}

function parseControlSockets(stdout) {
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

function parseProxySocketEvidence(stdout, pids) {
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

function safeRun(runner, file, args, options) {
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

export function collectMacOSInventory({ runner = defaultRunner, platform = process.platform } = {}) {
  const inventory = {
    platform,
    collectionErrors: [],
    processes: [],
    descriptors: {},
    proxySockets: {},
    controlSockets: { complete: false, items: [] },
  };

  if (platform !== "darwin") {
    inventory.collectionErrors.push({ code: "unsupported-platform" });
    return inventory;
  }

  const processRun = safeRun(runner, PS, [
    "-axo",
    "pid=,ppid=,pgid=,uid=,lstart=,command=",
  ]);
  if (processRun.status !== 0) {
    inventory.collectionErrors.push({ code: "process-list-unavailable" });
    return inventory;
  }

  const processList = parsePsOutput(processRun.stdout, "rawCommand");
  inventory.processes = processList.parsed.map((record) => ({
    ...record,
    executable: commandExecutable(record.rawCommand),
  }));
  if (processList.invalidRows > 0) {
    inventory.collectionErrors.push({ code: "process-list-incomplete" });
  }

  for (const processRecord of inventory.processes.filter((record) => isAppServerCommand(record.rawCommand))) {
    const observation = collectExactProcessEvidence(processRecord.pid, { runner });
    const exact = observation.state === "present"
      && validObservedIdentity(observation.identity)
      && identityDifferences(
        processRecord,
        observation.identity,
        ["pid", "parentPid", "processGroupId", "uid", "startTime"],
      ).length === 0
      && commandEvidenceAgrees(processRecord.rawCommand, observation);
    if (exact) {
      Object.assign(processRecord, observation.identity);
      inventory.descriptors[processRecord.pid] = observation.descriptors;
    } else {
      inventory.descriptors[processRecord.pid] = { complete: false, count: null, highest: null };
      processRecord.executable = null;
    }
    processRecord.identityComplete = exact;
  }

  const proxyPids = inventory.processes
    .filter((record) => appServerCommandKind(record.rawCommand) === "proxy")
    .map((record) => record.pid);
  const socketRun = safeRun(runner, LSOF, ["-nP", "-U", "-Fpcfdn"]);
  if (socketRun.status === 0) {
    inventory.proxySockets = parseProxySocketEvidence(socketRun.stdout, proxyPids);
    inventory.controlSockets = {
      complete: true,
      items: parseControlSockets(socketRun.stdout),
    };
  } else {
    inventory.proxySockets = Object.fromEntries(proxyPids.map((pid) => [pid, {
      complete: false,
      paths: [],
      connections: [],
    }]));
    inventory.collectionErrors.push({ code: "control-socket-unavailable" });
  }

  return inventory;
}

function collectExactProcessEvidence(pid, { runner = defaultRunner } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown" };
  const args = [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,pgid=,uid=,lstart=,comm=",
  ];
  const identityRun = safeRun(runner, PS, args);
  if (identityRun.status === 1 && !identityRun.stdout.trim()) return { state: "absent" };
  if (identityRun.status !== 0) return { state: "unknown" };
  const rows = parsePsOutput(identityRun.stdout, "psCommand").parsed;
  const identity = rows.length === 1 && rows[0].pid === pid ? rows[0] : null;
  if (!identity) return rows.length === 0 ? { state: "absent" } : { state: "unknown" };

  const filesRun = safeRun(runner, LSOF, [
    "-nP",
    "-a",
    "-p",
    String(pid),
    "-Fftn",
  ]);
  if (filesRun.status !== 0) return { state: "unknown" };
  const files = parseProcessFiles(filesRun.stdout, identity.psCommand);
  const executable = files.executable;
  if (!executable?.startsWith("/")) return { state: "unknown" };

  const confirmationRun = safeRun(runner, PS, args);
  if (confirmationRun.status === 1 && !confirmationRun.stdout.trim()) return { state: "absent" };
  if (confirmationRun.status !== 0) return { state: "unknown" };
  const confirmationRows = parsePsOutput(confirmationRun.stdout, "psCommand").parsed;
  const confirmation = confirmationRows.length === 1 && confirmationRows[0].pid === pid
    ? confirmationRows[0]
    : null;
  if (!confirmation) return confirmationRows.length === 0 ? { state: "absent" } : { state: "unknown" };
  if (identityDifferences(
    identity,
    confirmation,
    ["pid", "parentPid", "processGroupId", "uid", "startTime", "psCommand"],
  ).length) return { state: "unknown" };
  return {
    state: "present",
    commandName: commandName(identity.psCommand),
    identity: {
      pid: identity.pid,
      parentPid: identity.parentPid,
      processGroupId: identity.processGroupId,
      uid: identity.uid,
      startTime: identity.startTime,
      executable,
    },
    descriptors: files.descriptors,
    controlSocket: files.controlSockets.length === 1 ? files.controlSockets[0] : null,
  };
}

export function collectExactProcessIdentity(pid, options = {}) {
  const observation = collectExactProcessEvidence(pid, options);
  return observation.identity
    ? { state: observation.state, identity: observation.identity }
    : { state: observation.state };
}

function isGuiHost(processRecord) {
  const identity = `${processRecord.executable ?? ""} ${processRecord.rawCommand ?? ""}`;
  return /\/(?:Codex|ChatGPT)\.app\/Contents\/MacOS\/(?:Codex|ChatGPT)(?:\s|$)/i.test(identity)
    || /\/(?:Codex|ChatGPT)\.app\/Contents\/Frameworks\/.*(?:Codex|ChatGPT) Helper/i.test(identity);
}

function classifyAncestry(server, byPid, processListComplete) {
  if (!processListComplete) {
    return { classification: "ambiguous", reason: "process-list-incomplete" };
  }
  if (!Number.isInteger(server.parentPid) || server.parentPid <= 0) {
    return { classification: "ambiguous", reason: "parent-identity-missing" };
  }

  const seen = new Set([server.pid]);
  let parentPid = server.parentPid;
  while (parentPid > 1) {
    if (seen.has(parentPid)) {
      return { classification: "ambiguous", reason: "ancestry-cycle" };
    }
    seen.add(parentPid);
    const parent = byPid.get(parentPid);
    if (!parent) {
      return { classification: "ambiguous", reason: "ancestry-missing" };
    }
    if (isGuiHost(parent)) {
      return { classification: "gui", reason: "codex-gui-ancestry" };
    }
    parentPid = parent.parentPid;
  }
  return { classification: "detached", reason: "detached-unix-ancestry" };
}

function descendantsOf(pid, children) {
  const direct = children.get(pid) ?? [];
  const descendants = [];
  const pending = [...direct];
  const seen = new Set();
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index];
    if (!current || seen.has(current.pid)) continue;
    seen.add(current.pid);
    descendants.push(current);
    pending.push(...(children.get(current.pid) ?? []));
  }
  return { direct, descendants };
}

function childrenByParent(processes) {
  const children = new Map();
  for (const processRecord of processes) {
    const list = children.get(processRecord.parentPid) ?? [];
    list.push(processRecord);
    children.set(processRecord.parentPid, list);
  }
  return children;
}

function proxyCommandIdentity(command = "") {
  if (appServerCommandKind(command) === "proxy") return "codex app-server proxy";
  if (/\bremote[-_ ]proxy\b/i.test(command)) return "remote-proxy";
  if (/(?:^|\/)cloudflared(?:\s|$)/i.test(command)) return "cloudflared";
  if (/(?:^|\/)ngrok(?:\s|$)/i.test(command)) return "ngrok";
  if (/(?:^|\/)frpc(?:\s|$)/i.test(command)) return "frpc";
  if (/(?:^|\/)ssh(?:\s|$)/i.test(command) && /(?:^|\s)-[LRD]/.test(command)) {
    return "ssh port-forward";
  }
  return null;
}

function descriptorFor(descriptors, pid) {
  return descriptors?.[pid];
}

function processIdentityComplete(processRecord) {
  return processRecord.identityComplete !== false
    && Number.isInteger(processRecord.pid)
    && processRecord.pid > 0
    && Number.isInteger(processRecord.parentPid)
    && Number.isInteger(processRecord.processGroupId)
    && processRecord.processGroupId > 0
    && Number.isInteger(processRecord.uid)
    && typeof processRecord.startTime === "string"
    && Number.isFinite(Date.parse(processRecord.startTime))
    && typeof processRecord.executable === "string"
    && processRecord.executable.startsWith("/");
}

function proxySocketFor(proxySockets, pid) {
  return proxySockets?.[pid];
}

function proxySocketAssociation(evidence, controlSockets) {
  if (!evidence?.complete || !Array.isArray(evidence.paths)) return null;
  const paths = unique(evidence.paths.map((value) => socketPath(String(value ?? ""))).filter(Boolean));
  if (paths.length > 1) return null;
  const peers = unique((evidence.connections ?? [])
    .map((connection) => socketEndpoint(String(connection?.peerEndpoint ?? "")))
    .filter(Boolean));
  const endpointMatches = (controlSockets?.items ?? []).filter((item) => (
    (item.endpoints ?? []).some((endpoint) => peers.includes(socketEndpoint(String(endpoint ?? ""))))
  ));
  if (endpointMatches.length > 1) return null;
  const endpointMatch = endpointMatches[0] ?? null;
  if (paths.length === 1) {
    const directPath = paths[0];
    if (endpointMatch && socketPath(String(endpointMatch.path ?? "")) !== directPath) return null;
    return {
      path: directPath,
      ownerPid: Number.isInteger(endpointMatch?.ownerPid) ? endpointMatch.ownerPid : null,
    };
  }
  if (!endpointMatch) return null;
  return {
    path: socketPath(String(endpointMatch.path ?? "")),
    ownerPid: endpointMatch.ownerPid,
  };
}

function serverSocket(serverPid, controlSockets, missingEvidence) {
  if (!controlSockets?.complete) {
    missingEvidence.push("control-socket");
    return { path: null, ownerPid: null, state: "unknown" };
  }
  const sockets = (controlSockets.items ?? [])
    .filter((item) => Number.isInteger(item.ownerPid) && socketPath(String(item.path ?? "")))
    .map((item) => ({
      path: socketPath(item.path),
      ownerPid: item.ownerPid,
      endpoints: unique((item.endpoints ?? [])
        .map((endpoint) => socketEndpoint(String(endpoint ?? "")))
        .filter(Boolean)),
    }));
  const owned = sockets.filter((item) => item.ownerPid === serverPid);
  const observed = owned.length === 1 ? owned[0] : sockets.length === 1 ? sockets[0] : null;
  if (owned.length > 1 || (!observed && sockets.length > 1)) {
    missingEvidence.push("control-socket-association");
    return { path: null, ownerPid: null, state: "ambiguous" };
  }
  if (!observed) return { path: null, ownerPid: null, state: "not-observed" };
  return {
    ...observed,
    state: observed.ownerPid === serverPid ? "owned" : "owned-by-other",
  };
}

function pressureWarnings(server, thresholds) {
  const candidates = [
    ["fd-count-pressure", server.descriptorCount, thresholds.fdCount, "descriptor count"],
    ["highest-fd-pressure", server.highestDescriptor, thresholds.highestFd, "highest descriptor"],
    ["age-pressure", server.ageHours, thresholds.ageHours, "age hours"],
    ["descendant-pressure", server.descendants.total, thresholds.descendants, "descendant count"],
  ];
  return candidates
    .filter(([, observed, threshold]) => Number.isFinite(observed) && observed >= threshold)
    .map(([code, observed, threshold, label]) => ({
      code,
      pid: server.pid,
      observed,
      threshold,
      message: `${label} ${observed} meets warning threshold ${threshold}`,
      authorizesAction: false,
    }));
}

function unique(values) {
  return [...new Set(values)];
}

class CleanupRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function refuse(code) {
  throw new CleanupRefusal(code);
}

function safeFailureCode(value, fallback) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
    ? value
    : fallback;
}

function callerUid() {
  const uid = process.getuid?.();
  return Number.isInteger(uid) ? uid : -1;
}

function exactKeys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...allowed].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function validIsoTime(value) {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

const SNAPSHOT_KEYS = ["createdAt", "createdByUid", "owner", "schema", "targets"];
const SNAPSHOT_IDENTITY_KEYS = [
  "commandIdentity",
  "executable",
  "parentPid",
  "pid",
  "processGroupId",
  "role",
  "startTime",
  "uid",
];

function validSnapshotIdentity(identity, uid, roles) {
  if (!exactKeys(identity, SNAPSHOT_IDENTITY_KEYS)) return false;
  if (!roles.includes(identity.role)) return false;
  if (!validObservedIdentity(identity) || identity.uid !== uid) return false;
  if (identity.role === "server" && identity.commandIdentity !== "codex app-server") return false;
  if (identity.role === "descendant" && identity.commandIdentity !== "process") return false;
  if (identity.role === "proxy" && identity.commandIdentity !== "codex app-server proxy") return false;
  return true;
}

function validateSnapshotObject(snapshot, uid) {
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)) refuse("snapshot-schema-invalid");
  if (snapshot.schema !== SNAPSHOT_SCHEMA || !validIsoTime(snapshot.createdAt)) {
    refuse("snapshot-schema-invalid");
  }
  if (!Number.isInteger(snapshot.createdByUid) || snapshot.createdByUid !== uid) {
    refuse("snapshot-schema-invalid");
  }
  if (!validSnapshotIdentity(snapshot.owner, uid, ["server"])) refuse("snapshot-schema-invalid");
  if (!Array.isArray(snapshot.targets) || snapshot.targets.length > 10_000) {
    refuse("snapshot-schema-invalid");
  }

  const targets = new Map();
  for (const target of snapshot.targets) {
    if (!validSnapshotIdentity(target, uid, ["descendant", "proxy"])) {
      refuse("snapshot-schema-invalid");
    }
    if (target.pid === snapshot.owner.pid || targets.has(target.pid)) refuse("snapshot-schema-invalid");
    targets.set(target.pid, target);
  }
  const reachesOwner = new Set([snapshot.owner.pid]);
  for (const target of snapshot.targets.filter((item) => item.role === "descendant")) {
    const chain = [];
    const seen = new Set();
    let current = target;
    while (!reachesOwner.has(current.pid)) {
      if (seen.has(current.pid)) refuse("snapshot-schema-invalid");
      seen.add(current.pid);
      chain.push(current.pid);
      if (current.parentPid === snapshot.owner.pid) break;
      const parent = targets.get(current.parentPid);
      if (!parent || parent.role !== "descendant") refuse("snapshot-schema-invalid");
      current = parent;
    }
    for (const pid of chain) reachesOwner.add(pid);
  }
  return snapshot;
}

const REVALIDATED_IDENTITY_FIELDS = ["pid", "uid", "startTime", "executable", "processGroupId"];
const BIRTH_IDENTITY_FIELDS = ["pid", "startTime"];

function identityDifferences(expected, actual, fields = REVALIDATED_IDENTITY_FIELDS) {
  return fields.filter((field) => expected?.[field] !== actual?.[field]);
}

function validObservedIdentity(identity) {
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

function snapshotIdentity(identity, role) {
  return {
    role,
    pid: identity.pid,
    parentPid: identity.parentPid,
    processGroupId: identity.processGroupId,
    uid: identity.uid,
    startTime: identity.startTime,
    executable: identity.executable,
    commandIdentity: role === "server"
      ? "codex app-server"
      : role === "proxy"
        ? "codex app-server proxy"
        : "process",
  };
}

export function buildExactTreeSnapshot({
  inventory,
  inspection,
  readIdentity,
  now = Date.now(),
  uid = callerUid(),
}) {
  if (inspection?.selected?.length !== 1) refuse("snapshot-selection-ambiguous");
  const ownerPid = inspection.selected[0].pid;
  const server = inspection.verification?.servers?.find((item) => item.pid === ownerPid);
  if (!server || server.classification !== "detached" || server.missingEvidence.length) {
    refuse("snapshot-selection-ambiguous");
  }
  const ownerObservation = readIdentity(ownerPid);
  if (ownerObservation?.state !== "present" || !validObservedIdentity(ownerObservation.identity)) {
    refuse("snapshot-owner-unavailable");
  }
  const owner = ownerObservation.identity;
  if (
    owner.uid !== uid
    || identityDifferences(server, owner).length
    || server.parentPid !== owner.parentPid
  ) refuse("snapshot-owner-changed");

  const processes = Array.isArray(inventory.processes) ? inventory.processes : [];
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const children = childrenByParent(processes);
  const descendantPids = descendantsOf(ownerPid, children).descendants.map((item) => item.pid);
  const proxyPids = (server.remoteProxyClients ?? []).flatMap((proxy) => {
    if (proxy.commandIdentity !== "codex app-server proxy") return [];
    const association = proxySocketAssociation(
      proxySocketFor(inventory.proxySockets, proxy.pid),
      inventory.controlSockets,
    );
    if (association?.ownerPid !== ownerPid) refuse("snapshot-proxy-unclassified");
    return [proxy.pid];
  });
  const proxySet = new Set(proxyPids);
  const targetPids = unique([...descendantPids, ...proxyPids])
    .filter((pid) => pid !== ownerPid)
    .sort((left, right) => left - right);
  const targets = [];
  for (const pid of targetPids) {
    const recorded = byPid.get(pid);
    if (!recorded) refuse("snapshot-tree-changed");
    const observation = readIdentity(pid);
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("snapshot-target-unavailable");
    }
    const identity = observation.identity;
    if (
      identity.uid !== uid
      || identityDifferences(recorded, identity, ["pid", "uid", "startTime", "processGroupId"]).length
      || recorded.parentPid !== identity.parentPid
    ) refuse("snapshot-tree-changed");
    targets.push(snapshotIdentity(identity, proxySet.has(pid) ? "proxy" : "descendant"));
  }

  const timestamp = typeof now === "function" ? now() : now;
  const snapshot = {
    schema: SNAPSHOT_SCHEMA,
    createdAt: new Date(timestamp).toISOString(),
    createdByUid: uid,
    owner: snapshotIdentity(owner, "server"),
    targets,
  };
  return validateSnapshotObject(snapshot, uid);
}

function snapshotFileStat(stat, uid) {
  if (stat.isSymbolicLink?.()) refuse("snapshot-file-symlink");
  if (!stat.isFile?.()) refuse("snapshot-file-type");
  if (stat.uid !== uid) refuse("snapshot-file-owner");
  if ((stat.mode & 0o777) !== 0o600) refuse("snapshot-file-mode");
  if (stat.nlink !== 1) refuse("snapshot-file-links");
}

function lstatOrNull(fsApi, file) {
  try {
    return fsApi.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    refuse("snapshot-file-unavailable");
  }
}

function unlinkMatchingInode(fsApi, file, expected) {
  if (!expected) return false;
  const retired = path.join(
    path.dirname(file),
    `.cleanup-codex-${randomBytes(12).toString("hex")}.retired`,
  );
  try {
    const current = fsApi.lstatSync(file);
    if (current.isSymbolicLink() || !current.isFile()
      || current.dev !== expected.dev || current.ino !== expected.ino
      || current.uid !== expected.uid) {
      return false;
    }
    fsApi.renameSync(file, retired);
    const moved = fsApi.lstatSync(retired);
    if (moved.isSymbolicLink() || !moved.isFile()
      || moved.dev !== expected.dev || moved.ino !== expected.ino
      || moved.uid !== expected.uid) {
      try {
        if (moved.isFile() && !moved.isSymbolicLink()) {
          fsApi.linkSync(retired, file);
          fsApi.unlinkSync(retired);
        }
      } catch {}
      return false;
    }
    fsApi.unlinkSync(retired);
    return true;
  } catch {
    return false;
  }
}

export function writeSnapshotAtomic(file, snapshot, {
  fsApi = fs,
  uid = callerUid(),
  token = randomBytes(12).toString("hex"),
} = {}) {
  validateSnapshotObject(snapshot, uid);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_SNAPSHOT_BYTES) refuse("snapshot-file-size");
  const destination = path.resolve(file);
  const existing = lstatOrNull(fsApi, destination);
  if (existing?.isSymbolicLink?.()) refuse("snapshot-file-symlink");
  if (existing) refuse("snapshot-file-exists");
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${token}.tmp`);
  let descriptor = null;
  let temporaryIdentity = null;
  let destinationPublished = false;
  try {
    const flags = fsApi.constants.O_WRONLY
      | fsApi.constants.O_CREAT
      | fsApi.constants.O_EXCL
      | fsApi.constants.O_NOFOLLOW;
    descriptor = fsApi.openSync(temporary, flags, 0o600);
    temporaryIdentity = fsApi.fstatSync(descriptor);
    fsApi.fchmodSync(descriptor, 0o600);
    fsApi.writeFileSync(descriptor, serialized, "utf8");
    fsApi.fsyncSync(descriptor);
    snapshotFileStat(fsApi.fstatSync(descriptor), uid);
    fsApi.closeSync(descriptor);
    descriptor = null;
    fsApi.linkSync(temporary, destination);
    destinationPublished = true;
    fsApi.unlinkSync(temporary);
    snapshotFileStat(fsApi.lstatSync(destination), uid);
    return snapshot;
  } catch (error) {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
    if (destinationPublished) unlinkMatchingInode(fsApi, destination, temporaryIdentity);
    unlinkMatchingInode(fsApi, temporary, temporaryIdentity);
    if (error instanceof CleanupRefusal) throw error;
    if (error?.code === "EEXIST") refuse("snapshot-file-exists");
    refuse("snapshot-write-failed");
  }
}

export function readSnapshotSecure(file, {
  fsApi = fs,
  uid = callerUid(),
} = {}) {
  const source = path.resolve(file);
  const before = lstatOrNull(fsApi, source);
  if (!before) refuse("snapshot-file-missing");
  snapshotFileStat(before, uid);
  if (before.size <= 0 || before.size > MAX_SNAPSHOT_BYTES) refuse("snapshot-file-size");
  let descriptor = null;
  try {
    descriptor = fsApi.openSync(source, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    snapshotFileStat(opened, uid);
    if (opened.dev !== before.dev || opened.ino !== before.ino) refuse("snapshot-file-changed");
    const raw = fsApi.readFileSync(descriptor, "utf8");
    const after = fsApi.fstatSync(descriptor);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) refuse("snapshot-file-changed");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      refuse("snapshot-schema-invalid");
    }
    return validateSnapshotObject(parsed, uid);
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    if (error?.code === "ELOOP") refuse("snapshot-file-symlink");
    refuse("snapshot-file-unavailable");
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "ESRCH" ? false : null;
  }
}

function processBirthObservation(pid, runner = defaultRunner) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown" };
  const run = safeRun(runner, PS, [
    "-p",
    String(pid),
    "-o",
    "pid=,ppid=,pgid=,uid=,lstart=,comm=",
  ], { timeout: HOOK_COMMAND_TIMEOUT_MS });
  if (run.status === 1 && !run.stdout.trim()) return { state: "absent" };
  if (run.status !== 0) return { state: "unknown" };
  const rows = parsePsOutput(run.stdout, "psCommand").parsed;
  const identity = rows.length === 1 && rows[0].pid === pid ? rows[0] : null;
  return identity
    ? { state: "present", uid: identity.uid, startTime: identity.startTime }
    : { state: rows.length ? "unknown" : "absent" };
}

function reclaimDeadMutationLock(fsApi, lockPath, uid, pidIsAlive, readProcessBirth) {
  let before;
  let descriptor = null;
  try {
    before = fsApi.lstatSync(lockPath);
    if (
      before.isSymbolicLink()
      || !before.isFile()
      || before.uid !== uid
      || before.nlink !== 1
      || (before.mode & 0o777) !== 0o600
      || before.size <= 0
      || before.size > 1024
    ) return false;
    descriptor = fsApi.openSync(lockPath, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) return false;
    const owner = JSON.parse(fsApi.readFileSync(descriptor, "utf8"));
    const legacy = exactKeys(owner, ["pid", "uid"]);
    const birthBound = exactKeys(owner, ["pid", "uid", "startTime"])
      && validIsoTime(owner.startTime);
    if (
      (!legacy && !birthBound)
      || !Number.isInteger(owner.pid)
      || owner.pid <= 0
      || owner.uid !== uid
    ) return false;
    if (birthBound) {
      const observed = readProcessBirth(owner.pid);
      if (
        observed?.state !== "absent"
        && !(observed?.state === "present" && observed.startTime !== owner.startTime)
      ) return false;
    } else if (pidIsAlive(owner.pid) !== false) return false;
    const current = fsApi.lstatSync(lockPath);
    if (
      current.isSymbolicLink()
      || !current.isFile()
      || current.uid !== uid
      || current.dev !== opened.dev
      || current.ino !== opened.ino
    ) return false;
    fsApi.unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

export function createMutationLock({
  fsApi = fs,
  uid = callerUid(),
  lockPath = path.join(os.tmpdir(), `railyard-cleanup-codex-${uid}.lock`),
  pidIsAlive = processLiveness,
  readProcessBirth = processBirthObservation,
} = {}) {
  return {
    acquire() {
      let descriptor;
      let createdIdentity = null;
      try {
        reclaimDeadMutationLock(fsApi, lockPath, uid, pidIsAlive, readProcessBirth);
        const owner = readProcessBirth(process.pid);
        if (owner?.state !== "present" || owner.uid !== uid || !validIsoTime(owner.startTime)) {
          refuse("mutation-lock-unavailable");
        }
        const flags = fsApi.constants.O_WRONLY
          | fsApi.constants.O_CREAT
          | fsApi.constants.O_EXCL
          | fsApi.constants.O_NOFOLLOW;
        descriptor = fsApi.openSync(lockPath, flags, 0o600);
        createdIdentity = fsApi.fstatSync(descriptor);
        fsApi.fchmodSync(descriptor, 0o600);
        fsApi.writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          uid,
          startTime: owner.startTime,
        })}\n`, "utf8");
        fsApi.fsyncSync(descriptor);
        const held = fsApi.fstatSync(descriptor);
        if (
          !held.isFile()
          || held.uid !== uid
          || (held.mode & 0o777) !== 0o600
          || held.dev !== createdIdentity.dev
          || held.ino !== createdIdentity.ino
        ) {
          refuse("mutation-lock-unsafe");
        }
        return () => {
          try {
            if (!unlinkMatchingInode(fsApi, lockPath, held)) refuse("mutation-lock-changed");
          } finally {
            fsApi.closeSync(descriptor);
          }
        };
      } catch (error) {
        if (descriptor !== undefined) {
          try { fsApi.closeSync(descriptor); } catch {}
        }
        unlinkMatchingInode(fsApi, lockPath, createdIdentity);
        if (error instanceof CleanupRefusal) throw error;
        if (error?.code === "EEXIST" || error?.code === "ELOOP") {
          const locked = new CleanupRefusal("mutation-lock-held");
          locked.cause = error;
          throw locked;
        }
        refuse("mutation-lock-unavailable");
      }
    },
  };
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function signalExactPid(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) refuse("signal-target-invalid");
  process.kill(pid, signal);
}

function emptyReapResult(platform) {
  return {
    schemaVersion: 1,
    action: "reap",
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
      ownerProof: "unverified",
      termPids: [],
      killPids: [],
      postKillVerifiedPids: [],
      snapshot: null,
      controlSockets: [],
      servers: [],
    },
  };
}

function skippedIdentity(pid, observation, expected) {
  if (observation?.state === "absent") return { pid, reasons: ["already-absent"] };
  if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
    return { pid, reasons: ["identity-unavailable"] };
  }
  const changed = identityDifferences(expected, observation.identity);
  return changed.length
    ? { pid, reasons: changed.map((field) => `identity-changed:${field}`) }
    : null;
}

export function reapSnapshot(snapshot, {
  platform = process.platform,
  uid = callerUid(),
  readIdentity = (pid) => collectExactProcessIdentity(pid),
  signalProcess = signalExactPid,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  lock = createMutationLock({ uid }),
} = {}) {
  const result = emptyReapResult(platform);
  let exitCode = EXIT_CODES.refused;
  let release = null;
  let identityRefused = false;
  let attemptedFailure = false;

  try {
    if (platform !== "darwin") refuse("unsupported-platform");
    validateSnapshotObject(snapshot, uid);
    if (
      !Number.isFinite(graceMs)
      || graceMs < 0
      || graceMs > 10_000
      || !Number.isFinite(postSignalMs)
      || postSignalMs < 0
      || postSignalMs > 10_000
    ) {
      refuse("invalid-grace-period");
    }
    result.verification.snapshot = {
      schema: snapshot.schema,
      ownerPid: snapshot.owner.pid,
      targetPids: snapshot.targets.map((target) => target.pid),
    };
    try {
      release = lock.acquire();
    } catch (error) {
      refuse(error?.code === "mutation-lock-held" || error?.code === "ELOCKED"
        ? "mutation-lock-held"
        : "mutation-lock-unavailable");
    }

    const ownerObservation = readIdentity(snapshot.owner.pid);
    if (ownerObservation?.state === "present" && validObservedIdentity(ownerObservation.identity)) {
      const changed = identityDifferences(snapshot.owner, ownerObservation.identity);
      refuse(changed.length ? "owner-identity-changed" : "owner-still-live");
    }
    if (ownerObservation?.state !== "absent") refuse("owner-evidence-unavailable");
    result.verification.ownerProof = "absent";

    const active = [];
    for (const target of snapshot.targets) {
      const observation = readIdentity(target.pid);
      const skipped = skippedIdentity(target.pid, observation, target);
      if (!skipped) active.push(target);
      else if (skipped.reasons[0] === "already-absent") result.skipped.push(skipped);
      else {
        result.skipped.push(skipped);
        identityRefused = true;
      }
    }
    if (identityRefused) refuse("target-identity-changed");
    result.selected = active.map((target) => ({ pid: target.pid, role: target.role }));

    const termTargets = [];
    for (const target of active) {
      const observation = readIdentity(target.pid);
      const skipped = skippedIdentity(target.pid, observation, target);
      if (skipped) {
        result.skipped.push(skipped);
        if (skipped.reasons[0] !== "already-absent") identityRefused = true;
        if (identityRefused) break;
        continue;
      }
      try {
        result.verification.mutationAttempted = true;
        signalProcess(target.pid, "SIGTERM");
        result.verification.termPids.push(target.pid);
        termTargets.push(target);
      } catch (error) {
        if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
        else {
          attemptedFailure = true;
          result.verification.missingEvidence.push("signal-or-wait-failed");
        }
        if (attemptedFailure) break;
      }
    }

    if (!attemptedFailure && result.verification.termPids.length) {
      try {
        sleep(graceMs);
      } catch {
        attemptedFailure = true;
        result.verification.missingEvidence.push("signal-or-wait-failed");
      }
    }

    const killedTargets = [];
    if (!attemptedFailure) {
      for (const target of termTargets) {
        const observation = readIdentity(target.pid);
        const skipped = skippedIdentity(target.pid, observation, target);
        if (skipped?.reasons[0] === "already-absent") {
          result.skipped.push(skipped);
          continue;
        }
        if (skipped) {
          const reused = !sameBirthIdentityPresent(target, observation);
          result.skipped.push(reused
            ? { pid: target.pid, reasons: ["pid-reused-after-term"] }
            : skipped);
          if (reused) {
            result.verification.postKillVerifiedPids.push(target.pid);
            continue;
          }
          identityRefused = true;
          continue;
        }
        try {
          result.verification.mutationAttempted = true;
          signalProcess(target.pid, "SIGKILL");
          result.verification.killPids.push(target.pid);
          killedTargets.push(target);
        } catch (error) {
          if (error?.code === "ESRCH") result.skipped.push({ pid: target.pid, reasons: ["already-absent"] });
          else {
            attemptedFailure = true;
            result.verification.missingEvidence.push("signal-or-wait-failed");
          }
        }
      }
    }

    if (!attemptedFailure && killedTargets.length) {
      try {
        sleep(postSignalMs);
      } catch {
        attemptedFailure = true;
        result.verification.missingEvidence.push("signal-or-wait-failed");
      }
    }
    if (!attemptedFailure) {
      for (const target of killedTargets) {
        const observation = readIdentity(target.pid);
        if (observation?.state === "absent") {
          result.verification.postKillVerifiedPids.push(target.pid);
          continue;
        }
        if (observation?.state === "present" && validObservedIdentity(observation.identity)) {
          if (!sameBirthIdentityPresent(target, observation)) {
            result.verification.postKillVerifiedPids.push(target.pid);
            result.skipped.push({ pid: target.pid, reasons: ["pid-reused-after-kill"] });
          } else {
            attemptedFailure = true;
            result.verification.missingEvidence.push("post-kill-survivor");
          }
          continue;
        }
        attemptedFailure = true;
        result.verification.missingEvidence.push("post-kill-verification-unknown");
      }
    }

    if (attemptedFailure) {
      result.status = "failed";
      exitCode = EXIT_CODES.failed;
    } else if (identityRefused) {
      result.verification.missingEvidence.push("target-identity-changed");
      if (result.verification.mutationAttempted) {
        result.status = "failed";
        result.verification.missingEvidence.push("incomplete-after-mutation");
        exitCode = EXIT_CODES.failed;
      } else {
        result.status = "refused";
        exitCode = EXIT_CODES.refused;
      }
    } else {
      result.status = "healthy";
      result.verification.complete = true;
      exitCode = EXIT_CODES.healthy;
    }
  } catch (error) {
    const code = error instanceof CleanupRefusal ? error.code : "reap-failed";
    result.status = code === "reap-failed" ? "failed" : "refused";
    result.verification.missingEvidence.push(code);
    exitCode = code === "reap-failed" ? EXIT_CODES.failed : EXIT_CODES.refused;
  } finally {
    if (release) {
      try {
        release();
      } catch {
        result.status = "failed";
        result.verification.complete = false;
        result.verification.missingEvidence.push("mutation-lock-release-failed");
        exitCode = EXIT_CODES.failed;
      }
    }
  }
  result.verification.missingEvidence = unique(result.verification.missingEvidence);
  return { result, exitCode };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function recycleConfirmationToken(receiptEvidence) {
  return `${RECYCLE_CONFIRMATION_PREFIX}${sha256(stableJson(receiptEvidence))}`;
}

function emptyRecycleResult(platform) {
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
      mode: null,
      receipt: null,
      before: null,
      actions: [],
      after: null,
      guiPreserved: false,
      controlSockets: [],
      servers: [],
    },
  };
}

function canonicalPathOrRefuse(value, canonicalPath, code) {
  if (typeof value !== "string" || !path.isAbsolute(value)) refuse(code);
  let canonical;
  try {
    canonical = canonicalPath(value);
  } catch {
    refuse(code);
  }
  if (typeof canonical !== "string" || !path.isAbsolute(canonical)) refuse(code);
  return canonical;
}

function executableEvidenceOrRefuse(value, {
  canonicalPath,
  fileIdentity,
  uid,
  code,
  requireOwner = false,
}) {
  const canonical = canonicalPathOrRefuse(value, canonicalPath, code);
  let evidence;
  try {
    evidence = fileIdentity(canonical);
  } catch {
    refuse(code);
  }
  if (
    !evidence
    || evidence.path !== canonical
    || !Number.isInteger(evidence.dev)
    || !Number.isInteger(evidence.ino)
    || !Number.isInteger(evidence.mode)
    || !Number.isInteger(evidence.nlink)
    || !Number.isFinite(evidence.mtimeMs)
    || !Number.isInteger(evidence.size)
    || typeof evidence.digest !== "string"
    || !/^[0-9a-f]{64}$/.test(evidence.digest)
    || evidence.regular !== true
    || evidence.symlink !== false
    || evidence.executable !== true
    || evidence.nlink !== 1
    || (evidence.mode & 0o022) !== 0
    || (evidence.mode & 0o6000) !== 0
    || (requireOwner && evidence.uid !== 0 && evidence.uid !== uid)
  ) refuse(code);
  return {
    path: canonical,
    dev: evidence.dev,
    ino: evidence.ino,
    mode: evidence.mode & 0o777,
    nlink: evidence.nlink,
    mtimeMs: evidence.mtimeMs,
    size: evidence.size,
    digest: evidence.digest,
    ...(Number.isInteger(evidence.uid) ? { uid: evidence.uid } : {}),
  };
}

function revalidateExecutableEvidence(expected, dependencies, uid, code) {
  const current = executableEvidenceOrRefuse(expected.path, {
    canonicalPath: dependencies.canonicalPath,
    fileIdentity: dependencies.fileIdentity,
    uid,
    code,
    requireOwner: true,
  });
  if (
    current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.mode !== expected.mode
    || current.nlink !== expected.nlink
    || current.mtimeMs !== expected.mtimeMs
    || current.size !== expected.size
    || current.digest !== expected.digest
  ) refuse(code);
  return current;
}

function normalizedSocketOwners(owners) {
  if (!Array.isArray(owners)) refuse("daemon-socket-ownership-ambiguous");
  const normalized = owners.map((owner) => {
    if (!exactKeys(owner, ["pid", "uid"]) || !Number.isInteger(owner.pid) || !Number.isInteger(owner.uid)) {
      refuse("daemon-socket-ownership-ambiguous");
    }
    return { pid: owner.pid, uid: owner.uid };
  }).sort((left, right) => left.pid - right.pid || left.uid - right.uid);
  if (new Set(normalized.map((owner) => `${owner.pid}:${owner.uid}`)).size !== normalized.length) {
    refuse("daemon-socket-ownership-ambiguous");
  }
  return normalized;
}

function normalizeDaemonSample(sample, {
  mode,
  owner,
  socket,
  executable,
  uid,
  canonicalPath,
}) {
  if (!exactKeys(sample, ["managedExecutable", "pidRecord", "socketOwners", "version"])) {
    refuse("daemon-attestation-invalid");
  }
  if (!exactKeys(sample.version, ["backend", "managedCodexPath", "socketPath", "status"])) {
    refuse("daemon-attestation-invalid");
  }
  const observedSocket = canonicalPathOrRefuse(
    sample.version.socketPath,
    canonicalPath,
    "daemon-socket-path-invalid",
  );
  if (sample.version.status !== "running" || observedSocket !== socket) {
    refuse("daemon-attestation-conflict");
  }
  const socketOwners = normalizedSocketOwners(sample.socketOwners);
  if (
    socketOwners.length !== 1
    || socketOwners[0].pid !== owner.pid
    || socketOwners[0].uid !== uid
  ) refuse("daemon-socket-ownership-conflict");

  let configuredManagedPath = null;
  if (mode === "managed") {
    if (sample.version.backend !== "pid") refuse("managed-daemon-attestation-missing");
    const managedPath = canonicalPathOrRefuse(
      sample.version.managedCodexPath,
      canonicalPath,
      "managed-executable-invalid",
    );
    if (managedPath !== executable.path) refuse("managed-executable-conflict");
    if (
      !exactKeys(sample.managedExecutable, ["dev", "ino", "path"])
      || canonicalPathOrRefuse(sample.managedExecutable.path, canonicalPath, "managed-executable-invalid") !== executable.path
      || sample.managedExecutable.dev !== executable.dev
      || sample.managedExecutable.ino !== executable.ino
    ) refuse("managed-executable-conflict");
    if (
      !exactKeys(sample.pidRecord, [
        "pid",
        "processStartTime",
        "regular",
        "state",
        "symlink",
        "uid",
      ])
      || sample.pidRecord.state !== "valid"
      || sample.pidRecord.regular !== true
      || sample.pidRecord.symlink !== false
      || sample.pidRecord.pid !== owner.pid
      || sample.pidRecord.uid !== uid
      || sample.pidRecord.processStartTime !== owner.startTime
    ) refuse("managed-pid-record-conflict");
  } else {
    if (sample.version.backend !== null) {
      refuse("unmanaged-daemon-attestation-conflict");
    }
    if (sample.version.managedCodexPath !== null) {
      configuredManagedPath = canonicalPathOrRefuse(
        sample.version.managedCodexPath,
        canonicalPath,
        "unmanaged-daemon-attestation-conflict",
      );
    }
    if (sample.managedExecutable !== null || !exactKeys(sample.pidRecord, ["state"])) {
      refuse("unmanaged-daemon-attestation-conflict");
    }
    if (sample.pidRecord.state !== "absent") refuse("unmanaged-daemon-attestation-conflict");
  }

  return {
    version: {
      status: "running",
      backend: sample.version.backend,
      socketPath: observedSocket,
      managedCodexPath: mode === "managed" ? executable.path : configuredManagedPath,
    },
    socketOwners,
    managedExecutable: mode === "managed"
      ? { path: executable.path, dev: executable.dev, ino: executable.ino }
      : null,
    pidRecord: mode === "managed"
      ? {
          state: "valid",
          uid,
          regular: true,
          symlink: false,
          pid: owner.pid,
          processStartTime: owner.startTime,
        }
      : { state: "absent" },
  };
}

function buildRecycleReceipt(snapshot, mode, socket, daemonEvidenceDigest, authorization, parent) {
  const core = {
    schema: RECYCLE_RECEIPT_SCHEMA,
    mode,
    socketPath: socket,
    daemonEvidenceDigest,
    minimumSoftNofile: authorization.minimumSoftNofile,
    attestor: authorization.attestor,
    launcher: authorization.launcher,
    replacementExecutable: authorization.replacementExecutable,
    oldNofileAttestation: authorization.oldNofileAttestation,
    launcherNofileAttestation: authorization.launcherNofileAttestation,
    server: snapshotIdentity(snapshot.owner, snapshot.owner.role),
    parent: parent ? snapshotIdentity(parent, parent.role) : null,
    targets: snapshot.targets.map((target) => snapshotIdentity(target, target.role)),
    selectedPids: [snapshot.owner.pid, ...snapshot.targets.map((target) => target.pid)]
      .sort((left, right) => left - right),
  };
  const confirmationToken = recycleConfirmationToken(core);
  return {
    ...core,
    digest: confirmationToken.slice(RECYCLE_CONFIRMATION_PREFIX.length),
    confirmationToken,
  };
}

function applicableParentOrRefuse(server, inventory, readIdentity, uid) {
  if (!Number.isInteger(server.parentPid) || server.parentPid <= 1) return null;
  const recorded = (inventory.processes ?? []).find((item) => item.pid === server.parentPid);
  if (!recorded) refuse("parent-evidence-unavailable");
  if (isGuiHost(recorded)) return null;
  if (recorded.executable !== server.executable) return null;
  let observation;
  try {
    observation = readIdentity(server.parentPid);
  } catch {
    refuse("parent-evidence-unavailable");
  }
  if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
    refuse("parent-evidence-unavailable");
  }
  const identity = observation.identity;
  if (identity.uid !== uid || identity.executable !== server.executable) return null;
  if (identityDifferences(
    recorded,
    identity,
    ["pid", "parentPid", "processGroupId", "startTime"],
  ).length) refuse("parent-evidence-changed");
  return snapshotIdentity(identity, "parent");
}

function assertExpectedIdentityGone(expected, readIdentity, survivorCode, unknownCode) {
  if (!expected) return;
  let observation;
  try {
    observation = readIdentity(expected.pid);
  } catch {
    refuse(unknownCode);
  }
  if (observation?.state === "absent") return;
  if (
    observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && !sameBirthIdentityPresent(expected, observation)
  ) return;
  refuse(observation?.state === "present" ? survivorCode : unknownCode);
}

function sameSignalIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(expected, observation.identity, REVALIDATED_IDENTITY_FIELDS).length === 0;
}

function sameBirthIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(expected, observation.identity, BIRTH_IDENTITY_FIELDS).length === 0;
}

function exactSnapshotIdentityPresent(expected, observation) {
  return observation?.state === "present"
    && validObservedIdentity(observation.identity)
    && identityDifferences(
      expected,
      observation.identity,
      ["pid", "parentPid", "processGroupId", "uid", "startTime", "executable"],
    ).length === 0;
}

function revalidateSnapshot(snapshot, readIdentity) {
  for (const expected of [snapshot.owner, ...snapshot.targets]) {
    let observation;
    try {
      observation = readIdentity(expected.pid);
    } catch {
      refuse("recycle-identity-unavailable");
    }
    if (!exactSnapshotIdentityPresent(expected, observation)) refuse("recycle-identity-changed");
  }
}

function validatePidNofileAttestation(attestation, identity, minimum = 1) {
  if (
    !exactKeys(attestation, ["pid", "processStartTime", "schema", "softNofile", "uid"])
    || attestation.schema !== PID_NOFILE_ATTESTATION_SCHEMA
    || attestation.pid !== identity.pid
    || attestation.uid !== identity.uid
    || attestation.processStartTime !== identity.startTime
    || !Number.isInteger(attestation.softNofile)
    || attestation.softNofile < minimum
  ) refuse("pid-nofile-attestation-invalid");
  return attestation.softNofile;
}

function validateLauncherNofileAttestation(attestation, launcher, replacementExecutable, minimum) {
  if (
    !exactKeys(attestation, ["dev", "ino", "path", "replacementExecutable", "schema", "softNofile"])
    || attestation.schema !== LAUNCHER_NOFILE_ATTESTATION_SCHEMA
    || attestation.path !== launcher.path
    || attestation.dev !== launcher.dev
    || attestation.ino !== launcher.ino
    || attestation.replacementExecutable !== replacementExecutable.path
    || !Number.isInteger(attestation.softNofile)
    || attestation.softNofile < minimum
  ) refuse("launcher-nofile-attestation-invalid");
  return attestation.softNofile;
}

function assertOldTreeGone(snapshot, readIdentity) {
  for (const expected of [snapshot.owner, ...snapshot.targets]) {
    assertExpectedIdentityGone(
      expected,
      readIdentity,
      "old-tree-survivor",
      "old-tree-verification-unknown",
    );
  }
}

function guiBaselinesOrRefuse(servers, readIdentity) {
  return servers.filter((server) => server.classification === "gui").map((server) => {
    let observation;
    try {
      observation = readIdentity(server.pid);
    } catch {
      refuse("gui-baseline-unavailable");
    }
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("gui-baseline-unavailable");
    }
    return observation.identity;
  });
}

function assertGuiPreserved(guiBaselines, readIdentity) {
  for (const expected of guiBaselines) {
    let observation;
    try {
      observation = readIdentity(expected.pid);
    } catch {
      refuse("gui-preservation-unverified");
    }
    if (!exactSnapshotIdentityPresent(expected, observation)) refuse("gui-preservation-failed");
  }
}

function auditProxySelection(inventory, server, socket, canonicalPath) {
  const linked = [];
  for (const proxy of (inventory.processes ?? [])
    .filter((record) => appServerCommandKind(record.rawCommand) === "proxy")
    .sort((left, right) => left.pid - right.pid)) {
    const evidence = proxySocketFor(inventory.proxySockets, proxy.pid);
    const association = proxySocketAssociation(evidence, inventory.controlSockets);
    if (!association) refuse("unclassified-proxy");
    const proxySocket = canonicalPathOrRefuse(association.path, canonicalPath, "unclassified-proxy");
    if (proxySocket === socket) {
      if (association.ownerPid !== server.pid) refuse("unclassified-proxy");
      linked.push(proxy.pid);
    }
  }
  const classified = (server.remoteProxyClients ?? []).map((proxy) => {
    if (proxy.commandIdentity !== "codex app-server proxy") refuse("unclassified-proxy");
    return proxy.pid;
  }).sort((left, right) => left - right);
  if (stableJson(linked) !== stableJson(classified)) refuse("proxy-selection-incomplete");
  return linked;
}

function defaultCanonicalPath(value, fsApi = fs) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("path-not-absolute");
  return (fsApi.realpathSync.native ?? fsApi.realpathSync)(value);
}

function sameFileStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function boundRegularFile(value, fsApi, { readContents = false, checkExecutable = false } = {}) {
  let descriptor = null;
  try {
    const canonical = defaultCanonicalPath(value, fsApi);
    const before = fsApi.lstatSync(canonical);
    if (before.isSymbolicLink() || !before.isFile()) return null;
    descriptor = fsApi.openSync(
      canonical,
      fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW,
    );
    const opened = fsApi.fstatSync(descriptor);
    if (!opened.isFile() || !sameFileStat(before, opened)) return null;
    const contents = readContents ? fsApi.readFileSync(descriptor) : null;
    let executable = false;
    if (checkExecutable) {
      try {
        fsApi.accessSync(canonical, fsApi.constants.X_OK);
        executable = true;
      } catch {}
    }
    const after = fsApi.fstatSync(descriptor);
    const named = fsApi.lstatSync(canonical);
    if (!sameFileStat(opened, after) || !sameFileStat(after, named)) return null;
    return {
      path: canonical,
      stat: after,
      contents,
      executable,
    };
  } catch {
    return null;
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

function defaultFileIdentity(value, fsApi = fs) {
  const bound = boundRegularFile(value, fsApi, { readContents: true, checkExecutable: true });
  if (!bound) return null;
  return {
    path: bound.path,
    dev: bound.stat.dev,
    ino: bound.stat.ino,
    mode: bound.stat.mode,
    nlink: bound.stat.nlink,
    mtimeMs: bound.stat.mtimeMs,
    size: bound.stat.size,
    digest: sha256(bound.contents),
    uid: bound.stat.uid,
    regular: true,
    symlink: false,
    executable: bound.executable,
  };
}

function defaultFileReference(value, fsApi = fs) {
  const bound = boundRegularFile(value, fsApi);
  return bound ? { path: bound.path, dev: bound.stat.dev, ino: bound.stat.ino } : null;
}

function parseBoundedJsonRun(run, code) {
  if (run?.status !== 0 || run.error || run.signal || typeof run.stdout !== "string") refuse(code);
  const raw = run.stdout.trim();
  if (!raw || Buffer.byteLength(raw) > MAX_ATTESTATION_BYTES) refuse(code);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) refuse(code);
    return parsed;
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    refuse(code);
  }
}

function runForJson(runner, file, args, code, options = {}) {
  let run;
  try {
    run = runner(file, args, options);
  } catch {
    refuse(code);
  }
  return parseBoundedJsonRun(run, code);
}

function normalizeRecordedStartTime(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
}

function readNativePidRecord({ fsApi, codexHome, uid }) {
  const file = path.join(codexHome, "app-server-daemon", "app-server.pid");
  let before;
  try {
    before = fsApi.lstatSync(file);
  } catch (error) {
    return error?.code === "ENOENT" ? { state: "absent" } : { state: "invalid" };
  }
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || before.uid !== uid
    || before.nlink !== 1
    || (before.mode & 0o022) !== 0
    || before.size <= 0
    || before.size > MAX_PID_RECORD_BYTES
  ) return { state: "invalid" };

  let descriptor = null;
  try {
    descriptor = fsApi.openSync(file, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
    const opened = fsApi.fstatSync(descriptor);
    if (
      !opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.uid !== uid
      || opened.nlink !== 1
      || (opened.mode & 0o022) !== 0
      || opened.size <= 0
      || opened.size > MAX_PID_RECORD_BYTES
    ) return { state: "invalid" };
    const parsed = JSON.parse(fsApi.readFileSync(descriptor, "utf8"));
    const processStartTime = normalizeRecordedStartTime(parsed?.processStartTime);
    if (
      !exactKeys(parsed, ["pid", "processStartTime"])
      || !Number.isInteger(parsed.pid)
      || parsed.pid <= 0
      || !processStartTime
    ) return { state: "invalid" };
    return {
      state: "valid",
      uid,
      regular: true,
      symlink: false,
      pid: parsed.pid,
      processStartTime,
    };
  } catch {
    return { state: "invalid" };
  } finally {
    if (descriptor !== null) {
      try { fsApi.closeSync(descriptor); } catch {}
    }
  }
}

function nativeDaemonVersion(runner, executable) {
  const parsed = runForJson(
    runner,
    executable,
    ["app-server", "daemon", "version"],
    "daemon-version-unavailable",
  );
  if (
    parsed.status !== "running"
    || !Object.hasOwn(parsed, "backend")
    || (parsed.backend !== null && parsed.backend !== "pid")
    || typeof parsed.managedCodexPath !== "string"
    || typeof parsed.socketPath !== "string"
  ) refuse("daemon-version-invalid");
  return {
    status: parsed.status,
    backend: parsed.backend,
    managedCodexPath: parsed.managedCodexPath,
    socketPath: parsed.socketPath,
  };
}

function socketOwnersForPath(socket, { runner, readIdentity, canonicalPath, ownerPid }) {
  const run = safeRun(runner, LSOF, ["-nP", "-U", "-Fpcfn"]);
  if (run.status !== 0) refuse("daemon-socket-ownership-unavailable");
  const owners = [];
  for (const item of parseControlSockets(run.stdout)) {
    let observedPath;
    try {
      observedPath = canonicalPath(item.path);
    } catch {
      if (path.resolve(item.path) === path.resolve(socket)) {
        refuse("daemon-socket-ownership-ambiguous");
      }
      continue;
    }
    if (observedPath !== socket) continue;
    if (item.ownerPid !== ownerPid) {
      const command = safeRun(runner, PS, ["-p", String(item.ownerPid), "-o", "command="]);
      if (command.status !== 0 || appServerCommandKind(command.stdout.trim()) !== "proxy") {
        owners.push({ pid: item.ownerPid, uid: -1 });
      }
      continue;
    }
    const observation = readIdentity(item.ownerPid, { runner });
    if (observation?.state !== "present" || !validObservedIdentity(observation.identity)) {
      refuse("daemon-socket-ownership-unavailable");
    }
    owners.push({ pid: item.ownerPid, uid: observation.identity.uid });
  }
  return [...new Map(owners.map((owner) => [`${owner.pid}:${owner.uid}`, owner])).values()];
}

function exactTreeSignalOrder(snapshot) {
  const byPid = new Map(snapshot.targets.map((target) => [target.pid, target]));
  const depths = new Map();
  for (const target of snapshot.targets) {
    if (target.role !== "descendant") {
      depths.set(target.pid, 0);
      continue;
    }
    const chain = [];
    let current = target;
    while (current?.role === "descendant" && !depths.has(current.pid)) {
      chain.push(current);
      const parent = byPid.get(current.parentPid);
      if (!parent) break;
      current = parent;
    }
    let depth = depths.has(current?.pid) ? depths.get(current.pid) + 1 : 0;
    while (chain.length) {
      const item = chain.pop();
      depths.set(item.pid, depth);
      depth += 1;
    }
  }
  return [
    ...snapshot.targets.slice().sort((left, right) => (
      depths.get(right.pid) - depths.get(left.pid) || right.pid - left.pid
    )),
    snapshot.owner,
  ];
}

function stopExactUnmanagedTree(snapshot, {
  readIdentity,
  signalProcess,
  sleep,
  graceMs,
  postSignalMs,
}) {
  const ordered = exactTreeSignalOrder(snapshot);
  let mutationAttempted = false;
  const outcome = (exitCode, failureCode = null) => ({ exitCode, mutationAttempted, failureCode });
  try {
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (!exactSnapshotIdentityPresent(expected, observation)) {
        return outcome(EXIT_CODES.refused, "unmanaged-identity-changed");
      }
      try {
        signalProcess(expected.pid, "SIGTERM");
        mutationAttempted = true;
      } catch (error) {
        if (error?.code !== "ESRCH") return outcome(EXIT_CODES.failed, "unmanaged-term-failed");
      }
    }
    sleep(graceMs);
    const killed = [];
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (
        observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !sameBirthIdentityPresent(expected, observation)
      ) continue;
      if (!sameSignalIdentityPresent(expected, observation)) {
        return outcome(EXIT_CODES.failed, "unmanaged-post-term-identity-unverified");
      }
      try {
        signalProcess(expected.pid, "SIGKILL");
        mutationAttempted = true;
        killed.push(expected);
      } catch (error) {
        if (error?.code !== "ESRCH") return outcome(EXIT_CODES.failed, "unmanaged-kill-failed");
      }
    }
    if (killed.length) sleep(postSignalMs);
    for (const expected of ordered) {
      const observation = readIdentity(expected.pid);
      if (observation?.state === "absent") continue;
      if (
        observation?.state === "present"
        && validObservedIdentity(observation.identity)
        && !sameBirthIdentityPresent(expected, observation)
      ) continue;
      return outcome(EXIT_CODES.failed, "unmanaged-survivor");
    }
    return outcome(EXIT_CODES.healthy);
  } catch {
    return outcome(
      mutationAttempted ? EXIT_CODES.failed : EXIT_CODES.refused,
      mutationAttempted ? "unmanaged-stop-evidence-failed" : "unmanaged-preflight-evidence-failed",
    );
  }
}

function directChildCount(pid, runner) {
  const run = safeRun(runner, PGREP, ["-P", String(pid)]);
  if (run.status === 1 && !run.stdout.trim()) return 0;
  if (run.status !== 0) return null;
  const values = run.stdout.split(/\r?\n/).filter(Boolean);
  return values.every((value) => /^\d+$/.test(value) && Number(value) > 0)
    ? new Set(values).size
    : null;
}

function descriptorMetrics(pid, runner) {
  const run = safeRun(runner, LSOF, ["-nP", "-a", "-p", String(pid), "-Ff"]);
  return run.status === 0 ? parseDescriptors(run.stdout) : { complete: false };
}

function strictLauncherPath({ explicit, env, fsApi }) {
  if (explicit) return explicit;
  if (env.RAILYARD_CODEX_BIN) return env.RAILYARD_CODEX_BIN;
  const candidates = [];
  for (const directory of String(env.PATH ?? "").split(path.delimiter)) {
    if (path.isAbsolute(directory)) candidates.push(path.join(directory, "codex"));
  }
  candidates.push(path.join(os.homedir(), ".local", "bin", "codex"));
  for (const candidate of unique(candidates)) {
    try {
      fsApi.accessSync(candidate, fsApi.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function createDefaultRecycleDependencies({
  inventory,
  runner = defaultRunner,
  fsApi = fs,
  env = process.env,
  uid = callerUid(),
  readIdentity = null,
  signalProcess = signalExactPid,
  sleep = sleepSync,
  graceMs = DEFAULT_GRACE_MS,
  postSignalMs = DEFAULT_POST_SIGNAL_MS,
  readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  readyPollMs = DEFAULT_READY_POLL_MS,
  monotonicNow = () => performance.now(),
  lock = createMutationLock({ fsApi, uid }),
  spawnProcess = spawn,
} = {}) {
  const codexHome = path.resolve(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  readIdentity ??= (pid, { runner: identityRunner = runner } = {}) => (
    collectExactProcessIdentity(pid, { runner: identityRunner })
  );
  const canonicalPath = (value) => defaultCanonicalPath(value, fsApi);
  const fileIdentity = (value) => defaultFileIdentity(value, fsApi);
  const fileReference = (value) => defaultFileReference(value, fsApi);
  return {
    inventory,
    collectInventory() {
      return collectMacOSInventory({ runner, platform: "darwin" });
    },
    readIdentity,
    canonicalPath,
    fileIdentity,
    sampleDaemonEvidence({ socket, executable, ownerPid }) {
      const version = nativeDaemonVersion(runner, executable.path);
      const canonicalSocket = canonicalPath(version.socketPath);
      const managedPath = canonicalPath(version.managedCodexPath);
      let managedExecutable = null;
      if (version.backend === "pid") {
        managedExecutable = fileReference(managedPath);
      }
      return {
        version: {
          status: version.status,
          backend: version.backend,
          socketPath: canonicalSocket,
          managedCodexPath: managedPath,
        },
        socketOwners: socketOwnersForPath(socket, {
          runner,
          readIdentity,
          canonicalPath,
          ownerPid,
        }),
        managedExecutable,
        pidRecord: readNativePidRecord({ fsApi, codexHome, uid }),
      };
    },
    attestNofile(identity, { attestorPath }) {
      return runForJson(
        runner,
        attestorPath,
        ["--pid", String(identity.pid), "--json"],
        "pid-nofile-attestation-unavailable",
      );
    },
    attestLauncher(launcher, { attestorPath }) {
      return runForJson(
        runner,
        attestorPath,
        ["--launcher", launcher.path, "--json"],
        "launcher-nofile-attestation-unavailable",
      );
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
    stopUnmanaged(snapshot) {
      return stopExactUnmanagedTree(snapshot, {
        readIdentity,
        signalProcess,
        sleep,
        graceMs,
        postSignalMs,
      });
    },
    launchUnmanaged({ launcher, socketPath }) {
      try {
        const child = spawnProcess(
          launcher,
          ["app-server", "--listen", `unix://${socketPath}`],
          { detached: true, stdio: "ignore", shell: false },
        );
        child.once("error", () => {});
        child.unref();
        return { pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null };
      } catch {
        return { pid: null };
      }
    },
    waitForReady({ pid, socketPath, mode, executable }) {
      const deadline = monotonicNow() + readyTimeoutMs;
      const remainingTime = () => Math.floor(deadline - monotonicNow());
      const boundedRunner = (file, args) => {
        const timeout = remainingTime();
        return timeout > 0
          ? runner(file, args, { timeout })
          : { status: null, stdout: "", stderr: "", error: true };
      };
      let lastFailureCode = "replacement-readiness-timeout";
      do {
        try {
          const identity = readIdentity(pid, { runner: boundedRunner });
          if (
            identity?.state !== "present"
            || !validObservedIdentity(identity.identity)
            || identity.identity.pid !== pid
          ) {
            lastFailureCode = "replacement-identity-not-ready";
          } else {
            const version = nativeDaemonVersion(boundedRunner, executable);
            let failureCode = null;
            if (canonicalPath(version.socketPath) !== socketPath) {
              failureCode = "replacement-socket-path-mismatch";
            } else if (!((mode === "managed" && version.backend === "pid")
              || (mode === "unmanaged" && version.backend === null))) {
              failureCode = "replacement-daemon-mode-mismatch";
            }
            let owners;
            if (!failureCode) {
              owners = socketOwnersForPath(socketPath, {
                runner: boundedRunner,
                readIdentity,
                canonicalPath,
                ownerPid: pid,
              });
              if (owners.length !== 1 || owners[0].pid !== pid || owners[0].uid !== uid) {
                failureCode = "replacement-socket-ownership-mismatch";
              }
            }
            const descriptors = failureCode ? null : descriptorMetrics(pid, boundedRunner);
            if (!failureCode && !descriptors.complete) {
              failureCode = "replacement-descriptors-unavailable";
            }
            const directChildren = failureCode ? null : directChildCount(pid, boundedRunner);
            if (!failureCode && !Number.isInteger(directChildren)) {
              failureCode = "replacement-child-baseline-unavailable";
            }
            if (!failureCode) {
              return {
                identity: identity.identity,
                socket: { path: socketPath, ready: true, owners },
                descriptors: { count: descriptors.count, highest: descriptors.highest },
                directChildren,
              };
            }
            lastFailureCode = failureCode;
          }
        } catch (error) {
          lastFailureCode = safeFailureCode(
            error?.code,
            "replacement-readiness-evidence-unavailable",
          );
        }
        const remaining = remainingTime();
        if (remaining <= 0) break;
        sleep(Math.min(readyPollMs, remaining));
      } while (true);
      return { failureCode: lastFailureCode };
    },
    lock,
  };
}

export function recycleServer(options, deps) {
  const platform = options?.platform ?? process.platform;
  const uid = options?.uid ?? callerUid();
  const result = emptyRecycleResult(platform);
  let exitCode = EXIT_CODES.refused;
  let release = null;

  try {
    if (platform !== "darwin") refuse("unsupported-platform");
    if (!Number.isInteger(options?.pid) || options.pid <= 0) refuse("recycle-pid-required");
    if (!Number.isInteger(options?.minSoftLimit) || options.minSoftLimit <= 0) {
      refuse("invalid-minimum-soft-limit");
    }
    if (!deps?.inventory || typeof deps.readIdentity !== "function") refuse("recycle-evidence-unavailable");
    if (
      typeof deps.canonicalPath !== "function"
      || typeof deps.fileIdentity !== "function"
      || typeof deps.sampleDaemonEvidence !== "function"
    ) refuse("recycle-evidence-unavailable");

    const classified = classifyInventory(deps.inventory, { now: options.now ?? Date.now() });
    result.verification.servers = classified.result.verification.servers;
    result.verification.controlSockets = classified.result.verification.controlSockets;
    if (
      !classified.result.verification.complete
      || classified.result.verification.missingEvidence.length
    ) refuse("inventory-incomplete");
    const server = classified.result.verification.servers.find((candidate) => candidate.pid === options.pid);
    if (!server) refuse("selected-pid-not-app-server");
    if (server.classification === "gui") refuse("selected-server-is-gui");
    if (server.classification !== "detached" || server.missingEvidence.length) {
      refuse("selected-server-ambiguous");
    }
    if (server.uid !== uid) refuse("selected-server-wrong-user");
    if (server.controlSocket.state !== "owned" || server.controlSocket.ownerPid !== server.pid) {
      refuse("selected-socket-ambiguous");
    }
    const socket = canonicalPathOrRefuse(
      server.controlSocket.path,
      deps.canonicalPath,
      "selected-socket-ambiguous",
    );
    auditProxySelection(deps.inventory, server, socket, deps.canonicalPath);

    const narrowedInspection = {
      selected: [{ pid: server.pid }],
      verification: { servers: classified.result.verification.servers },
    };
    const snapshot = buildExactTreeSnapshot({
      inventory: deps.inventory,
      inspection: narrowedInspection,
      readIdentity: deps.readIdentity,
      now: options.now ?? Date.now(),
      uid,
    });
    const guiBaselines = guiBaselinesOrRefuse(
      classified.result.verification.servers,
      deps.readIdentity,
    );
    const parent = applicableParentOrRefuse(server, deps.inventory, deps.readIdentity, uid);
    const executable = executableEvidenceOrRefuse(snapshot.owner.executable, {
      canonicalPath: deps.canonicalPath,
      fileIdentity: deps.fileIdentity,
      uid,
      code: "selected-executable-invalid",
      requireOwner: true,
    });
    if (executable.path !== snapshot.owner.executable) refuse("selected-executable-noncanonical");

    const mode = options.unmanaged === true ? "unmanaged" : "managed";
    result.verification.mode = mode;
    const takeDaemonSample = (owner = snapshot.owner, sampleExecutable = executable) => normalizeDaemonSample(
      deps.sampleDaemonEvidence({ socket, executable: sampleExecutable, ownerPid: owner.pid }),
      {
        mode,
        owner,
        socket,
        executable: sampleExecutable,
        uid,
        canonicalPath: deps.canonicalPath,
      },
    );
    const firstSample = takeDaemonSample();
    const secondSample = takeDaemonSample();
    if (stableJson(firstSample) !== stableJson(secondSample)) refuse("daemon-attestation-unstable");

    if (!options.attestorPath) refuse("nofile-attestor-required");
    const attestor = executableEvidenceOrRefuse(options.attestorPath, {
      canonicalPath: deps.canonicalPath,
      fileIdentity: deps.fileIdentity,
      uid,
      code: "nofile-attestor-invalid",
      requireOwner: true,
    });
    if (typeof deps.attestNofile !== "function") refuse("nofile-attestor-unavailable");

    let launcher = null;
    let launcherNofileAttestation = null;
    let replacementExecutable = executable;
    if (mode === "unmanaged") {
      if (!options.launcher) refuse("unmanaged-launcher-required");
      launcher = executableEvidenceOrRefuse(options.launcher, {
        canonicalPath: deps.canonicalPath,
        fileIdentity: deps.fileIdentity,
        uid,
        code: "unmanaged-launcher-invalid",
        requireOwner: true,
      });
      if (typeof deps.attestLauncher !== "function") refuse("launcher-attestor-unavailable");
      launcherNofileAttestation = deps.attestLauncher(launcher, {
        attestorPath: attestor.path,
      });
      revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      replacementExecutable = executableEvidenceOrRefuse(
        launcherNofileAttestation?.replacementExecutable,
        {
          canonicalPath: deps.canonicalPath,
          fileIdentity: deps.fileIdentity,
          uid,
          code: "replacement-executable-invalid",
          requireOwner: true,
        },
      );
      validateLauncherNofileAttestation(
        launcherNofileAttestation,
        launcher,
        replacementExecutable,
        options.minSoftLimit,
      );
    }

    const initialOwner = deps.readIdentity(snapshot.owner.pid);
    if (!exactSnapshotIdentityPresent(snapshot.owner, initialOwner)) refuse("recycle-identity-changed");
    const oldNofileAttestation = deps.attestNofile(initialOwner.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    validatePidNofileAttestation(oldNofileAttestation, initialOwner.identity, 1);

    const daemonEvidenceDigest = sha256(stableJson(secondSample));
    const authorization = {
      minimumSoftNofile: options.minSoftLimit,
      attestor,
      launcher,
      replacementExecutable,
      oldNofileAttestation,
      launcherNofileAttestation,
    };
    const receipt = buildRecycleReceipt(
      snapshot,
      mode,
      socket,
      daemonEvidenceDigest,
      authorization,
      parent,
    );
    result.verification.receipt = receipt;
    result.verification.before = {
      pid: snapshot.owner.pid,
      identity: receipt.server,
      parent: receipt.parent,
      socket: { path: socket, ownerPid: snapshot.owner.pid },
      targetPids: snapshot.targets.map((target) => target.pid),
      daemonEvidenceDigest,
      softNofile: oldNofileAttestation.softNofile,
    };
    const selectedRoles = new Map([
      [snapshot.owner.pid, "server"],
      ...snapshot.targets.map((target) => [target.pid, target.role]),
    ]);
    result.selected = receipt.selectedPids.map((pid) => ({
      pid,
      role: selectedRoles.get(pid) ?? "target",
    }));
    if (mode === "managed" && typeof deps.restartManagedExact !== "function") {
      refuse("managed-restart-exact-pid-unsupported");
    }
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
    revalidateExecutableEvidence(executable, deps, uid, "selected-executable-changed");
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    if (launcher) revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
    if (replacementExecutable !== executable) {
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
    }

    const finalSample = takeDaemonSample();
    if (stableJson(secondSample) !== stableJson(finalSample)) refuse("daemon-attestation-unstable");
    revalidateSnapshot(snapshot, deps.readIdentity);
    if (parent && !exactSnapshotIdentityPresent(parent, deps.readIdentity(parent.pid))) {
      refuse("parent-evidence-changed");
    }
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    const freshOwner = deps.readIdentity(snapshot.owner.pid);
    if (!exactSnapshotIdentityPresent(snapshot.owner, freshOwner)) refuse("recycle-identity-changed");
    const lockedOldNofileAttestation = deps.attestNofile(freshOwner.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const oldSoftNofile = validatePidNofileAttestation(
      lockedOldNofileAttestation,
      freshOwner.identity,
      1,
    );
    if (stableJson(lockedOldNofileAttestation) !== stableJson(oldNofileAttestation)) {
      refuse("pid-nofile-attestation-changed");
    }
    if (launcher) {
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      const lockedLauncherNofileAttestation = deps.attestLauncher(launcher, {
        attestorPath: attestor.path,
      });
      revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      validateLauncherNofileAttestation(
        lockedLauncherNofileAttestation,
        launcher,
        replacementExecutable,
        options.minSoftLimit,
      );
      if (stableJson(lockedLauncherNofileAttestation) !== stableJson(launcherNofileAttestation)) {
        refuse("launcher-nofile-attestation-changed");
      }
    }
    result.verification.before.softNofile = oldSoftNofile;

    if (typeof deps.collectInventory !== "function") refuse("proxy-recheck-unavailable");
    const lockedInventory = deps.collectInventory();
    const lockedClassified = classifyInventory(lockedInventory, { now: options.now ?? Date.now() });
    if (
      !lockedClassified.result.verification.complete
      || lockedClassified.result.verification.missingEvidence.length
    ) refuse("inventory-recheck-incomplete");
    const lockedServer = lockedClassified.result.verification.servers.find((item) => item.pid === snapshot.owner.pid);
    if (!lockedServer || lockedServer.classification !== "detached") {
      refuse("selected-server-recheck-incomplete");
    }
    const lockedProxyPids = auditProxySelection(
      lockedInventory,
      lockedServer,
      socket,
      deps.canonicalPath,
    );
    const confirmedProxyPids = snapshot.targets
      .filter((target) => target.role === "proxy")
      .map((target) => target.pid)
      .sort((left, right) => left - right);
    if (stableJson(lockedProxyPids) !== stableJson(confirmedProxyPids)) refuse("proxy-set-changed");
    const lockedChildren = childrenByParent(lockedInventory.processes ?? []);
    const lockedTargetPids = unique([
      ...descendantsOf(snapshot.owner.pid, lockedChildren).descendants.map((item) => item.pid),
      ...lockedProxyPids,
    ]).filter((pid) => pid !== snapshot.owner.pid).sort((left, right) => left - right);
    const confirmedTargetPids = snapshot.targets
      .map((target) => target.pid)
      .sort((left, right) => left - right);
    if (stableJson(lockedTargetPids) !== stableJson(confirmedTargetPids)) refuse("exact-tree-changed");

    revalidateSnapshot(snapshot, deps.readIdentity);
    if (parent && !exactSnapshotIdentityPresent(parent, deps.readIdentity(parent.pid))) {
      refuse("parent-evidence-changed");
    }
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    const mutationSample = takeDaemonSample();
    if (stableJson(secondSample) !== stableJson(mutationSample)) refuse("daemon-attestation-unstable");

    let replacementPid;
    if (mode === "managed") {
      if (typeof deps.reapResidue !== "function") refuse("residue-reaper-unavailable");
      revalidateExecutableEvidence(executable, deps, uid, "selected-executable-changed");
      result.verification.mutationAttempted = true;
      let restarted;
      try {
        restarted = deps.restartManagedExact({
          executable: executable.path,
          expectedIdentity: receipt.server,
          socketPath: socket,
        });
      } catch {
        refuse("managed-restart-failed");
      }
      if (
        !restarted
        || restarted.status !== "restarted"
        || restarted.backend !== "pid"
        || !Number.isInteger(restarted.pid)
        || restarted.pid <= 0
        || restarted.pid === snapshot.owner.pid
        || canonicalPathOrRefuse(restarted.socketPath, deps.canonicalPath, "managed-restart-invalid") !== socket
      ) refuse("managed-restart-invalid");
      replacementPid = restarted.pid;
      result.verification.actions.push({ kind: "native-daemon-restart", oldPid: snapshot.owner.pid, newPid: replacementPid });
      const residue = deps.reapResidue(snapshot);
      if (residue?.exitCode !== EXIT_CODES.healthy) {
        refuse(safeFailureCode(
          residue?.result?.verification?.missingEvidence?.[0],
          "residue-reap-incomplete",
        ));
      }
      result.verification.actions.push({
        kind: "reap-exact-residue",
        pids: snapshot.targets.map((target) => target.pid),
      });
    } else {
      if (typeof deps.stopUnmanaged !== "function" || typeof deps.launchUnmanaged !== "function") {
        refuse("unmanaged-lifecycle-unavailable");
      }
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
      const stopped = deps.stopUnmanaged(snapshot);
      result.verification.mutationAttempted = stopped?.mutationAttempted === true;
      if (stopped?.exitCode !== EXIT_CODES.healthy) {
        refuse(safeFailureCode(stopped?.failureCode, "unmanaged-stop-incomplete"));
      }
      result.verification.actions.push({
        kind: "stop-exact-unmanaged-tree",
        pids: receipt.selectedPids,
      });
      revalidateExecutableEvidence(launcher, deps, uid, "unmanaged-launcher-changed");
      revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
      result.verification.mutationAttempted = true;
      const launched = deps.launchUnmanaged({ launcher: launcher.path, socketPath: socket });
      if (!Number.isInteger(launched?.pid) || launched.pid <= 0 || launched.pid === snapshot.owner.pid) {
        refuse("unmanaged-launch-invalid");
      }
      replacementPid = launched.pid;
      result.verification.actions.push({ kind: "launch-selected-wrapper", pid: replacementPid, launcher: launcher.path });
    }

    if (typeof deps.waitForReady !== "function") refuse("readiness-verifier-unavailable");
    const ready = deps.waitForReady({
      pid: replacementPid,
      socketPath: socket,
      mode,
      executable: replacementExecutable.path,
    });
    if (!ready) refuse("replacement-readiness-timeout");
    if (ready.failureCode) {
      refuse(safeFailureCode(ready.failureCode, "replacement-readiness-timeout"));
    }
    if (
      !validObservedIdentity(ready.identity)
      || ready.identity.pid !== replacementPid
      || ready.identity.uid !== uid
      || ready.identity.executable !== replacementExecutable.path
    ) refuse("replacement-identity-invalid");
    const freshReplacement = deps.readIdentity(replacementPid);
    if (!exactSnapshotIdentityPresent(ready.identity, freshReplacement)) {
      refuse("replacement-identity-changed");
    }
    revalidateExecutableEvidence(replacementExecutable, deps, uid, "replacement-executable-changed");
    takeDaemonSample(freshReplacement.identity, replacementExecutable);
    const readySocket = canonicalPathOrRefuse(ready.socket?.path, deps.canonicalPath, "replacement-socket-invalid");
    const readyOwners = normalizedSocketOwners(ready.socket?.owners);
    if (
      ready.socket?.ready !== true
      || readySocket !== socket
      || readyOwners.length !== 1
      || readyOwners[0].pid !== replacementPid
      || readyOwners[0].uid !== uid
    ) refuse("replacement-socket-invalid");
    if (
      !exactKeys(ready.descriptors, ["count", "highest"])
      || !Number.isInteger(ready.descriptors.count)
      || ready.descriptors.count < 0
      || (ready.descriptors.highest !== null
        && (!Number.isInteger(ready.descriptors.highest) || ready.descriptors.highest < 0))
      || !Number.isInteger(ready.directChildren)
      || ready.directChildren < 0
    ) refuse("replacement-metrics-invalid");
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const replacementNofileAttestation = deps.attestNofile(freshReplacement.identity, {
      attestorPath: attestor.path,
    });
    revalidateExecutableEvidence(attestor, deps, uid, "nofile-attestor-changed");
    const replacementSoftNofile = validatePidNofileAttestation(
      replacementNofileAttestation,
      freshReplacement.identity,
      options.minSoftLimit,
    );
    assertOldTreeGone(snapshot, deps.readIdentity);
    assertExpectedIdentityGone(
      parent,
      deps.readIdentity,
      "old-parent-survivor",
      "old-parent-verification-unknown",
    );
    assertGuiPreserved(guiBaselines, deps.readIdentity);

    result.verification.after = {
      pid: replacementPid,
      identity: snapshotIdentity(freshReplacement.identity, "server"),
      socket: { path: readySocket, ownerPid: replacementPid, ready: true },
      softNofile: replacementSoftNofile,
      descriptors: { count: ready.descriptors.count, highest: ready.descriptors.highest },
      directChildren: ready.directChildren,
      oldTreeGone: true,
      oldParent: parent ? { pid: parent.pid, gone: true } : { applicable: false },
    };
    result.verification.guiPreserved = true;
    result.verification.complete = true;
    result.status = "healthy";
    exitCode = EXIT_CODES.healthy;
  } catch (error) {
    const code = error instanceof CleanupRefusal ? error.code : "recycle-evidence-failed";
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
        if (result.verification.mutationAttempted) {
          result.status = "failed";
          exitCode = EXIT_CODES.failed;
        } else {
          result.status = "refused";
          exitCode = EXIT_CODES.refused;
        }
      }
    }
  }
  result.verification.missingEvidence = unique(result.verification.missingEvidence);
  return { result, exitCode };
}

function hookAncestor(startPid, runner) {
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

function hookStateDirectory(env) {
  if (env.XDG_STATE_HOME) {
    if (!path.isAbsolute(env.XDG_STATE_HOME)) throw new Error("hook-state-path-invalid");
    return path.join(env.XDG_STATE_HOME, "railyard", "cleanup-codex");
  }
  const home = env.HOME || os.homedir();
  if (!path.isAbsolute(home)) throw new Error("hook-state-path-invalid");
  return path.join(home, "Library", "Application Support", "railyard", "cleanup-codex");
}

function hookReceiptFilename(appServer) {
  const identityDigest = sha256(stableJson(appServer)).slice(0, 24);
  return `${appServer.pid}-${identityDigest}.json`;
}

function readHookReceiptSecure(file, { fsApi, uid }) {
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

function writeLatestHookReceipt(receipt, { fsApi, env, uid }) {
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

function hookThreadMarker(expandedCommand, plainCommand) {
  if (!expandedCommand.startsWith(plainCommand)) return { kind: "invalid" };
  const suffix = expandedCommand.slice(plainCommand.length);
  if (suffix && !/^\s/.test(suffix)) return { kind: "invalid" };
  const matches = [...suffix.matchAll(/(?:^|\s)CODEX_THREAD_ID=([^\s]+)(?=\s|$)/g)];
  if (!matches.length) return { kind: "absent" };
  if (matches.length !== 1 || !UUID_PATTERN.test(matches[0][1])) return { kind: "invalid" };
  return { kind: "present", threadId: matches[0][1].toLowerCase() };
}

function hookUnsafeCommand(command) {
  return appServerCommandKind(command) !== null
    || proxyCommandIdentity(command) !== null
    || /(?:^|\s)app-server\s+daemon(?:\s|$)/i.test(command)
    || /(?:^|\/)codex-app-server(?:\s|$)/i.test(command);
}

function hookAncestorSets(processes, selfPid, parentPid) {
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

function hookSignalOrder(targets) {
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

function hookExecutableMap(pids, runner) {
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

function collectHookTargets(sessionId, {
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
    return { status: "unavailable", receipt: null, receiptPath: null };
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
    const first = collectHookTargets(sessionId, {
      runner: boundedRunner,
      uid,
      selfPid,
      parentPid,
      appServer: identity,
    });
    cleanup.skippedGroups = first.skippedGroups;
    if (!first.complete) refuse(first.reason);

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

    const second = collectHookTargets(sessionId, {
      runner: boundedRunner,
      uid,
      selfPid,
      parentPid,
      appServer: identity,
    });
    if (!second.complete) refuse(second.reason);
    const firstByPid = new Map(first.targets.map((target) => [target.pid, target]));
    const observedTargets = second.targets.filter((target) => {
      const before = firstByPid.get(target.pid);
      return before && identityDifferences(before, target, [
        "pid", "parentPid", "processGroupId", "uid", "startTime",
      ]).length === 0;
    });
    if (observedTargets.length !== second.targets.length) {
      refuse("hook-targets-changed");
    }
    const secondPids = new Set(second.targets.map((target) => target.pid));
    cleanup.verifiedPids.push(...first.targets
      .filter((target) => !secondPids.has(target.pid))
      .map((target) => target.pid));
    const executables = hookExecutableMap(observedTargets.map((target) => target.pid), boundedRunner);
    if (!executables) refuse("hook-target-identity-unavailable");
    const third = collectHookTargets(sessionId, {
      runner: boundedRunner,
      uid,
      selfPid,
      parentPid,
      appServer: identity,
    });
    if (!third.complete) refuse(third.reason);
    const secondByPid = new Map(observedTargets.map((target) => [target.pid, target]));
    const targets = third.targets.flatMap((target) => {
      const before = secondByPid.get(target.pid);
      const executable = executables.get(target.pid);
      if (!before || !executable || identityDifferences(before, target, [
        "pid", "parentPid", "processGroupId", "uid", "startTime", "rawCommand",
      ]).length) return [];
      return [{ ...target, executable }];
    });
    if (targets.length !== third.targets.length) refuse("hook-targets-changed");
    const thirdPids = new Set(third.targets.map((target) => target.pid));
    cleanup.verifiedPids.push(...observedTargets
      .filter((target) => !thirdPids.has(target.pid))
      .map((target) => target.pid));
    cleanup.selectedPids = targets.map((target) => target.pid);

    const termTargets = [];
    for (const target of hookSignalOrder(targets)) {
      try {
        mutationAttempted = true;
        signalProcess(target.pid, "SIGTERM");
        cleanup.termPids.push(target.pid);
        termTargets.push(target);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
        cleanup.verifiedPids.push(target.pid);
      }
    }
    if (termTargets.length) sleep(Math.min(HOOK_GRACE_MS, Math.max(0, deadline - monotonicNow() - 100)));
    const killTargets = [];
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
      try {
        signalProcess(target.pid, "SIGKILL");
        cleanup.killPids.push(target.pid);
        killTargets.push(target);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
        cleanup.verifiedPids.push(target.pid);
      }
    }
    if (killTargets.length) sleep(Math.min(HOOK_POST_SIGNAL_MS, Math.max(0, deadline - monotonicNow() - 25)));
    for (const target of killTargets) {
      const current = readIdentity(target.pid, { runner: boundedRunner });
      if (current?.state === "absent") {
        cleanup.verifiedPids.push(target.pid);
      } else if (current?.state === "present" && validObservedIdentity(current.identity)) {
        if (!sameBirthIdentityPresent(target, current)) cleanup.verifiedPids.push(target.pid);
        else missingEvidence.push("post-kill-survivor");
      } else {
        missingEvidence.push("post-kill-verification-unknown");
      }
    }
    const late = collectHookTargets(sessionId, {
      runner: boundedRunner,
      uid,
      selfPid,
      parentPid,
      appServer: identity,
    });
    if (!late.complete) refuse(late.reason);
    if (late.targets.length) {
      const lateExecutables = hookExecutableMap(late.targets.map((target) => target.pid), boundedRunner);
      if (!lateExecutables) refuse("hook-late-target-identity-unavailable");
      const confirmation = collectHookTargets(sessionId, {
        runner: boundedRunner,
        uid,
        selfPid,
        parentPid,
        appServer: identity,
      });
      if (!confirmation.complete) refuse(confirmation.reason);
      const lateByPid = new Map(late.targets.map((target) => [target.pid, target]));
      const lateTargets = confirmation.targets.flatMap((target) => {
        const before = lateByPid.get(target.pid);
        const executable = lateExecutables.get(target.pid);
        if (!before || !executable || identityDifferences(before, target, [
          "pid", "parentPid", "processGroupId", "uid", "startTime", "rawCommand",
        ]).length) return [];
        return [{ ...target, executable }];
      });
      if (lateTargets.length !== confirmation.targets.length) refuse("hook-late-targets-changed");
      cleanup.selectedPids.push(...lateTargets.map((target) => target.pid));
      const lateKilled = [];
      for (const target of hookSignalOrder(lateTargets)) {
        try {
          mutationAttempted = true;
          signalProcess(target.pid, "SIGKILL");
          cleanup.killPids.push(target.pid);
          lateKilled.push(target);
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
          cleanup.verifiedPids.push(target.pid);
        }
      }
      if (lateKilled.length) sleep(Math.min(HOOK_POST_SIGNAL_MS, Math.max(0, deadline - monotonicNow() - 25)));
      for (const target of lateKilled) {
        const current = readIdentity(target.pid, { runner: boundedRunner });
        if (current?.state === "absent") cleanup.verifiedPids.push(target.pid);
        else if (
          current?.state === "present"
          && validObservedIdentity(current.identity)
          && !sameBirthIdentityPresent(target, current)
        ) cleanup.verifiedPids.push(target.pid);
        else missingEvidence.push(current?.state === "present"
          ? "post-kill-survivor"
          : "post-kill-verification-unknown");
      }
    }
    const final = collectHookTargets(sessionId, {
      runner: boundedRunner,
      uid,
      selfPid,
      parentPid,
      appServer: identity,
    });
    if (!final.complete) refuse(final.reason);
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

function hookInspectionResult(outcome, platform, thresholds) {
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
      complete: outcome.status === "healthy" || outcome.status === "warning",
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

function readHookPayload(fsApi) {
  try {
    const buffer = Buffer.alloc(MAX_HOOK_INPUT_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = fsApi.readSync(0, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes <= 0 || bytes > MAX_HOOK_INPUT_BYTES) return null;
    return parseHookPayload(buffer.subarray(0, bytes).toString("utf8"));
  } catch {
    return null;
  }
}

export function classifyInventory(inventory, {
  now = Date.now(),
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  const effectiveThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const collectionCodes = unique((inventory.collectionErrors ?? []).map((error) => error.code));
  if (inventory.platform !== "darwin" && !collectionCodes.includes("unsupported-platform")) {
    collectionCodes.push("unsupported-platform");
  }
  const processListComplete = !collectionCodes.some((code) => code.startsWith("process-list"));
  const processes = Array.isArray(inventory.processes) ? inventory.processes : [];
  const byPid = new Map(processes.map((processRecord) => [processRecord.pid, processRecord]));
  const children = childrenByParent(processes);
  const appServers = processes
    .filter((processRecord) => isAppServerCommand(processRecord.rawCommand))
    .sort((left, right) => left.pid - right.pid);
  const proxyProcesses = processes
    .filter((processRecord) => appServerCommandKind(processRecord.rawCommand) === "proxy")
    .sort((left, right) => left.pid - right.pid);
  const proxyAssociations = new Map();
  if (inventory.controlSockets?.complete) {
    for (const proxy of proxyProcesses) {
      const association = proxySocketAssociation(
        proxySocketFor(inventory.proxySockets, proxy.pid),
        inventory.controlSockets,
      );
      if (association) proxyAssociations.set(proxy.pid, association);
      else if (!collectionCodes.includes("proxy-socket-association")) {
        collectionCodes.push("proxy-socket-association");
      }
    }
  }

  const servers = appServers.map((processRecord) => {
    const missingEvidence = [];
    if (!processIdentityComplete(processRecord)) missingEvidence.push("process-identity");
    if (!processListComplete) missingEvidence.push("descendant-summary");
    const descriptor = descriptorFor(inventory.descriptors, processRecord.pid);
    if (!descriptor?.complete) missingEvidence.push("file-descriptors");
    const tree = descendantsOf(processRecord.pid, children);
    const descendantProxyClients = tree.descendants.flatMap((descendant) => {
      const commandIdentity = proxyCommandIdentity(descendant.rawCommand);
      return commandIdentity && commandIdentity !== "codex app-server proxy" ? [{
        pid: descendant.pid,
        parentPid: descendant.parentPid,
        commandIdentity,
      }] : [];
    });
    const controlSocket = serverSocket(
      processRecord.pid,
      inventory.controlSockets,
      missingEvidence,
    );
    let ancestry = classifyAncestry(processRecord, byPid, processListComplete);
    if (
      ancestry.classification === "detached"
      && controlSocket.state !== "owned"
    ) {
      ancestry = { classification: "ambiguous", reason: "control-socket-unproven" };
    }
    if (ancestry.classification === "ambiguous") missingEvidence.push("gui-detached-classification");
    const remoteProxyClients = [...descendantProxyClients, ...proxyProcesses.flatMap((proxy) => {
      const association = proxyAssociations.get(proxy.pid);
      return controlSocket.state === "owned"
        && association?.path === controlSocket.path
        && (association.ownerPid === null || association.ownerPid === processRecord.pid)
        ? [{
            pid: proxy.pid,
            parentPid: proxy.parentPid,
            commandIdentity: "codex app-server proxy",
          }]
        : [];
    })];
    const startedAt = Date.parse(processRecord.startTime);
    const ageHours = Number.isFinite(startedAt)
      ? Number((Math.max(0, now - startedAt) / 3_600_000).toFixed(2))
      : null;
    return {
      pid: processRecord.pid,
      parentPid: processRecord.parentPid,
      processGroupId: processRecord.processGroupId,
      uid: processRecord.uid,
      executable: processRecord.executable || null,
      commandIdentity: "codex app-server",
      startTime: processRecord.startTime || null,
      ageHours,
      classification: ancestry.classification,
      classificationReason: ancestry.reason,
      descriptorCount: descriptor?.complete ? descriptor.count : null,
      highestDescriptor: descriptor?.complete ? descriptor.highest : null,
      descendants: {
        direct: tree.direct.length,
        total: tree.descendants.length,
      },
      remoteProxyClients,
      controlSocket: {
        path: controlSocket.path,
        ownerPid: controlSocket.ownerPid,
        state: controlSocket.state,
      },
      missingEvidence: unique(missingEvidence),
    };
  });

  const selected = [];
  const skipped = [];
  for (const server of servers) {
    if (server.classification === "detached" && server.missingEvidence.length === 0) {
      selected.push({
        pid: server.pid,
        classification: "detached",
        reason: "detached-unix-app-server",
        authorizesMutation: false,
      });
      continue;
    }
    const reasons = [];
    if (server.classification === "gui") reasons.push("gui-app-server");
    if (server.classification === "ambiguous") reasons.push(server.classificationReason);
    reasons.push(...server.missingEvidence.map((item) => `missing-evidence:${item}`));
    skipped.push({ pid: server.pid, classification: server.classification, reasons: unique(reasons) });
  }

  const warnings = servers.flatMap((server) => pressureWarnings(server, effectiveThresholds));
  const refused = collectionCodes.length > 0
    || servers.some((server) => server.classification === "ambiguous" || server.missingEvidence.length > 0);
  const status = refused ? "refused" : warnings.length ? "warning" : "healthy";
  const exitCode = refused
    ? EXIT_CODES.refused
    : warnings.length
      ? EXIT_CODES.warning
      : EXIT_CODES.healthy;
  const result = {
    schemaVersion: 1,
    action: "inspect",
    status,
    selected: refused ? [] : selected,
    skipped,
    warnings,
    verification: {
      platform: inventory.platform,
      readOnly: true,
      mutationAttempted: false,
      complete: !refused,
      thresholds: effectiveThresholds,
      missingEvidence: collectionCodes,
      controlSockets: (inventory.controlSockets?.items ?? []).flatMap((item) => {
        const path = socketPath(String(item.path ?? ""));
        return path && Number.isInteger(item.ownerPid) ? [{ path, ownerPid: item.ownerPid }] : [];
      }),
      servers,
    },
  };
  return { result, exitCode };
}

function invalidResult(code, platform) {
  return {
    schemaVersion: 1,
    action: "invalid",
    status: "refused",
    selected: [],
    skipped: [],
    warnings: [],
    verification: {
      platform,
      readOnly: true,
      mutationAttempted: false,
      complete: false,
      thresholds: { ...DEFAULT_THRESHOLDS },
      missingEvidence: [code],
      controlSockets: [],
      servers: [],
    },
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

function usage() {
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
    const payload = hookInput === undefined ? readHookPayload(fsApi) : parseHookPayload(hookInput);
    if (!payload) {
      if (parsed.json) write(JSON.stringify(hookInspectionResult(
        { status: "unavailable", receipt: null, receiptPath: null },
        platform,
        parsed.thresholds,
      ), null, 2));
      return EXIT_CODES.refused;
    }
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
    if (!parsed.json) {
      if (outcome.status === "healthy" || outcome.status === "disabled") return EXIT_CODES.healthy;
      return outcome.status === "failed" ? EXIT_CODES.failed : EXIT_CODES.refused;
    }
    write(JSON.stringify(hookInspectionResult(outcome, platform, parsed.thresholds), null, 2));
    if (outcome.status === "warning") return EXIT_CODES.warning;
    return outcome.status === "healthy" || outcome.status === "disabled"
      ? EXIT_CODES.healthy
      : EXIT_CODES.refused;
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
