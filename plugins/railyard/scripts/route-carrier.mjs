#!/usr/bin/env node
// Skill-frame CLI for the route-carrier protocol. Provides the deterministic
// operations that the host lacks: enter a skill frame, record receipts,
// transition states, check status. Uses route-state.js as the backing store.

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const rs = require(path.join(__dirname, "../hooks/route-state.js"));

const [cmd, ...args] = process.argv.slice(2);
const sessionId = process.env.CODEX_THREAD_ID || process.env.CLAUDE_CODE_SESSION_ID || null;

function die(msg) { process.stderr.write(msg + "\n"); process.exit(1); }

if (!sessionId) die("No lane identity available. Set CODEX_THREAD_ID or CLAUDE_CODE_SESSION_ID.");

switch (cmd) {
  case "enter": {
    // route-carrier.mjs enter <label> — creates a new route frame
    const label = args[0] || null;
    if (rs.getActiveRoute(sessionId)) {
      die("[railyard] An active carrier already exists for this session. Complete or block it first.");
    }
    const route = rs.createRoute({ session_id: sessionId, label });
    console.log(JSON.stringify({ entered: true, route_id: route.route_id, state: route.state }));
    break;
  }
  case "receipt": {
    const [routeId, event] = args;
    if (!routeId || !event) die("usage: route-carrier.mjs receipt <route-id> <event> [--key value]");
    const extra = {};
    for (let i = 2; i < args.length - 1; i += 2) {
      if (args[i].startsWith("--")) extra[args[i].slice(2)] = args[i + 1];
    }
    const r = rs.recordReceipt(routeId, { event, ...extra });
    if (!r) die("route not found: " + routeId);
    console.log(JSON.stringify({ receipted: event, state: r.state }));
    break;
  }
  case "transition": {
    const [routeId, state] = args;
    if (!routeId || !state) die("usage: route-carrier.mjs transition <route-id> <state>");
    const r = rs.transition(routeId, state);
    if (!r) die("route not found: " + routeId);
    console.log(JSON.stringify({ transitioned: state, route_id: r.route_id }));
    break;
  }
  case "status": {
    const route = rs.getActiveRoute(sessionId);
    if (route) {
      console.log(JSON.stringify(route, null, 2));
    } else {
      console.log(JSON.stringify({ active: false }));
    }
    break;
  }
  case "block": {
    const [reason] = args;
    const route = rs.getActiveRoute(sessionId);
    if (!route) die("no active route for this session");
    rs.transition(route.route_id, "blocked", { block_reason: reason || "unspecified" });
    console.log(JSON.stringify({ blocked: true, route_id: route.route_id }));
    break;
  }
  default:
    die("usage: route-carrier.mjs <enter|receipt|transition|status|block> [...]");
}
