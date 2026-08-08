/** macOS inventory collection, ancestry classification, and pressure warnings. */

import path from "node:path";
import {
  DEFAULT_THRESHOLDS,
  EXIT_CODES,
  LSOF,
  PS,
} from "./constants.mjs";
import {
  appServerCommandKind,
  commandEvidenceAgrees,
  commandExecutable,
  commandName,
  defaultRunner,
  identityDifferences,
  isAppServerCommand,
  parseControlSockets,
  parseProcessFiles,
  parseProxySocketEvidence,
  parsePsOutput,
  safeRun,
  socketEndpoint,
  socketPath,
  unique,
  validObservedIdentity,
} from "./process-evidence.mjs";

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

export function collectExactProcessEvidence(pid, { runner = defaultRunner } = {}) {
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

export function isGuiHost(processRecord) {
  const identity = `${processRecord.executable ?? ""} ${processRecord.rawCommand ?? ""}`;
  return /\/(?:Codex|ChatGPT)\.app\/Contents\/MacOS\/(?:Codex|ChatGPT)(?:\s|$)/i.test(identity)
    || /\/(?:Codex|ChatGPT)\.app\/Contents\/Frameworks\/.*(?:Codex|ChatGPT) Helper/i.test(identity);
}

export function classifyAncestry(server, byPid, processListComplete) {
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

export function descendantsOf(pid, children) {
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

export function childrenByParent(processes) {
  const children = new Map();
  for (const processRecord of processes) {
    const list = children.get(processRecord.parentPid) ?? [];
    list.push(processRecord);
    children.set(processRecord.parentPid, list);
  }
  return children;
}

export function proxyCommandIdentity(command = "") {
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

export function descriptorFor(descriptors, pid) {
  return descriptors?.[pid];
}

export function processIdentityComplete(processRecord) {
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

export function proxySocketFor(proxySockets, pid) {
  return proxySockets?.[pid];
}

export function proxySocketAssociation(evidence, controlSockets) {
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

export function serverSocket(serverPid, controlSockets, missingEvidence) {
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

export function pressureWarnings(server, thresholds) {
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

export function invalidResult(code, platform) {
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
