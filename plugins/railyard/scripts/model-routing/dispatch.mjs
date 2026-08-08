/** Pure command dispatcher used by tests and host adapters. */

import {
  admitInternal,
  claimInternal,
} from "./admit.mjs";
import {
  mintTaskAuthorityInternal,
} from "./authority.mjs";
import {
  error,
  result,
  stableDigest,
} from "./bounds.mjs";
import {
  buildInvariantWorkContract,
  validateCatalog,
} from "./catalog.mjs";
import {
  resolveInternal,
} from "./decision.mjs";
import {
  acceptLeaseInternal,
  claimSlotInternal,
  issueLeaseInternal,
  releaseLeaseInternal,
  sealEpochInternal,
} from "./leases.mjs";
import {
  inspectClaimInternal,
  learningInternal,
  refreshInternal,
  statusInternal,
} from "./queries.mjs";
import {
  defaultTerminalInternal,
  reconcileInternal,
} from "./receipts.mjs";
import {
  CONTRACT_VERSION,
  MUTATING_COMMANDS,
} from "./registries.mjs";
import {
  normalizeCommand,
  validateRequest,
} from "./request.mjs";
import {
  defaultRoute,
} from "./select.mjs";
import {
  createEmptyState,
  validateState,
} from "./state-schema.mjs";

/**
 * Pure command dispatcher used by tests and host adapters.  Pass an explicit
 * state object to keep tests fully offline; callers persist it with runCli.
 */
export function handleRequest(input, {
  catalog = null,
  state = createEmptyState(),
  now = Date.now(),
  platform = process.platform,
  trustedCapabilityAttestor,
  trustedReceiptImporter,
  trustedTaskAuthorityAttestor,
  trustedRuntimeAttestor,
  trustedTransportAttestor,
  fixedReceiptProducers,
  controllerRuntime,
  requireControllerRuntime = false,
} = {}) {
  const command = normalizeCommand(input || {});
  const requestIssue = validateRequest(input, command);
  if (requestIssue) return { response: requestIssue, state, changed: false };
  const catalogValidation = validateCatalog(catalog);
  if (!catalogValidation.ok) return { response: catalogValidation, state, changed: false };
  const stateValidation = validateState(state);
  if (!stateValidation.ok) return { response: stateValidation, state, changed: false };
  const mutatesState = MUTATING_COMMANDS.has(command) && !(command === "admit" && catalog === null);
  if (platform === "win32" && mutatesState) return { response: error("secure_state_unsupported"), state, changed: false };

  // Every mutating command runs against a private copy and is swapped into the
  // caller's state only once it answers ok.  A command that mutates and then
  // refuses (a burned authority on a rejected claim, a partially settled
  // reconcile) therefore leaves nothing behind, for embeddings as well as for
  // runCli — which already discarded a refused write before it reached disk.
  const working = mutatesState ? structuredClone(state) : state;

  let response;
  if (command === "validate") response = result(true, "validated", { config: catalogValidation.policy, state: { digest: stateValidation.digest } });
  else if (command === "resolve") response = resolveInternal(input, { catalog, state: working, now, trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers });
  else if (command === "admit") response = admitInternal(input, { catalog, state: working, now, trustedRuntimeAttestor, trustedTransportAttestor, fixedReceiptProducers, controllerRuntime, requireControllerRuntime });
  else if (command === "claim-dispatch") response = claimInternal(input, { catalog, state: working, now, controllerRuntime, requireControllerRuntime });
  else if (command === "mint-task-authority") response = mintTaskAuthorityInternal(input, { catalog, state: working, now, trustedTaskAuthorityAttestor, controllerRuntime, requireControllerRuntime });
  else if (command === "issue-lease") response = issueLeaseInternal(input, { catalog, state: working, now });
  else if (command === "accept-lease") response = acceptLeaseInternal(input, { catalog, state: working, now });
  else if (command === "claim-slot") response = claimSlotInternal(input, { catalog, state: working, now, controllerRuntime, requireControllerRuntime });
  else if (command === "release-lease") response = releaseLeaseInternal(input, { catalog, state: working, now });
  else if (command === "seal-epoch") response = sealEpochInternal(input, working, now);
  else if (command === "build-work-contract") response = buildInvariantWorkContract(input.workContract);
  else if (command === "reconcile") response = catalog === null && input.receipt?.kind === "default_terminal"
    ? defaultTerminalInternal(input, working, now)
    : reconcileInternal(input, { catalog, state: working, now, trustedReceiptImporter });
  else if (command === "status") response = statusInternal(working, now, catalog);
  else if (command === "inspect-claim") response = inspectClaimInternal(input, working);
  else if (command === "refresh") response = refreshInternal(input, { catalog, state: working, now, trustedCapabilityAttestor });
  else if (command?.startsWith("learning.")) response = learningInternal(command, working);
  else response = error("unknown_command");
  const changed = response.ok && response.stateChanged === true;
  if (changed) {
    const postMutation = validateState(working);
    if (!postMutation.ok) return { response: error("state_mutation_invalid", { field: postMutation.field }), state, changed: false };
  }
  if (mutatesState && response.ok) commit(state, working);
  if (Object.hasOwn(response, "stateChanged")) delete response.stateChanged;
  return { response, state, changed };
}

