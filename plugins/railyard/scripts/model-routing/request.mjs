/** Request-envelope validation. */

import {
  boundedIssue,
  error,
  isKnownCarrier,
  isObject,
  onlyFields,
  ownEntries,
  r52Ready,
  validContextFork,
  validDigest,
  validEffort,
  validId,
  validIsoInstant,
  validMeterMap,
  validModel,
  validPolicyDigest,
  validR52Readiness,
  validRole,
  validScope,
  validShape,
} from "./bounds.mjs";
import {
  validWorkContractInput,
} from "./catalog.mjs";
import {
  ADAPTER_DESCRIPTORS,
  BUDGET_EFFECTS,
  CALLER_KINDS,
  CONTRACT_VERSION,
  DISPATCH_KINDS,
  HARNESS_KINDS,
  LOCALITY_RANK,
  MAX_LEASE_SLOTS,
  RETENTION_RANK,
} from "./registries.mjs";
import {
  validCeSeam,
  validDispatchIdentity,
} from "./state-schema.mjs";

export function normalizeCommand(input) {
  if (input.command === "learning" && typeof input.operation === "string") return `learning.${input.operation}`;
  return input.command;
}

export function validateRequestPrivacy(privacy) {
  return privacy === undefined || (onlyFields(privacy, new Set(["egress", "allowedProviders", "locality", "retention"])) && (privacy.egress === undefined || typeof privacy.egress === "boolean") && (privacy.locality === undefined || Object.hasOwn(LOCALITY_RANK, privacy.locality)) && (privacy.retention === undefined || Object.hasOwn(RETENTION_RANK, privacy.retention)) && (privacy.allowedProviders === undefined || (Array.isArray(privacy.allowedProviders) && privacy.allowedProviders.length > 0 && new Set(privacy.allowedProviders).size === privacy.allowedProviders.length && privacy.allowedProviders.every(validId))));
}

export function validateRuntime(runtime) {
  // Runtime availability is attested by a fixed host integration, never by
  // caller JSON.  Keeping the field invalid rather than silently ignoring it
  // prevents a request from selecting a Terra substitution for itself.
  return runtime === undefined;
}

export function validateTransport(transport) {
  // Cross-provider compatibility is likewise an embedding-owned measured
  // fact.  A caller cannot request a native or visible-provider path.
  return transport === undefined;
}

export function validatePriorRoute(value) {
  return isObject(value) && onlyFields(value, new Set(["reservationId", "claimId", "carrierId", "model", "effort", "adapterId", "adapterVersion", "policyDigest", "hostScope", "accountScope", "sessionId", "toolId", "toolVersion", "workClassDigest", "r52Digest"])) && validId(value.reservationId) && validId(value.claimId) && isKnownCarrier(value.carrierId) && validModel(value.model) && validEffort(value.effort) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validId(value.adapterVersion) && validPolicyDigest(value.policyDigest) && validId(value.hostScope) && validId(value.accountScope) && validId(value.sessionId) && validId(value.toolId) && validId(value.toolVersion) && validDigest(value.workClassDigest) && (value.r52Digest === undefined || validDigest(value.r52Digest));
}

export function validateBudgetScopes(value) {
  if (value === undefined) return true;
  if (!onlyFields(value, new Set(["task", "run", "project"]))) return false;
  return ownEntries(value).every(([kind, id]) => ["task", "run", "project"].includes(kind) && validId(id));
}

export function validateAuthorityInput(value) {
  const fields = new Set(["authorityId", "objectiveEpoch", "objectiveDigest", "senderOwner", "accountScope", "carrierId", "adapterId", "policyDigest", "destinationScope", "destinationClass", "maxTaskCount", "currentTurn", "expiresAt", "explicitUserInstructionDigest"]);
  return isObject(value) && onlyFields(value, fields) && validId(value.authorityId) && validId(value.objectiveEpoch) && validDigest(value.objectiveDigest) && validId(value.senderOwner) && validId(value.accountScope) && isKnownCarrier(value.carrierId) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validPolicyDigest(value.policyDigest) && validId(value.destinationScope) && ["visible_task", "delegated_slot"].includes(value.destinationClass) && Number.isInteger(value.maxTaskCount) && value.maxTaskCount >= 1 && value.maxTaskCount <= MAX_LEASE_SLOTS && validId(value.currentTurn) && validIsoInstant(value.expiresAt) && validDigest(value.explicitUserInstructionDigest);
}

