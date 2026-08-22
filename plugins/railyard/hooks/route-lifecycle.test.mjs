import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lifecycle = path.join(__dirname, "route-lifecycle.js");
const rs = await import("./route-state.js");

function runLifecycle(event, payload, stateDir) {
  const r = spawnSync(process.execPath, [lifecycle, event], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, RAILYARD_ROUTE_STATE_DIR: stateDir },
  });
  let result = {};
  try { result = JSON.parse(r.stdout || "{}"); } catch {}
  return { output: result, code: r.status, stderr: r.stderr };
}

test("SubagentStart on pending_spawn binds agent_id and transitions to carrier_started", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-start-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const route = rs.createRoute({ session_id: "parent" });
  assert.equal(route.state, "pending_spawn");
  const r = runLifecycle("start", { agent_id: "agent-1" }, dir);
  assert.equal(r.output.continue_, true);
  assert.ok(r.output.hookSpecificOutput);
  const updated = rs.readRoute(route.route_id);
  assert.equal(updated.state, "carrier_started");
  assert.equal(updated.agent_id, "agent-1");
  rmSync(dir, { recursive: true, force: true });
});

test("SubagentStop at intermediate state blocks with continuation", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-stop-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const route = rs.createRoute({});
  rs.transition(route.route_id, "carrier_started", { agent_id: "a1" });
  const r = runLifecycle("stop", { agent_id: "a1" }, dir);
  assert.equal(r.output.decision, "block");
  assert.match(r.output.reason, /Route-carrier incomplete/);
  rmSync(dir, { recursive: true, force: true });
});

test("SubagentStop at terminal lfg_complete allows return", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-done-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const route = rs.createRoute({});
  rs.transition(route.route_id, "carrier_started", { agent_id: "a1" });
  rs.transition(route.route_id, "lfg_complete");
  const r = runLifecycle("stop", { agent_id: "a1" }, dir);
  assert.deepEqual(r.output, {});
  rmSync(dir, { recursive: true, force: true });
});

test("SubagentStop with no bound agent returns empty", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-noagent-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  rs.createRoute({});
  const r = runLifecycle("stop", { agent_id: null }, dir);
  assert.deepEqual(r.output, {});
  rmSync(dir, { recursive: true, force: true });
});

test("Continuation budget exhausted transitions to failed and allows stop", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-budget-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const route = rs.createRoute({});
  rs.transition(route.route_id, "carrier_started", { agent_id: "a1" });
  const updated = rs.readRoute(route.route_id);
  updated.continuations = 11;
  rs.writeRoute(updated);
  const r = runLifecycle("stop", { agent_id: "a1" }, dir);
  const final = rs.readRoute(route.route_id);
  assert.equal(final.state, "failed");
  assert.deepEqual(r.output, {});
  rmSync(dir, { recursive: true, force: true });
});

test("SubagentStart with no pending_spawn route is a no-op", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lc-noroute-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r = runLifecycle("start", { agent_id: "agent-x" }, dir);
  assert.equal(r.output.continue_, true);
  assert.equal(r.output.hookSpecificOutput, undefined);
  rmSync(dir, { recursive: true, force: true });
});