/** Replace the caller's state document in place, so held references stay live. */
function commit(state, working) {
  for (const key of Object.keys(state)) if (!Object.hasOwn(working, key)) delete state[key];
  Object.assign(state, working);
}

/** Offline-only benchmark receipt for the no-config selector path. */
export function measureFastPath(input, { iterations = 17, now = Date.now() } = {}) {
  if (!Number.isInteger(iterations) || iterations < 5 || iterations > 101) return error("invalid_fast_path_iterations");
  const state = createEmptyState();
  const before = stableDigest(state);
  const baselineSamples = [];
  const routedSamples = [];
  let decisionId = null;
  let baselineModel = null;
  let routedModel = null;
  for (let index = 0; index < iterations; index += 1) {
    const baselineStarted = process.hrtime.bigint();
    const baseline = defaultRoute({ ...input, command: undefined });
    if (!baseline.ok) return error("fast_path_unavailable", { cause: baseline.reason });
    baselineModel ||= baseline.model.requestedModel;
    baselineSamples.push(Number(process.hrtime.bigint() - baselineStarted) / 1_000_000);
    const started = process.hrtime.bigint();
    const handled = handleRequest({ ...input, command: "resolve" }, { state, now });
    if (!handled.response.ok || handled.changed) return error("fast_path_unavailable", { cause: handled.response.reason });
    decisionId ||= handled.response.decision.decisionId;
    routedModel ||= handled.response.decision.selected.model;
    routedSamples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
  }
  const stats = (samples) => {
    const sorted = [...samples].sort((left, right) => left - right);
    return {
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
      workflowWallMs: samples.reduce((total, value) => total + value, 0),
    };
  };
  const baseline = stats(baselineSamples);
  const routed = stats(routedSamples);
  const receipt = {
    contractVersion: CONTRACT_VERSION,
    mode: "offline_default_selector",
    iterations,
    medianMs: routed.medianMs,
    p95Ms: routed.p95Ms,
    paired: {
      baseline: { ...baseline, toolCalls: 0, externalCalls: 0, tokenDelta: 0, stateWrites: 0, model: baselineModel },
      routed: { ...routed, toolCalls: 0, externalCalls: 0, tokenDelta: 0, stateWrites: 0, model: routedModel },
      delta: {
        medianMs: routed.medianMs - baseline.medianMs,
        p95Ms: routed.p95Ms - baseline.p95Ms,
        workflowWallMs: routed.workflowWallMs - baseline.workflowWallMs,
        toolCalls: 0,
        tokenDelta: 0,
        modelChanged: baselineModel !== routedModel,
      },
    },
    stateWrites: 0,
    externalCalls: 0,
    toolCalls: 0,
    tokenDelta: 0,
    decisionId,
    modelEvidence: { baseline: baselineModel, routed: routedModel, unchanged: baselineModel === routedModel },
    writeEvidence: { stateDigestBefore: before, stateDigestAfter: stableDigest(state), writes: 0 },
    conservativeNoiseThresholdMs: { median: 50, p95: 100 },
  };
  receipt.withinNoiseBudget = receipt.medianMs <= receipt.conservativeNoiseThresholdMs.median && receipt.p95Ms <= receipt.conservativeNoiseThresholdMs.p95;
  receipt.receiptBytes = Buffer.byteLength(JSON.stringify(receipt));
  if (stableDigest(state) !== before || receipt.receiptBytes > 4096) return error("fast_path_integrity_failed");
  return result(true, "fast_path_measured", { receipt });
}