export function validateLeaseInput(value) {
  const fields = new Set(["leaseId", "issuerScope", "allocatorScopes", "destinationScope", "destinationAccountScope", "epochId", "expiresAt", "carrierId", "adapterId", "ceiling", "maxSlots", "allocatorReceiptDigest"]);
  return isObject(value) && onlyFields(value, fields) && validId(value.leaseId) && validId(value.issuerScope) && validateBudgetScopes(value.allocatorScopes) && Object.keys(value.allocatorScopes || {}).length > 0 && validId(value.destinationScope) && validId(value.destinationAccountScope) && validId(value.epochId) && validIsoInstant(value.expiresAt) && isKnownCarrier(value.carrierId) && Boolean(ADAPTER_DESCRIPTORS[value.adapterId]) && validMeterMap(value.ceiling) && Number.isInteger(value.maxSlots) && value.maxSlots >= 1 && value.maxSlots <= MAX_LEASE_SLOTS && validDigest(value.allocatorReceiptDigest);
}

export function validateLeaseReference(value) {
  return isObject(value) && onlyFields(value, new Set(["leaseId", "destinationScope", "destinationAccountScope"])) && validId(value.leaseId) && validId(value.destinationScope) && validId(value.destinationAccountScope);
}

export function validateRequest(input, command) {
  if (!isObject(input)) return error("invalid_request");
  if (input.contractVersion !== CONTRACT_VERSION) return error("unsupported_contract_version", { expected: CONTRACT_VERSION });
  const bounded = boundedIssue(input);
  if (bounded) return error(bounded);
  const commands = new Set(["validate", "resolve", "admit", "claim-dispatch", "reconcile", "status", "inspect-claim", "refresh", "mint-task-authority", "issue-lease", "accept-lease", "claim-slot", "release-lease", "seal-epoch", "build-work-contract", "learning.inspect", "learning.clear", "learning.disable", "learning.enable"]);
  if (!commands.has(command)) return error("unknown_command");
  const allowed = new Set(["contractVersion", "command", "operation", "callerKind", "role", "adapterId", "dispatchKind", "budgetEffect", "effort", "workShape", "workClassDigest", "priorWorkClassDigest", "contextFork", "r52", "requestId", "actionId", "privacy", "runtime", "risk", "contextClass", "complex", "explicitModelRequirement", "transport", "scope", "scopes", "forecast", "activeReservationId", "bridgeLifecycleId", "taskAuthorityId", "objectiveEpoch", "objectiveDigest", "instructionDigest", "senderOwner", "hostScope", "accountScope", "dispatchIdentity", "destinationScope", "destinationClass", "currentTurn", "postLifecycleRequirementId", "frozenInputDigest", "reservationId", "claimId", "receipt", "remoteProbe", "capability", "ceSeam", "priorRoute", "authority", "lease", "epochId", "workContract", "harness", "crossHarnessReason"]);
  if (!onlyFields(input, allowed)) return error("unknown_request_field");
  if (input.role !== undefined && !validRole(input.role)) return error("invalid_role");
  if (input.callerKind !== undefined && !CALLER_KINDS.has(input.callerKind)) return error("invalid_caller_kind");
  if (input.harness !== undefined && !HARNESS_KINDS.has(input.harness)) return error("invalid_harness");
  if (input.crossHarnessReason !== undefined && (typeof input.crossHarnessReason !== "string" || input.crossHarnessReason.trim().length < 8 || input.crossHarnessReason.length > 256 || input.crossHarnessReason.trim().toLowerCase() === "not_applicable")) return error("invalid_cross_harness_reason");
  if (input.crossHarnessReason !== undefined && input.harness === undefined) return error("harness_required_for_cross_harness_reason");
  if (input.adapterId !== undefined && !validId(input.adapterId)) return error("invalid_adapter");
  if (input.dispatchKind !== undefined && !DISPATCH_KINDS.has(input.dispatchKind)) return error("invalid_dispatch_kind");
  if (input.budgetEffect !== undefined && !BUDGET_EFFECTS.has(input.budgetEffect)) return error("invalid_budget_effect");
  if (input.effort !== undefined && !validEffort(input.effort)) return error("invalid_effort");
  if (!validContextFork(input.contextFork)) return error("invalid_context_fork");
  if (input.contextFork !== undefined && (input.adapterId !== "native-subagent-create" || (input.dispatchKind !== undefined && input.dispatchKind !== "subagent_create"))) return error("invalid_context_fork");
  if (input.r52 !== undefined && !validR52Readiness(input.r52)) return error("invalid_r52_readiness");
  // Readiness is bound into the decision — and thence into reservation, claim,
  // and receipt digests — for every caller, not just fleet. Gating on
  // callerKind froze "blocked" readiness into a resolved deliver decision.
  // Fleet must supply it; anyone who supplies it must supply a ready one.
  if (["resolve", "admit"].includes(command)
    && (input.callerKind === "fleet" || input.r52 !== undefined)
    && !r52Ready(input.r52)) return error("model_routing_capability_unavailable");
  const shapeIssue = validShape(input.workShape);
  if (shapeIssue) return error(shapeIssue);
  if (input.requestId !== undefined && !validId(input.requestId)) return error("invalid_request_id");
  if (input.actionId !== undefined && !validId(input.actionId)) return error("invalid_action_id");
  if (!validateRequestPrivacy(input.privacy)) return error("invalid_privacy");
  if (!validateRuntime(input.runtime)) return error("invalid_runtime");
  if (!validateTransport(input.transport)) return error("invalid_transport");
  if (input.scope !== undefined && !validScope(input.scope)) return error("invalid_budget_scope");
  if (!validateBudgetScopes(input.scopes)) return error("invalid_budget_scopes");
  if (input.forecast !== undefined && !validMeterMap(input.forecast)) return error("invalid_forecast");
  if (input.activeReservationId !== undefined && !validId(input.activeReservationId)) return error("invalid_reservation_id");
  if (input.reservationId !== undefined && !validId(input.reservationId)) return error("invalid_reservation_id");
  if (input.claimId !== undefined && !validId(input.claimId)) return error("invalid_claim_id");
  if (input.taskAuthorityId !== undefined && !validId(input.taskAuthorityId)) return error("invalid_task_authority_id");
  if (input.objectiveEpoch !== undefined && !validId(input.objectiveEpoch)) return error("invalid_objective_epoch");
  if (input.senderOwner !== undefined && !validId(input.senderOwner)) return error("invalid_sender_owner");
  if (input.hostScope !== undefined && !validId(input.hostScope)) return error("invalid_host_scope");
  if (input.accountScope !== undefined && !validId(input.accountScope)) return error("invalid_account_scope");
  if (input.dispatchIdentity !== undefined && !validDispatchIdentity(input.dispatchIdentity)) return error("invalid_dispatch_identity");
  if (input.destinationScope !== undefined && !validId(input.destinationScope)) return error("invalid_destination_scope");
  if (input.destinationClass !== undefined && !["visible_task", "delegated_slot"].includes(input.destinationClass)) return error("invalid_destination_class");
  if (input.currentTurn !== undefined && !validId(input.currentTurn)) return error("invalid_current_turn");
  if (input.postLifecycleRequirementId !== undefined && !validId(input.postLifecycleRequirementId)) return error("invalid_lifecycle_requirement");
  if (input.contextClass !== undefined && !validId(input.contextClass)) return error("invalid_context_class");
  if (input.workClassDigest !== undefined && !validDigest(input.workClassDigest)) return error("invalid_work_class_digest");
  if (input.priorWorkClassDigest !== undefined && !validDigest(input.priorWorkClassDigest)) return error("invalid_prior_work_class_digest");
  if (input.objectiveDigest !== undefined && !validDigest(input.objectiveDigest)) return error("invalid_objective_digest");
  if (input.instructionDigest !== undefined && !validDigest(input.instructionDigest)) return error("invalid_instruction_digest");
  if (input.frozenInputDigest !== undefined && !validDigest(input.frozenInputDigest)) return error("invalid_frozen_input_digest");
  if (input.ceSeam !== undefined && !validCeSeam(input.ceSeam)) return error("invalid_ce_seam");
  if (input.ceSeam !== undefined && input.callerKind !== "compound-engineering") return error("ce_seam_caller_required");
  if (input.callerKind === "compound-engineering" && input.ceSeam === undefined && ["resolve", "admit"].includes(command)) return error("ce_seam_required");
  if (input.priorRoute !== undefined && !validatePriorRoute(input.priorRoute)) return error("invalid_prior_route");
  if (input.authority !== undefined && !validateAuthorityInput(input.authority)) return error("invalid_task_authority");
  if (input.authority !== undefined && command !== "mint-task-authority") return error("raw_task_authority_forbidden");
  if (input.lease !== undefined && !((command === "issue-lease" && validateLeaseInput(input.lease)) || (["accept-lease", "claim-slot", "release-lease"].includes(command) && validateLeaseReference(input.lease)))) return error("invalid_lease");
  if (input.epochId !== undefined && !validId(input.epochId)) return error("invalid_epoch_id");
  if (command === "build-work-contract" && !validWorkContractInput(input.workContract)) return error("invalid_work_contract");
  return null;
}
