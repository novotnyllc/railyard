#!/usr/bin/env node
/** Fixed, local-only Oracle browser carrier for model-routing/v1. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli as runRouter, stableDigest } from "../../../scripts/model-routing.mjs";

const CONTRACT = "railyard/model-routing/v1";
const PRODUCER = "oracle-browser";
const LIFECYCLE_PRODUCER = "oracle-homebrew-lifecycle";
const ADAPTER_VERSION = "v1";
const IMPORTER_ID = "railyard-adapter-receipt-importer-v1";
const IMPORTER_VERSION = "v1";
const FORMULA = "steipete/tap/oracle";
const FIXED_MODEL = "gpt-5-pro";
const PRODUCT_LABEL = "GPT-5.6 Sol Pro";
const MIN_VERSION = [0, 17, 0];
const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 64;
const MAX_RETAIN_HOURS = 24 * 31;
const MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const SAFE_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const SECRET = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\b(?:sk|rk|xox[baprs])-[-A-Za-z0-9]{16,}\b|\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s]{8,}/i;
const SECRET_NAME = /(^|\/)(?:\.env(?:\..*)?|id_[a-z0-9_-]+|.*\.(?:pem|p12|pfx|key))$/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function opaqueId(prefix, seed) {
  const body = seed ? hash(seed).slice(0, 32) : crypto.randomBytes(16).toString("hex");
  return `${prefix}_${body}`;
}

function routeRoot() {
  return path.join(fs.realpathSync(os.homedir()), ".local", "state", "railyard", "oracle-route");
}

function assertPrivateDirectory(directory) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) fail("unsafe_route_home");
}

function ensureRoot(root) {
  if (!path.isAbsolute(root)) fail("unsafe_route_home");
  const resolved = path.resolve(root);
  const repo = fs.realpathSync(process.cwd());
  if (resolved === repo || resolved.startsWith(`${repo}${path.sep}`) || resolved.includes(`${path.sep}.codex${path.sep}plugins${path.sep}cache${path.sep}`)) fail("unsafe_route_home");
  const inspectAncestors = () => {
    let current = path.parse(resolved).root;
    for (const segment of resolved.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const info = fs.lstatSync(current);
        if (info.isSymbolicLink() || !info.isDirectory()) fail("unsafe_route_home");
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
    }
  };
  inspectAncestors();
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  inspectAncestors();
  assertPrivateDirectory(resolved);
  return resolved;
}

function ensureChild(parent, name) {
  const child = path.join(parent, name);
  try { fs.mkdirSync(child, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  assertPrivateDirectory(child);
  return child;
}

function createPrivateDirectory(parent, name) {
  const child = path.join(parent, name);
  fs.mkdirSync(child, { mode: 0o700 });
  assertPrivateDirectory(child);
  return child;
}

function writeExclusive(file, bytes) {
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    return executableIdentity(fs.fstatSync(descriptor, { bigint: true }));
  }
  finally { fs.closeSync(descriptor); }
}

function readBoundedRegular(file, maximum, errorCode = "non_regular_input") {
  let descriptor;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
  catch { fail(errorCode); }
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maximum)) fail(errorCode === "non_regular_input" ? "input_too_large" : errorCode);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) fail(errorCode);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function readJsonRegular(file) {
  try { return JSON.parse(readBoundedRegular(file, 256 * 1024, "unsafe_private_state").toString("utf8")); }
  catch (error) { if (error.code) throw error; fail("unsafe_private_state"); }
}

function readJsonRegularWithIdentity(file) {
  let descriptor;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
  catch { fail("unsafe_private_state"); }
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(256 * 1024)) fail("unsafe_private_state");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (stable(executableIdentity(before)) !== stable(executableIdentity(after))) fail("unsafe_private_state");
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { fail("unsafe_private_state"); }
    return { value, identity: executableIdentity(after) };
  } finally { fs.closeSync(descriptor); }
}

function unlinkRegularIdentity(file, expectedIdentity = null) {
  const opened = readJsonRegularWithIdentity(file);
  if (expectedIdentity && stable(opened.identity) !== stable(expectedIdentity)) fail("unsafe_private_state");
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || stable(executableIdentity(before)) !== stable(opened.identity)) fail("unsafe_private_state");
  fs.unlinkSync(file);
}

function unlinkRegularArtifact(file) {
  let descriptor;
  try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW); }
  catch { fail("unsafe_private_state"); }
  let identity;
  try {
    const info = fs.fstatSync(descriptor, { bigint: true });
    if (!info.isFile()) fail("unsafe_private_state");
    identity = executableIdentity(info);
  } finally { fs.closeSync(descriptor); }
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || stable(executableIdentity(before)) !== stable(identity)) fail("unsafe_private_state");
  fs.unlinkSync(file);
}

function removePrivateBundle(root, sessionId) {
  if (typeof sessionId !== "string" || !/^oracle_[a-f0-9]{32}$/.test(sessionId)) return;
  const bundles = path.join(root, "bundles");
  const bundle = path.join(bundles, sessionId);
  if (!fs.existsSync(bundle)) return;
  assertPrivateDirectory(bundles);
  const info = fs.lstatSync(bundle);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) fail("unsafe_private_state");
  fs.rmSync(bundle, { recursive: true });
}

function readSource(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) fail("unsafe_input_path");
  if (SECRET_NAME.test(file)) fail("secret_input");
  let current = path.parse(file).root;
  const segments = file.slice(current.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const info = fs.lstatSync(current);
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) fail("non_regular_input");
  }
  const bytes = readBoundedRegular(file, MAX_FILE_BYTES);
  if (bytes.includes(0) || SECRET.test(bytes.toString("utf8"))) fail("secret_or_binary_input");
  return { source: path.resolve(file), bytes, sha256: hash(bytes) };
}

function assertRouteShape(input) {
  const route = input.route || {};
  if (input.contractVersion !== CONTRACT) fail("invalid_contract");
  if (route.adapter === "oracle-api" || route.executionSurface === "provider_api") fail("unsupported_adapter");
  if (route.adapter !== PRODUCER || route.requestedModel !== "chatgpt_current_pro" || route.executionSurface !== "chatgpt_standard") fail("unsupported_adapter");
  const auth = input.authReadiness || "unknown";
  if (!["unknown", "fresh_success"].includes(auth)) fail("invalid_auth_readiness");
  if (auth === "unknown" && input.allowUnknownAuth !== true) fail("auth_context_unknown");
}

function assertRetainHours(hours) {
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_RETAIN_HOURS) fail("unsafe_retention");
}

function boundedTimeout(value) {
  return Number.isInteger(value) && value >= 1_000 && value <= MAX_TIMEOUT_MS ? value : MAX_TIMEOUT_MS;
}

export function freezeInput(input, suppliedRoot = routeRoot()) {
  assertRouteShape(input);
  assertRetainHours(input.retainHours);
  if (typeof input.prompt !== "string" || Buffer.byteLength(input.prompt) > MAX_PROMPT_BYTES || SECRET.test(input.prompt)) fail("unsafe_prompt");
  if (!Array.isArray(input.files) || input.files.length > MAX_FILES || !Array.isArray(input.exclusions)) fail("invalid_input_set");
  if (input.exclusions.some((item) => typeof item !== "string" || item.length > 512 || /[\u0000-\u001f]/.test(item))) fail("invalid_exclusion");
  const sourceFiles = input.files.map(readSource).sort((left, right) => left.source.localeCompare(right.source));
  const totalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes.length, Buffer.byteLength(input.prompt));
  if (totalBytes > MAX_TOTAL_BYTES) fail("input_too_large");

  const root = ensureRoot(suppliedRoot);
  const bundles = ensureChild(root, "bundles");
  const sessionId = opaqueId("oracle");
  const bundle = createPrivateDirectory(bundles, sessionId);
  const promptPath = path.join(bundle, "prompt.txt");
  writeExclusive(promptPath, input.prompt);
  const fileRoot = createPrivateDirectory(bundle, "files");
  const files = sourceFiles.map((file, index) => {
    const bundlePath = path.join(fileRoot, `${String(index).padStart(3, "0")}-${hash(file.source).slice(0, 16)}.txt`);
    writeExclusive(bundlePath, file.bytes);
    return { sourceSha256: hash(file.source), sha256: file.sha256, bytes: file.bytes.length, bundlePath };
  });
  const manifest = {
    version: 1,
    sessionId,
    promptSha256: hash(Buffer.from(input.prompt)),
    files: files.map(({ sourceSha256, sha256, bytes }) => ({ sourceSha256, sha256, bytes })),
    exclusions: [...input.exclusions].sort(),
    arguments: { engine: "browser", model: FIXED_MODEL, retainHours: input.retainHours },
  };
  manifest.inputDigest = hash(stable(manifest));
  writeExclusive(path.join(bundle, "manifest.json"), JSON.stringify(manifest));
  return { root, bundle, manifest, promptPath, files };
}

export function revalidateFrozen(frozen) {
  const manifest = JSON.parse(readBoundedRegular(path.join(frozen.bundle, "manifest.json"), 256 * 1024, "frozen_input_changed").toString("utf8"));
  const prompt = readBoundedRegular(frozen.promptPath, MAX_PROMPT_BYTES, "frozen_input_changed");
  if (hash(prompt) !== manifest.promptSha256) fail("frozen_input_changed");
  const files = frozen.files.map((entry) => {
    const bytes = readBoundedRegular(entry.bundlePath, MAX_FILE_BYTES, "frozen_input_changed");
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) fail("frozen_input_changed");
    return { sourceSha256: entry.sourceSha256, sha256: entry.sha256, bytes: entry.bytes };
  });
  const unsigned = { ...manifest };
  delete unsigned.inputDigest;
  if (hash(stable(unsigned)) !== manifest.inputDigest || stable(files) !== stable(manifest.files)) fail("frozen_input_changed");
  return manifest;
}

function loadFrozen(root, sessionId, inputDigest) {
  if (typeof sessionId !== "string" || !/^oracle_[a-f0-9]{32}$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(inputDigest || "")) fail("frozen_input_required");
  const bundle = path.join(root, "bundles", sessionId);
  const manifest = JSON.parse(readBoundedRegular(path.join(bundle, "manifest.json"), 256 * 1024, "frozen_input_changed").toString("utf8"));
  if (manifest.sessionId !== sessionId || manifest.inputDigest !== inputDigest || !Array.isArray(manifest.files)) fail("frozen_input_changed");
  const files = manifest.files.map((entry, index) => ({
    ...entry,
    bundlePath: path.join(bundle, "files", `${String(index).padStart(3, "0")}-${entry.sourceSha256.slice(0, 16)}.txt`),
  }));
  const frozen = { root, bundle, manifest, promptPath: path.join(bundle, "prompt.txt"), files };
  revalidateFrozen(frozen);
  return frozen;
}

function executableIdentity(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    size: String(info.size),
    mtimeNs: String(info.mtimeNs),
    mode: Number(info.mode),
    uid: Number(info.uid),
    gid: Number(info.gid),
  };
}

function assertTrustedExecutableAncestors(file) {
  const trustedOwners = new Set([0, process.getuid?.()].filter(Number.isInteger));
  const currentUid = process.getuid?.();
  const currentGroups = new Set([process.getgid?.(), ...(process.getgroups?.() || [])].filter(Number.isInteger));
  const canonicalHomebrewRoot = ["/opt/homebrew", "/usr/local"].find((root) => file === root || file.startsWith(`${root}${path.sep}`));
  const identities = [];
  let current = path.parse(file).root;
  const ancestors = [current];
  for (const segment of path.dirname(file).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    ancestors.push(current);
  }
  for (current of ancestors) {
    const info = fs.lstatSync(current, { bigint: true });
    const mode = Number(info.mode);
    const uid = Number(info.uid);
    const gid = Number(info.gid);
    const stickyRootDirectory = uid === 0 && (mode & 0o1000) !== 0;
    const groupWritable = (mode & 0o020) !== 0;
    const worldWritable = (mode & 0o002) !== 0;
    const homebrewOwnedGroupWrite = groupWritable
      && canonicalHomebrewRoot
      && (current === canonicalHomebrewRoot || current.startsWith(`${canonicalHomebrewRoot}${path.sep}`))
      && uid === currentUid
      && currentGroups.has(gid)
      && !worldWritable;
    if (!info.isDirectory()
      || info.isSymbolicLink()
      || !trustedOwners.has(uid)
      || (worldWritable && !stickyRootDirectory)
      || (groupWritable && !stickyRootDirectory && !homebrewOwnedGroupWrite)) fail("unsafe_oracle_executable");
    identities.push({ path: current, ...executableIdentity(info) });
  }
  return identities;
}

export function bindExecutable(candidate, repoRoot = process.cwd()) {
  const actual = fs.realpathSync(candidate);
  const repo = fs.realpathSync(repoRoot);
  if (actual === repo || actual.startsWith(`${repo}${path.sep}`)) fail("unsafe_oracle_executable");
  const ancestors = assertTrustedExecutableAncestors(actual);
  let descriptor;
  try { descriptor = fs.openSync(actual, fs.constants.O_RDONLY | NOFOLLOW); }
  catch { fail("unsafe_oracle_executable"); }
  try {
    const info = fs.fstatSync(descriptor, { bigint: true });
    if (!info.isFile() || (Number(info.mode) & 0o022) !== 0 || ![0, process.getuid?.()].includes(Number(info.uid))) fail("unsafe_oracle_executable");
    return { binary: actual, identity: executableIdentity(info), ancestors };
  } finally { fs.closeSync(descriptor); }
}

export function revalidateExecutable(binding) {
  const current = bindExecutable(binding.binary);
  if (stable(current.identity) !== stable(binding.identity) || stable(current.ancestors) !== stable(binding.ancestors)) fail("oracle_executable_changed");
  return current.binary;
}

function parseVersion(text) {
  const found = String(text).match(/(?:oracle\s+)?v?(\d+)\.(\d+)\.(\d+)/i);
  if (!found) fail("oracle_version_unknown");
  return found.slice(1).map(Number);
}

function atLeast(version) {
  for (let index = 0; index < MIN_VERSION.length; index += 1) {
    if (version[index] !== MIN_VERSION[index]) return version[index] > MIN_VERSION[index];
  }
  return true;
}

function fixedEnvironment(oracleHome) {
  return { HOME: oracleHome, ORACLE_HOME_DIR: oracleHome, PATH: SAFE_PATH, LANG: "C", LC_ALL: "C" };
}

function resolveBrew() {
  const candidate = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].find((file) => fs.existsSync(file));
  if (!candidate) fail("homebrew_unavailable");
  return bindExecutable(candidate);
}

export function resolveCarrier({ run = spawnSync, repoRoot } = {}) {
  const brew = resolveBrew();
  revalidateExecutable(brew);
  const prefixResult = run(brew.binary, ["--prefix", FORMULA], { encoding: "utf8", env: { PATH: SAFE_PATH }, maxBuffer: 256 * 1024 });
  if (prefixResult.status !== 0) fail("oracle_not_installed");
  const prefix = String(prefixResult.stdout).trim();
  if (!path.isAbsolute(prefix)) fail("unsafe_oracle_executable");
  const carrier = bindExecutable(path.join(prefix, "bin", "oracle"), repoRoot);
  revalidateExecutable(carrier);
  const versionResult = run(carrier.binary, ["--version"], { encoding: "utf8", env: { PATH: SAFE_PATH }, maxBuffer: 256 * 1024 });
  if (versionResult.status !== 0) fail("oracle_version_unknown");
  const version = parseVersion(versionResult.stdout || versionResult.stderr);
  if (!atLeast(version)) {
    const error = new Error("oracle_version_unsupported");
    error.code = "oracle_version_unsupported";
    error.installedVersion = version.join(".");
    throw error;
  }
  return { ...carrier, version: version.join(".") };
}

function claimId(input, lifecycle = false) {
  const value = lifecycle ? input.lifecycleClaim?.id : (input.claimId || input.claimed?.id);
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) fail(lifecycle ? "lifecycle_claim_required" : "claim_required");
  return value;
}

function inspectBinding(input, frozenInputDigest, options, lifecycle = false) {
  const id = claimId(input, lifecycle);
  const reservationId = lifecycle ? input.lifecycleReservationId : input.reservationId;
  if (typeof reservationId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(reservationId) || !/^[a-f0-9]{64}$/.test(input.policyDigest || "") || !/^[a-f0-9]{64}$/.test(frozenInputDigest || "")) fail(lifecycle ? "lifecycle_claim_unverified" : "claim_unverified");
  const request = { contractVersion: CONTRACT, command: "inspect-claim", claimId: id, reservationId };
  const inspect = options.inspectClaim || ((value) => runRouter(value));
  const response = inspect(request);
  const claim = response?.claim;
  const expectedCarrier = lifecycle ? LIFECYCLE_PRODUCER : PRODUCER;
  const expectedSurface = lifecycle ? "local_host" : "chatgpt_standard";
  const expectedDispatch = lifecycle ? "lifecycle_action" : "subagent_create";
  const identity = claim?.dispatchIdentity;
  const valid = response?.ok === true
    && response.contractVersion === CONTRACT
    && response.reason === "claim_verified"
    && claim?.claimId === id
    && claim.reservationId === reservationId
    && ["claimed", "started", "ambiguous"].includes(claim.state)
    && claim.policyDigest === input.policyDigest
    && claim.frozenInputDigest === frozenInputDigest
    && claim.selected?.carrierId === expectedCarrier
    && claim.selected.carrierVersion === ADAPTER_VERSION
    && claim.selected.executionSurface === expectedSurface
    && claim.binding?.adapterId === expectedCarrier
    && claim.binding.adapterVersion === ADAPTER_VERSION
    && claim.binding.dispatchKind === expectedDispatch
    && identity
    && typeof identity.hostScope === "string"
    && /^[a-z][a-z0-9_-]{0,63}$/.test(identity.hostScope)
    && typeof identity.accountScope === "string"
    && /^[a-z][a-z0-9_-]{0,63}$/.test(identity.accountScope)
    && identity.dispatchKind === expectedDispatch
    && typeof identity.sessionId === "string"
    && /^[a-z][a-z0-9_-]{0,127}$/.test(identity.sessionId)
    && identity.toolId === expectedCarrier
    && identity.toolVersion === ADAPTER_VERSION
    && (lifecycle || identity.sessionId === input.sessionId);
  if (!valid) fail(lifecycle ? "lifecycle_claim_unverified" : "claim_unverified");
  return {
    claimId: id,
    reservationId,
    policyDigest: claim.policyDigest,
    frozenInputDigest: claim.frozenInputDigest,
    state: claim.state,
    producer: expectedCarrier,
    executionSurface: expectedSurface,
    dispatchIdentity: { ...identity },
  };
}

function claimFile(root, id) {
  const directory = ensureChild(root, "claims");
  return path.join(directory, `${hash(id)}.json`);
}

function receiptFile(root, receiptId) {
  return path.join(ensureChild(root, "receipts"), `${receiptId}.json`);
}

function expiredClaimTombstone(claim, now) {
  return {
    version: 1,
    kind: claim.kind,
    claimId: claim.claimId,
    producer: claim.producer,
    state: "expired",
    reason: "retention_expired",
    expiredAt: new Date(now).toISOString(),
    receiptId: null,
  };
}

function removeExpiredReattachLock(claimPath, claim, now) {
  const lock = `${claimPath}.reattach`;
  if (!fs.existsSync(lock)) return;
  const opened = readJsonRegularWithIdentity(lock);
  const expiresAt = Date.parse(opened.value?.expiresAt);
  const claimExpiresAt = Date.parse(claim.expiresAt);
  if (opened.value?.version !== 1
    || opened.value?.kind !== "oracle_reattach_lock"
    || opened.value?.claimId !== claim.claimId
    || opened.value?.sessionId !== claim.sessionId
    || opened.value?.frozenInputDigest !== claim.frozenInputDigest
    || !Number.isFinite(expiresAt)
    || (Number.isFinite(claimExpiresAt) && expiresAt > claimExpiresAt)) fail("unsafe_private_state");
  if (expiresAt <= now) unlinkRegularIdentity(lock, opened.identity);
}

function cleanupExpiredArtifacts(root, now = Date.now()) {
  const receipts = path.join(root, "receipts");
  const results = path.join(root, "results");
  if (fs.existsSync(receipts)) {
    assertPrivateDirectory(receipts);
    for (const name of fs.readdirSync(receipts).slice(0, 2_048)) {
      if (!/^receipt_[a-f0-9]{32}\.json$/.test(name)) continue;
      const file = path.join(receipts, name);
      const value = readJsonRegular(file);
      const expiresAt = Date.parse(value.expiresAt);
      if (!["started", "ambiguous", "settled", "no_start"].includes(value.status) || !Number.isFinite(expiresAt) || expiresAt > now) continue;
      const tombstone = path.join(root, "claims", `${hash(value.claimId)}.json`);
      let claim = null;
      let ownsClaim = false;
      if (fs.existsSync(tombstone)) {
        claim = readJsonRegular(tombstone);
        const ownsReceipt = claim.receiptId === value.receiptId;
        const ownsAmbiguousClaim = value.status === "ambiguous"
          && ["in_progress", "ambiguous"].includes(claim.state)
          && claim.claimId === value.claimId
          && claim.sessionId === value.sessionId
          && claim.frozenInputDigest === value.frozenInputDigest;
        ownsClaim = ownsReceipt || ownsAmbiguousClaim;
        if (ownsClaim) removeExpiredReattachLock(tombstone, claim, now);
      }
      const artifact = value.resultArtifact?.path;
      if (typeof artifact === "string" && path.dirname(artifact) === results && fs.existsSync(artifact)) unlinkRegularArtifact(artifact);
      removePrivateBundle(root, value.sessionId);
      unlinkRegularIdentity(file);
      if (ownsClaim) replaceRegularJson(tombstone, expiredClaimTombstone(claim, now));
    }
  }

  const claims = path.join(root, "claims");
  if (fs.existsSync(claims)) {
    assertPrivateDirectory(claims);
    for (const name of fs.readdirSync(claims).slice(0, 2_048)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(claims, name);
      const claim = readJsonRegular(file);
      const expiresAt = Date.parse(claim.expiresAt);
      if (claim.state === "expired" || !Number.isFinite(expiresAt) || expiresAt > now) continue;
      removeExpiredReattachLock(file, claim, now);
      removePrivateBundle(root, claim.sessionId);
      replaceRegularJson(file, expiredClaimTombstone(claim, now));
    }
  }
}

function persistReceipt(root, value) {
  writeExclusive(receiptFile(root, value.receiptId), JSON.stringify(value));
  return value;
}

function replaceRegularJson(file, value) {
  const existing = fs.lstatSync(file);
  if (!existing.isFile() || existing.isSymbolicLink()) fail("unsafe_private_state");
  const temporary = `${file}.${opaqueId("tmp")}`;
  writeExclusive(temporary, JSON.stringify(value));
  fs.renameSync(temporary, file);
}

function beginClaim(root, binding, sessionId, kind = "review", retentionHours = 24) {
  const file = claimFile(root, binding.claimId);
  if (sessionId !== binding.dispatchIdentity?.sessionId) fail(kind === "lifecycle" ? "lifecycle_claim_unverified" : "claim_unverified");
  assertRetainHours(retentionHours);
  const initial = {
    version: 1,
    kind,
    claimId: binding.claimId,
    frozenInputDigest: binding.frozenInputDigest,
    sessionId,
    producer: binding.producer || PRODUCER,
    dispatchIdentity: { ...binding.dispatchIdentity },
    state: "in_progress",
    expiresAt: new Date(Date.now() + retentionHours * 60 * 60 * 1_000).toISOString(),
  };
  try {
    writeExclusive(file, JSON.stringify(initial));
    return { owner: true, file, value: initial };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const value = readJsonRegular(file);
    if (value.kind !== kind || value.claimId !== binding.claimId || value.frozenInputDigest !== binding.frozenInputDigest || value.producer !== initial.producer || stable(value.dispatchIdentity) !== stable(initial.dispatchIdentity)) fail("claim_input_mismatch");
    return { owner: false, file, value };
  }
}

function baseReceipt(binding, sessionId, status, extra = {}) {
  const identity = binding.dispatchIdentity;
  if (!identity || sessionId !== identity.sessionId || identity.toolId !== (binding.producer || PRODUCER) || identity.toolVersion !== ADAPTER_VERSION) fail("claim_unverified");
  const retentionMatch = String(extra.retentionClass || "local-private-24h").match(/-(\d+)h$/);
  const expiresAt = new Date(Date.now() + Number(retentionMatch?.[1] || 24) * 60 * 60 * 1_000).toISOString();
  const value = {
    receiptId: opaqueId("receipt"),
    producer: binding.producer || PRODUCER,
    adapterVersion: ADAPTER_VERSION,
    claimId: binding.claimId,
    frozenInputDigest: binding.frozenInputDigest,
    status,
    reason: null,
    hostScope: identity.hostScope,
    accountScope: identity.accountScope,
    dispatchKind: identity.dispatchKind,
    sessionId: identity.sessionId,
    toolId: identity.toolId,
    toolVersion: identity.toolVersion,
    originalHostDigest: hash(os.hostname()),
    recordedAt: new Date().toISOString(),
    expiresAt,
    outputTrusted: false,
    chargedMeters: { marginalUsd: 0, codexCredits: 0, openaiApiSpend: 0 },
    ...extra,
  };
  if ((binding.producer || PRODUCER) === PRODUCER) Object.assign(value, {
    requestedModel: "chatgpt_current_pro",
    adapterModelControl: FIXED_MODEL,
    documentedProductLabel: PRODUCT_LABEL,
    observedModel: "unknown",
    executionSurface: "chatgpt_standard",
  });
  if (status === "settled") value.outcomeId = opaqueId("outcome", `${binding.claimId}:${binding.frozenInputDigest}`);
  return value;
}

function retryReceipt(root, claim) {
  if (claim.value.state === "expired") fail("session_expired");
  if (claim.value.receiptId) return readJsonRegular(receiptFile(root, claim.value.receiptId));
  const value = baseReceipt({ claimId: claim.value.claimId, frozenInputDigest: claim.value.frozenInputDigest, producer: claim.value.producer, dispatchIdentity: claim.value.dispatchIdentity }, claim.value.sessionId, "ambiguous", {
    receiptId: opaqueId("receipt", `${claim.value.claimId}:${claim.value.frozenInputDigest}:ambiguous`),
    reason: "claim_already_in_progress",
    expiresAt: claim.value.expiresAt,
  });
  try { return persistReceipt(root, value); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    return readJsonRegular(receiptFile(root, value.receiptId));
  }
}

export function createTrustedReceiptImporter(suppliedRoot = routeRoot()) {
  const root = ensureRoot(suppliedRoot);
  return ({ expected, untrustedReceipt }) => {
    if (expected?.importerId !== IMPORTER_ID || expected?.importerVersion !== IMPORTER_VERSION || typeof untrustedReceipt?.receiptId !== "string" || !/^receipt_[a-f0-9]{32}$/.test(untrustedReceipt.receiptId)) fail("invalid_receipt_import");
    const receipt = readJsonRegular(receiptFile(root, untrustedReceipt.receiptId));
    const identity = expected.dispatchIdentity;
    const expectedProducer = expected.binding?.adapterId;
    const valid = stable(receipt) === stable(untrustedReceipt)
      && receipt.producer === expectedProducer
      && expected.selected?.carrierId === expectedProducer
      && expected.selected?.carrierVersion === ADAPTER_VERSION
      && expected.binding?.adapterVersion === ADAPTER_VERSION
      && receipt.adapterVersion === ADAPTER_VERSION
      && receipt.claimId === expected.claimId
      && receipt.frozenInputDigest === expected.frozenInputDigest
      && receipt.hostScope === identity?.hostScope
      && receipt.accountScope === identity?.accountScope
      && receipt.dispatchKind === identity?.dispatchKind
      && receipt.sessionId === identity?.sessionId
      && receipt.toolId === identity?.toolId
      && receipt.toolVersion === identity?.toolVersion;
    if (!valid) fail("invalid_receipt_import");
    const attestedAt = expected.importedAt;
    const { importedAt: _importedAt, ...binding } = expected;
    return {
      importerId: IMPORTER_ID,
      importerVersion: IMPORTER_VERSION,
      attestationDigest: stableDigest({ importerId: IMPORTER_ID, importerVersion: IMPORTER_VERSION, expected: binding, receipt }),
      attestedAt,
      receipt,
    };
  };
}

function finishClaim(root, claim, value, removeBundle) {
  const durable = { ...value, expiresAt: claim.value.expiresAt || value.expiresAt };
  persistReceipt(root, durable);
  replaceRegularJson(claim.file, { ...claim.value, state: durable.status, receiptId: durable.receiptId });
  if (removeBundle) removePrivateBundle(root, path.basename(removeBundle));
  return durable;
}

function detectAuthSurface(text) {
  return /\b(?:sign\s*in|log\s*in|login|choose\s+(?:an\s+)?account|account\s+selection)\b/i.test(text);
}

function persistResult(root, sessionId, output) {
  const bytes = Buffer.from(output);
  if (bytes.length > MAX_RESULT_BYTES || bytes.includes(0) || SECRET.test(output)) fail("unsafe_oracle_result");
  const directory = ensureChild(root, "results");
  const artifactId = opaqueId("result");
  const artifactPath = path.join(directory, `${artifactId}.txt`);
  writeExclusive(artifactPath, bytes);
  return { artifactId, path: artifactPath, sha256: hash(bytes), bytes: bytes.length, sessionId };
}

export function build(input, options = {}) {
  const frozen = freezeInput(input, options.root || routeRoot());
  cleanupExpiredArtifacts(frozen.root);
  return {
    contractVersion: CONTRACT,
    status: "prepared",
    sessionId: frozen.manifest.sessionId,
    frozenInputDigest: frozen.manifest.inputDigest,
    fileCount: frozen.manifest.files.length,
    retentionClass: `local-private-${frozen.manifest.arguments.retainHours}h`,
  };
}

export function validate(input, options = {}) {
  const frozen = freezeInput(input, options.root || routeRoot());
  revalidateFrozen(frozen);
  return { contractVersion: CONTRACT, status: "validated", sessionId: frozen.manifest.sessionId, frozenInputDigest: frozen.manifest.inputDigest };
}

export function dispatch(input, options = {}) {
  const root = ensureRoot(options.root || routeRoot());
  cleanupExpiredArtifacts(root);
  assertRouteShape(input);
  const id = claimId(input);
  const existingClaimFile = claimFile(root, id);
  if (fs.existsSync(existingClaimFile)) {
    const existing = readJsonRegular(existingClaimFile);
    if (existing.state === "expired") fail("session_expired");
    if (existing.kind !== "review" || existing.sessionId !== input.sessionId || existing.frozenInputDigest !== input.frozenInputDigest) fail("claim_input_mismatch");
    inspectBinding(input, existing.frozenInputDigest, options);
    return retryReceipt(root, { file: existingClaimFile, value: existing });
  }
  const frozen = loadFrozen(root, input.sessionId, input.frozenInputDigest);
  const binding = inspectBinding(input, frozen.manifest.inputDigest, options);
  const retentionClass = `local-private-${frozen.manifest.arguments.retainHours}h`;
  const claim = beginClaim(root, binding, frozen.manifest.sessionId, "review", frozen.manifest.arguments.retainHours);
  if (!claim.owner) return retryReceipt(root, claim);

  const resolve = options.resolveCarrier || resolveCarrier;
  const revalidate = options.revalidateCarrier || revalidateExecutable;
  const run = options.run || spawnSync;
  let carrier;
  try { carrier = resolve(options.carrierOptions); }
  catch (error) {
    return finishClaim(root, claim, baseReceipt(binding, frozen.manifest.sessionId, "no_start", { reason: error.code || "carrier_unavailable", retentionClass }), frozen.bundle);
  }
  const oracleHome = ensureChild(root, "oracle-home");
  const args = ["--engine", "browser", "--model", FIXED_MODEL, "--retain-hours", String(frozen.manifest.arguments.retainHours), "--slug", frozen.manifest.sessionId, "-p", readBoundedRegular(frozen.promptPath, MAX_PROMPT_BYTES, "frozen_input_changed").toString("utf8")];
  for (const file of frozen.files) args.push("--file", file.bundlePath);
  revalidateFrozen(frozen);
  revalidate(carrier);
  const spawnOptions = { encoding: "utf8", env: fixedEnvironment(oracleHome), timeout: boundedTimeout(input.timeoutMs), maxBuffer: MAX_RESULT_BYTES };
  const dryRun = run(carrier.binary, ["--dry-run", "summary", "--files-report", ...args], spawnOptions);
  if (dryRun.status !== 0) return finishClaim(root, claim, baseReceipt(binding, frozen.manifest.sessionId, "no_start", { reason: "oracle_dry_run_failed", carrierVersion: carrier.version, retentionClass }), frozen.bundle);

  revalidateFrozen(frozen);
  revalidate(carrier);
  const result = run(carrier.binary, args, spawnOptions);
  const output = String(result.stdout || "");
  const diagnostic = `${output}\n${String(result.stderr || "")}`;
  if (result.error?.code === "ETIMEDOUT") {
    return finishClaim(root, claim, baseReceipt(binding, frozen.manifest.sessionId, "started", { reason: "detached", carrierVersion: carrier.version, retentionClass }), null);
  }
  if (result.status !== 0 && detectAuthSurface(diagnostic)) {
    return finishClaim(root, claim, baseReceipt(binding, frozen.manifest.sessionId, "settled", { reason: "auth_context_unavailable", authReadiness: "unknown", carrierVersion: carrier.version, retentionClass }), frozen.bundle);
  }
  let resultArtifact;
  let reason = result.status === 0 ? null : "oracle_failed";
  try { if (output) resultArtifact = persistResult(root, frozen.manifest.sessionId, output); }
  catch (error) { reason = error.code; }
  return finishClaim(root, claim, baseReceipt(binding, frozen.manifest.sessionId, "settled", {
    reason,
    carrierVersion: carrier.version,
    authReadiness: result.status === 0 ? "fresh_success" : "unknown",
    retentionClass,
    resultArtifact,
  }), frozen.bundle);
}

function acquireReattachLock(lock, expected, now = Date.now()) {
  const value = {
    version: 1,
    kind: "oracle_reattach_lock",
    claimId: expected.claimId,
    sessionId: expected.sessionId,
    frozenInputDigest: expected.frozenInputDigest,
    createdAt: new Date(now).toISOString(),
    expiresAt: expected.expiresAt,
  };
  try {
    return { owner: true, identity: writeExclusive(lock, JSON.stringify(value)) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const opened = readJsonRegularWithIdentity(lock);
    const existing = opened.value;
    const expiresAt = Date.parse(existing?.expiresAt);
    if (existing?.version !== 1
      || existing?.kind !== "oracle_reattach_lock"
      || existing?.claimId !== expected.claimId
      || existing?.sessionId !== expected.sessionId
      || existing?.frozenInputDigest !== expected.frozenInputDigest
      || !Number.isFinite(expiresAt)) fail("unsafe_private_state");
    if (expiresAt > now) return { owner: false, identity: opened.identity };
    unlinkRegularIdentity(lock, opened.identity);
    return { owner: true, identity: writeExclusive(lock, JSON.stringify(value)) };
  }
}

export function reattach(input, options = {}) {
  assertRouteShape(input);
  const root = ensureRoot(options.root || routeRoot());
  cleanupExpiredArtifacts(root);
  const id = claimId(input);
  const claimPath = claimFile(root, id);
  const claimState = readJsonRegular(claimPath);
  if (claimState.state === "expired") fail("session_expired");
  if (claimState.kind !== "review" || claimState.state !== "started" || typeof claimState.receiptId !== "string") fail("session_not_reattachable");
  const prior = readJsonRegular(receiptFile(root, claimState.receiptId));
  if (prior.reason !== "detached" || prior.sessionId !== input.sessionId) fail("session_not_reattachable");
  const binding = inspectBinding(input, prior.frozenInputDigest, options);
  const lock = `${claimPath}.reattach`;
  const sessionExpiry = Date.parse(prior.expiresAt);
  if (!Number.isFinite(sessionExpiry) || sessionExpiry <= Date.now()) fail("session_expired");
  const lockExpiry = new Date(Math.min(sessionExpiry, Date.now() + boundedTimeout(input.timeoutMs) + 60_000)).toISOString();
  const acquired = acquireReattachLock(lock, {
    claimId: id,
    sessionId: input.sessionId,
    frozenInputDigest: prior.frozenInputDigest,
    expiresAt: lockExpiry,
  });
  if (!acquired.owner) {
    const ambiguous = baseReceipt(binding, input.sessionId, "ambiguous", {
      receiptId: opaqueId("receipt", `${id}:${prior.frozenInputDigest}:reattach:ambiguous`),
      reason: "reattach_in_progress",
      retentionClass: prior.retentionClass,
      expiresAt: prior.expiresAt,
    });
    try { return persistReceipt(root, ambiguous); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      return readJsonRegular(receiptFile(root, ambiguous.receiptId));
    }
  }
  try {
    const resolve = options.resolveCarrier || resolveCarrier;
    const revalidate = options.revalidateCarrier || revalidateExecutable;
    const carrier = resolve(options.carrierOptions);
    revalidate(carrier);
    const oracleHome = ensureChild(root, "oracle-home");
    const result = (options.run || spawnSync)(carrier.binary, ["session", input.sessionId, "--render"], {
      encoding: "utf8", env: fixedEnvironment(oracleHome), timeout: boundedTimeout(input.timeoutMs), maxBuffer: MAX_RESULT_BYTES,
    });
    let status = "settled";
    let reason = result.status === 0 ? null : "oracle_failed";
    let resultArtifact;
    if (result.error?.code === "ETIMEDOUT") { status = "started"; reason = "detached"; }
    else if (result.status !== 0 && detectAuthSurface(`${result.stdout || ""}\n${result.stderr || ""}`)) reason = "auth_context_unavailable";
    else {
      try { if (result.stdout) resultArtifact = persistResult(root, input.sessionId, String(result.stdout)); }
      catch (error) { reason = error.code; }
    }
    const value = persistReceipt(root, baseReceipt(binding, input.sessionId, status, {
      reason,
      carrierVersion: carrier.version,
      resultArtifact,
      reattached: true,
      retentionClass: prior.retentionClass,
      expiresAt: prior.expiresAt,
    }));
    replaceRegularJson(claimPath, { ...claimState, state: status, receiptId: value.receiptId });
    if (status === "settled") removePrivateBundle(root, input.sessionId);
    return value;
  } finally {
    if (fs.existsSync(lock)) unlinkRegularIdentity(lock, acquired.identity);
  }
}

export function lifecycle(input, options = {}) {
  if (input.contractVersion !== CONTRACT) fail("lifecycle_claim_required");
  const root = ensureRoot(options.root || routeRoot());
  cleanupExpiredArtifacts(root);
  const binding = inspectBinding(input, input.frozenInputDigest, options, true);
  const claim = beginClaim(root, binding, binding.dispatchIdentity.sessionId, "lifecycle");
  if (!claim.owner) return retryReceipt(root, claim);
  let beforeVersion = null;
  try { beforeVersion = (options.resolveCarrier || resolveCarrier)(options.carrierOptions).version; }
  catch (error) {
    if (error.code === "oracle_version_unsupported" && /^\d+\.\d+\.\d+$/.test(error.installedVersion || "") && !atLeast(parseVersion(error.installedVersion))) beforeVersion = error.installedVersion;
    else if (error.code !== "oracle_not_installed") return finishClaim(root, claim, baseReceipt(binding, claim.value.sessionId, "no_start", { reason: error.code }), null);
  }
  const brew = (options.resolveBrew || resolveBrew)();
  (options.revalidateCarrier || revalidateExecutable)(brew);
  const operation = beforeVersion === null ? "install" : "upgrade";
  const result = (options.run || spawnSync)(brew.binary, [operation, FORMULA], { encoding: "utf8", env: { PATH: SAFE_PATH }, maxBuffer: 256 * 1024 });
  if (result.status !== 0) return finishClaim(root, claim, baseReceipt(binding, claim.value.sessionId, "settled", { reason: "lifecycle_failed", beforeVersion }), null);
  const afterVersion = (options.resolveCarrier || resolveCarrier)(options.carrierOptions).version;
  return finishClaim(root, claim, baseReceipt(binding, claim.value.sessionId, "settled", { reason: null, beforeVersion, afterVersion, formula: FORMULA, freshReviewRequired: true }), null);
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const operation = { build, "dry-run": build, validate, dispatch, reattach, lifecycle }[process.argv[2] || "build"];
    if (!operation) fail("unsupported_action");
    process.stdout.write(`${JSON.stringify(operation(input))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "blocked", reason: error.code || "invalid_request" })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
