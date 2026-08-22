#!/usr/bin/env node
// Authoritative route ledger for the route-carrier protocol. Unlike
// run-log.js (best-effort audit), this state is fail-closed: a protected
// transition (git push, gh pr create, gh pr merge) that cannot verify its
// route authority is refused, not silently allowed.
// One JSON file per route in the state dir. Small, disposable, no locking.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PROTOCOL = "railyard.route-carrier/v1";
const TERMINAL_STATES = new Set(["lfg_complete", "blocked", "failed"]);

function stateDir() {
  if (process.env.RAILYARD_ROUTE_STATE_DIR) return process.env.RAILYARD_ROUTE_STATE_DIR;
  const home = os.homedir();
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || home, "railyard", "state", "route-state")
    : path.join(
        process.env.XDG_STATE_HOME || path.join(home, ".local", "state"),
        "railyard",
        "route-state",
      );
}

function newRouteId() {
  return crypto.randomUUID();
}

function routeFile(routeId) {
  return path.join(stateDir(), routeId + ".json");
}

function writeRoute(route) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(routeFile(route.route_id), JSON.stringify(route, null, 2) + "\n");
}

function readRoute(routeId) {
  try {
    return JSON.parse(fs.readFileSync(routeFile(routeId), "utf8"));
  } catch { return null; }
}

function createRoute(opts) {
  opts = opts || {};
  const now = new Date().toISOString();
  const r = {
    protocol: PROTOCOL,
    route_id: newRouteId(),
    route: opts.route || "compound-engineering:lfg",
    parent_session_id: opts.session_id || null,
    agent_id: null,
    repo_root: opts.repo_root || null,
    branch: opts.branch || null,
    label: opts.label || null,
    state: "pending_spawn",
    continuations: 0,
    receipts: [],
    created_at: now,
    updated_at: now,
  };
  writeRoute(r);
  return r;
}

function transition(routeId, newState, extra) {
  const r = readRoute(routeId);
  if (!r) return null;
  r.state = newState;
  r.updated_at = new Date().toISOString();
  if (extra) Object.assign(r, extra);
  writeRoute(r);
  return r;
}

function recordReceipt(routeId, receipt) {
  const r = readRoute(routeId);
  if (!r) return null;
  r.receipts.push(Object.assign({}, receipt, { recorded_at: new Date().toISOString() }));
  r.updated_at = new Date().toISOString();
  writeRoute(r);
  return r;
}

function getActiveRoute(sessionId) {
  try {
    const dir = stateDir();
    const files = fs.readdirSync(dir).filter(function(f) { return f.endsWith(".json") && !f.startsWith("candidate-"); });
    let best = null;
    for (var i = 0; i < files.length; i++) {
      var r = readRoute(files[i].replace(".json", ""));
      if (!r || TERMINAL_STATES.has(r.state)) continue;
      if (sessionId && r.parent_session_id !== sessionId) continue;
      if (!best || r.updated_at > best.updated_at) best = r;
    }
    return best;
  } catch { return null; }
}

function findByAgent(agentId) {
  try {
    const dir = stateDir();
    const files = fs.readdirSync(dir).filter(function(f) { return f.endsWith(".json") && !f.startsWith("candidate-"); });
    for (var i = 0; i < files.length; i++) {
      var r = readRoute(files[i].replace(".json", ""));
      if (r && r.agent_id === agentId && !TERMINAL_STATES.has(r.state)) return r;
    }
  } catch {}
  return null;
}

function candidateFile(sessionId) {
  return path.join(stateDir(), "candidate-" + (sessionId || "unknown") + ".json");
}

function recordDeliveryCandidate(sessionId, cwd) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(candidateFile(sessionId), JSON.stringify({
      session_id: sessionId || null, cwd: cwd || null,
      recorded_at: new Date().toISOString(),
    }));
  } catch {}
}

function hasDeliveryCandidate(sessionId) {
  try { return fs.existsSync(candidateFile(sessionId)); } catch { return false; }
}

module.exports = {
  PROTOCOL: PROTOCOL, TERMINAL_STATES: TERMINAL_STATES,
  stateDir: stateDir, newRouteId: newRouteId,
  createRoute: createRoute, readRoute: readRoute, writeRoute: writeRoute, transition: transition, recordReceipt: recordReceipt,
  getActiveRoute: getActiveRoute, findByAgent: findByAgent,
  recordDeliveryCandidate: recordDeliveryCandidate, hasDeliveryCandidate: hasDeliveryCandidate,
};

if (require.main === module) {
  var args = process.argv.slice(2);
  var cmd = args[0];
  var sid = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;
  if (cmd === "active") {
    var r = getActiveRoute(sid);
    process.stdout.write(r ? JSON.stringify(r, null, 2) + "\n" : "");
    process.exit(r ? 0 : 1);
  } else if (cmd === "transition" && args.length >= 3) {
    var r2 = transition(args[1], args[2]);
    process.stdout.write(r2 ? JSON.stringify(r2, null, 2) + "\n" : "");
    process.exit(r2 ? 0 : 1);
  } else if (cmd === "receipt" && args.length >= 3) {
    var routeId = args[1];
    var event = args[2];
    var extra = {};
    for (var j = 3; j < args.length - 1; j += 2) {
      if (args[j].indexOf("--") === 0) extra[args[j].slice(2)] = args[j + 1];
    }
    var r3 = recordReceipt(routeId, Object.assign({ event: event }, extra));
    process.stdout.write(r3 ? JSON.stringify(r3, null, 2) + "\n" : "");
    process.exit(r3 ? 0 : 1);
  } else if (cmd === "candidate") {
    recordDeliveryCandidate(sid, process.cwd());
    process.exit(0);
  } else {
    process.stderr.write("usage: route-state.js active|transition|receipt|candidate\n");
    process.exit(1);
  }
}
