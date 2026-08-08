/** Public CLI: path/catalog/state loading, the fixed Oracle bridge, and main. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  error,
  isObject,
  onlyFields,
  result,
  stableDigest,
} from "./bounds.mjs";
import {
  validateCatalog,
} from "./catalog.mjs";
import {
  handleRequest,
} from "./dispatch.mjs";
import {
  resolvePaths,
  safeStat,
} from "./paths.mjs";
import {
  capabilityAttestationFacts,
} from "./queries.mjs";
import {
  receiptImportAttestationDigest,
} from "./receipts.mjs";
import {
  FIXED_CLI_RECEIPT_PRODUCERS,
  FIXED_LOCAL_PROBE_ATTESTOR,
  MAX_JSON_BYTES,
  MAX_STATE_BYTES,
  MUTATING_COMMANDS,
  TRUSTED_RECEIPT_IMPORTER_ID,
  TRUSTED_RECEIPT_IMPORTER_VERSION,
} from "./registries.mjs";
import {
  normalizeCommand,
} from "./request.mjs";
import {
  createEmptyState,
  validateState,
} from "./state-schema.mjs";
import {
  readPrivateJson,
  withStateLock,
  writePrivateJsonLocked,
} from "./store.mjs";

export function loadCatalogForCli(paths) {
  const loaded = readPrivateJson(paths.config.path, { missingOk: true, maxBytes: MAX_JSON_BYTES });
  if (!loaded.ok) return loaded;
  if (loaded.value === null) {
    if (paths.config.source === "config-override") return error("selected_policy_missing", { source: paths.config.source });
    return result(true, "config_default", { catalog: null, source: paths.config.source });
  }
  const validation = validateCatalog(loaded.value);
  return validation.ok ? result(true, "catalog_loaded", { catalog: loaded.value, source: paths.config.source, digest: validation.policy.digest }) : validation;
}

export function loadStateForCli(paths) {
  const loaded = readPrivateJson(paths.state.path, { missingOk: true, maxBytes: MAX_STATE_BYTES });
  if (!loaded.ok) return loaded;
  const state = loaded.value === null ? createEmptyState() : loaded.value;
  const validation = validateState(state);
  return validation.ok ? result(true, "state_loaded", { state }) : validation;
}

export function fixedPrivateDirectoryIssue(directory) {
  const stat = safeStat(directory);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return "fixed_adapter_artifact_unavailable";
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return "fixed_adapter_artifact_unavailable";
  return (stat.mode & 0o077) === 0 ? null : "fixed_adapter_artifact_unavailable";
}

export function fixedOracleRouteRoot(home) {
  return path.join(path.resolve(home), ".local", "state", "railyard", "oracle-route");
}

export function fixedOracleAdapterProbe() {
  // This is a fixed source path within this plugin, not a user-supplied
  // command or adapter hook.  It establishes only bridge availability; it
  // deliberately does not assert account entitlement or browser auth.
  const source = fileURLToPath(new URL("../../skills/oracle/scripts/oracle-route.mjs", import.meta.url));
  const stat = safeStat(source);
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return null;
  try {
    return {
      id: "oracle_route_private_receipt_bridge",
      version: "v1",
      digest: crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"),
    };
  } catch {
    return null;
  }
}

export function fixedCliCapabilityAttestor() {
  const probe = fixedOracleAdapterProbe();
  return (record) => {
    if (!probe || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(record.carrierId) || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(record.adapterId)) return null;
    const generatedAt = Date.parse(record.generatedAt);
    if (!Number.isFinite(generatedAt)) return null;
    const details = {
      attestorId: FIXED_LOCAL_PROBE_ATTESTOR,
      attestedAt: record.generatedAt,
      expiresAt: record.expiresAt,
      observedModel: "unknown",
      authState: "unknown",
      capabilities: ["private_receipt_bridge"],
      probeId: probe.id,
      probeVersion: probe.version,
      probeDigest: probe.digest,
    };
    const facts = capabilityAttestationFacts(record, details);
    return {
      ...details,
      attestedFactsDigest: stableDigest(facts),
      attestationDigest: stableDigest({ attestorId: details.attestorId, facts }),
    };
  };
}

export function fixedBridgeFailure(reason) {
  const failure = new Error(reason);
  failure.fixedBridgeReason = reason;
  throw failure;
}

export function fixedCliReceiptImporter(home) {
  return ({ expected, untrustedReceipt }) => {
    if (!FIXED_CLI_RECEIPT_PRODUCERS.has(expected.dispatchIdentity.toolId) || !["oracle-browser", "oracle-homebrew-lifecycle"].includes(expected.binding.adapterId)) fixedBridgeFailure("receipt_importer_unsupported");
    if (!isObject(untrustedReceipt) || !onlyFields(untrustedReceipt, new Set(["receiptId"])) || typeof untrustedReceipt.receiptId !== "string" || !/^receipt_[a-f0-9]{32}$/.test(untrustedReceipt.receiptId)) fixedBridgeFailure("fixed_receipt_reference_required");
    const root = fixedOracleRouteRoot(home);
    const receipts = path.join(root, "receipts");
    if (fixedPrivateDirectoryIssue(root) || fixedPrivateDirectoryIssue(receipts)) fixedBridgeFailure("fixed_adapter_artifact_unavailable");
    const file = path.join(receipts, `${untrustedReceipt.receiptId}.json`);
    const loaded = readPrivateJson(file, { missingOk: false, maxBytes: MAX_JSON_BYTES });
    if (!loaded.ok || !isObject(loaded.value)) fixedBridgeFailure("fixed_adapter_artifact_unavailable");
    const receipt = loaded.value;
    const identity = expected.dispatchIdentity;
    if (receipt.receiptId !== untrustedReceipt.receiptId || receipt.producer !== identity.toolId || receipt.adapterVersion !== expected.binding.adapterVersion || receipt.claimId !== expected.claimId || receipt.frozenInputDigest !== expected.frozenInputDigest || receipt.hostScope !== identity.hostScope || receipt.accountScope !== identity.accountScope || receipt.dispatchKind !== identity.dispatchKind || receipt.sessionId !== identity.sessionId || receipt.toolId !== identity.toolId || receipt.toolVersion !== identity.toolVersion) fixedBridgeFailure("fixed_receipt_binding_mismatch");
    return {
      importerId: TRUSTED_RECEIPT_IMPORTER_ID,
      importerVersion: TRUSTED_RECEIPT_IMPORTER_VERSION,
      attestationDigest: receiptImportAttestationDigest(TRUSTED_RECEIPT_IMPORTER_ID, TRUSTED_RECEIPT_IMPORTER_VERSION, expected, receipt),
      attestedAt: expected.importedAt,
      receipt,
    };
  };
}

export function fixedCliBridge(home) {
  return {
    trustedCapabilityAttestor: fixedCliCapabilityAttestor(),
    trustedReceiptImporter: fixedCliReceiptImporter(home),
    fixedReceiptProducers: FIXED_CLI_RECEIPT_PRODUCERS,
    requireControllerRuntime: false,
  };
}

export function runCli(input, options = {}) {
  const command = normalizeCommand(input || {});
  const suppliedEnv = options.env || process.env;
  const protectedInspection = command === "inspect-claim" && !(options.trustedEmbedding === true && options.trustedPathOverrides === true);
  const routingEnv = protectedInspection
    ? {
      ...suppliedEnv,
      RAILYARD_MODEL_POLICY_PATH: undefined,
      RAILYARD_MODEL_STATE_PATH: undefined,
      XDG_CONFIG_HOME: undefined,
      XDG_STATE_HOME: undefined,
      LOCALAPPDATA: undefined,
    }
    : suppliedEnv;
  const paths = resolvePaths({ ...options, env: routingEnv, ...(protectedInspection ? { home: os.homedir() } : {}) });
  if (!paths.ok) return paths;
  const cliHome = protectedInspection ? os.homedir() : (options.home || os.homedir());
  const bridge = options.trustedEmbedding === true
    ? {
      trustedCapabilityAttestor: options.trustedCapabilityAttestor,
      trustedReceiptImporter: options.trustedReceiptImporter,
      trustedTaskAuthorityAttestor: options.trustedTaskAuthorityAttestor,
      trustedRuntimeAttestor: options.trustedRuntimeAttestor,
      trustedTransportAttestor: options.trustedTransportAttestor,
      fixedReceiptProducers: options.fixedReceiptProducers,
      controllerRuntime: options.controllerRuntime,
      requireControllerRuntime: options.requireControllerRuntime === true,
    }
    : fixedCliBridge(cliHome);
  const catalogLoaded = loadCatalogForCli(paths);
  if (!catalogLoaded.ok) return catalogLoaded;
  const handleOptions = (state) => ({
    catalog: catalogLoaded.catalog,
    state,
    now: options.now ?? Date.now(),
    platform: options.platform || process.platform,
    ...bridge,
  });
  const platform = options.platform || process.platform;
  const mutatesState = MUTATING_COMMANDS.has(command) && !(command === "admit" && catalogLoaded.catalog === null);
  if (platform === "win32" && mutatesState) return error("secure_state_unsupported");
  if (mutatesState) {
    return withStateLock(paths.state.path, () => {
      const loaded = loadStateForCli(paths);
      if (!loaded.ok) return loaded;
      const handled = handleRequest(input, handleOptions(loaded.state));
      if (!handled.changed) return handled.response;
      const written = writePrivateJsonLocked(paths.state.path, handled.state);
      return written.ok ? handled.response : written;
    });
  }
  const needsState = command === "inspect-claim" || (command !== "resolve" && command !== "validate" && command !== "status" ? catalogLoaded.catalog !== null : command === "status");
  let state = createEmptyState();
  if (needsState || catalogLoaded.catalog !== null) {
    const loaded = loadStateForCli(paths);
    if (!loaded.ok) return loaded;
    state = loaded.state;
  }
  const handled = handleRequest(input, handleOptions(state));
  return handled.response;
}

/**
 * A request is one bounded JSON object.  Reading an unbounded pipe into memory
 * before the request bounds could apply was the one input path with no ceiling,
 * so stop at MAX_JSON_BYTES and refuse anything longer.
 */
export function readStdin(maxBytes = MAX_JSON_BYTES) {
  const chunks = [];
  const buffer = Buffer.alloc(64 * 1024);
  let total = 0;
  for (;;) {
    let read;
    try {
      read = fs.readSync(0, buffer, 0, buffer.length, null);
    } catch (cause) {
      if (cause?.code === "EAGAIN") continue;
      if (cause?.code === "EOF") break;
      throw cause;
    }
    if (read === 0) break;
    total += read;
    if (total > maxBytes) throw new Error("input_too_large");
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The contract is stdin-only: no caller passes a command as argv, so there is
// no second, unvalidated command surface to keep in sync.
export function main() {
  let input;
  try {
    const raw = readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(`${JSON.stringify(error("invalid_json_input"))}\n`);
    process.exitCode = 2;
    return;
  }
  const output = runCli(input);
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = output.ok ? 0 : 1;
}

