#!/usr/bin/env node

/**
 * The model-routing contract is deliberately a policy/state primitive.  It
 * never creates a task or reads an installed plugin cache. Its public stdin
 * CLI may make one bounded local Codex model-list observation for a stale
 * Daybreak security resolve; callers still execute claimed decisions with
 * their own fixed adapter and return a trusted receipt for reconciliation.
 *
 * This file is the stable entry point: `node scripts/model-routing.mjs` with a
 * bounded JSON request on stdin, and the import surface every caller and test
 * uses.  The implementation lives in `model-routing/`.
 */

import { main } from "./model-routing/cli.mjs";

export * from "./model-routing/admit.mjs";
export * from "./model-routing/authority.mjs";
export * from "./model-routing/bounds.mjs";
export * from "./model-routing/budget.mjs";
export * from "./model-routing/catalog.mjs";
export * from "./model-routing/cli.mjs";
export * from "./model-routing/decision.mjs";
export * from "./model-routing/daybreak-availability.mjs";
export * from "./model-routing/disclosure.mjs";
export * from "./model-routing/dispatch.mjs";
export * from "./model-routing/learning.mjs";
export * from "./model-routing/leases.mjs";
export * from "./model-routing/paths.mjs";
export * from "./model-routing/queries.mjs";
export * from "./model-routing/receipts.mjs";
export * from "./model-routing/registries.mjs";
export * from "./model-routing/request.mjs";
export * from "./model-routing/select.mjs";
export * from "./model-routing/state-schema.mjs";
export * from "./model-routing/store.mjs";

if (import.meta.url === new URL(process.argv[1], "file:").href) void main();
