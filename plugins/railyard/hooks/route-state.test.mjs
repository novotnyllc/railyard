import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mod = await import("./route-state.js");

function freshDir() {
  return mkdtempSync(path.join(tmpdir(), "route-state-"));
}

test("createRoute produces a pending_spawn route with protocol", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r = mod.createRoute({ session_id: "s1", label: "test" });
  assert.equal(r.protocol, "railyard.route-carrier/v1");
  assert.equal(r.state, "pending_spawn");
  assert.equal(r.parent_session_id, "s1");
  assert.ok(r.route_id);
  rmSync(dir, { recursive: true, force: true });
});

test("transition moves state and persists", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r = mod.createRoute({});
  const t = mod.transition(r.route_id, "carrier_started", { agent_id: "a1" });
  assert.equal(t.state, "carrier_started");
  assert.equal(t.agent_id, "a1");
  const back = mod.readRoute(r.route_id);
  assert.equal(back.state, "carrier_started");
  rmSync(dir, { recursive: true, force: true });
});

test("getActiveRoute finds non-terminal routes for a session", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r1 = mod.createRoute({ session_id: "s1" });
  const r2 = mod.createRoute({ session_id: "s2" });
  mod.transition(r2.route_id, "lfg_complete");
  var found = mod.getActiveRoute("s1");
  assert.ok(found);
  assert.equal(found.route_id, r1.route_id);
  var found2 = mod.getActiveRoute("s2");
  assert.equal(found2, null); // Terminal
  rmSync(dir, { recursive: true, force: true });
});

test("findByAgent finds routes bound to an agent", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r = mod.createRoute({});
  mod.transition(r.route_id, "carrier_started", { agent_id: "a42" });
  var found = mod.findByAgent("a42");
  assert.ok(found);
  assert.equal(found.route_id, r.route_id);
  var notFound = mod.findByAgent("a99");
  assert.equal(notFound, null);
  rmSync(dir, { recursive: true, force: true });
});

test("recordReceipt appends to receipts array", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  const r = mod.createRoute({});
  mod.recordReceipt(r.route_id, { event: "plan_complete", path: "/tmp/plan.md" });
  var updated = mod.readRoute(r.route_id);
  assert.equal(updated.receipts.length, 1);
  assert.equal(updated.receipts[0].event, "plan_complete");
  assert.ok(updated.receipts[0].recorded_at);
  rmSync(dir, { recursive: true, force: true });
});

test("delivery candidate is recorded and found by session", () => {
  const dir = freshDir();
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  mod.recordDeliveryCandidate("sess-1", "/tmp");
  assert.ok(mod.hasDeliveryCandidate("sess-1"));
  assert.ok(!mod.hasDeliveryCandidate("sess-other"));
  rmSync(dir, { recursive: true, force: true });
});

test("unreadable state dir returns null (fail-open for push, fail-closed for pr-create via caller)", () => {
  process.env.RAILYARD_ROUTE_STATE_DIR = "/tmp/nonexistent-route-state-dir-xyz";
  var r = mod.getActiveRoute("any");
  assert.equal(r, null);
  delete process.env.RAILYARD_ROUTE_STATE_DIR;
});
