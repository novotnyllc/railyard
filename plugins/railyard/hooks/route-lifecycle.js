#!/usr/bin/env node
// SubagentStart/SubagentStop lifecycle hooks for the route-carrier protocol.
//
// SubagentStart: binds a pending_spawn route to the actual agent_id, proving
//   the carrier mechanically started. Transitions to carrier_started and
//   injects route context into the child.
//
// SubagentStop: rejects premature carrier termination. An LFG carrier that
// stops at an intermediate state (plan_complete, review_pending, etc.) is
// continued with decision:block until it reaches lfg_complete, blocked, or
// failed, or hits its continuation budget.
//
// Both hooks are best-effort on injection but fail-closed on lifecycle
// enforcement when a route exists for this agent.
const path = require("path");
const rs = require("./route-state.js");

const MAX_CONTINUATIONS = 10;

function handleStart(payload) {
  var agentId = payload.agent_id || payload.session_id || null;
  if (!agentId) return { continue_: true };
  var route = rs.getActiveRoute(payload.parent_session_id || payload.session_id || null);
  // Find pending_spawn routes from any session — the child may run in its
  // own session context. Match by state, not by parent_session_id here,
  // because the parent session created the route but the child gets a new
  // agent_id at spawn time.
  if (!route || route.state !== "pending_spawn") return { continue_: true };
  rs.transition(route.route_id, "carrier_started", { agent_id: agentId });
  return {
    continue_: true,
    hookSpecificOutput: {
      additionalContext:
        "[railyard] Route-carrier protocol active (route " + route.route_id.slice(0, 8) + ").\n" +
        "You are the LFG delivery carrier. Execute compound-engineering:lfg through\n" +
        "its full pipeline: plan, work, simplify, review, test, commit/push/PR, babysit.\n" +
        "Record stage receipts:\n" +
        "  node " + path.join(__dirname, "route-state.js") + " receipt <route-id> <event> [--key value]\n" +
        "Stage receipts: plan_complete, work_complete, review_complete, browser_complete, pr_create_ready --head-sha <sha> --branch <branch>\n" +
        "Terminal states: lfg_complete | blocked --reason <why>\n" +
        "Do NOT return early at plan/review/PR checkpoints. The SubagentStop gate\n" +
        "will block premature termination and force continuation.",
    },
  };
}

// handleStop: enforce lifecycle on subagent termination.
function handleStop(payload) {
  var agentId = payload.agent_id || payload.session_id || null;
  if (!agentId) return {};
  var route = rs.findByAgent(agentId) || findByAgentAnyState(agentId);
  if (!route) return {};

  // lfg_complete requires feedback_resolved receipt
  if (route.state === "lfg_complete") {
    var hasFeedbackResolved = false;
    for (var ri = 0; ri < (route.receipts || []).length; ri++) {
      if (route.receipts[ri].event === "feedback_resolved") { hasFeedbackResolved = true; break; }
    }
    if (!hasFeedbackResolved) {
      var fbRoute = rs.readRoute(route.route_id);
      if (fbRoute) {
        fbRoute.continuations = (fbRoute.continuations || 0) + 1;
        if (fbRoute.continuations > MAX_CONTINUATIONS) {
          rs.transition(route.route_id, "failed", { failure_reason: "feedback_continuation_cap_exhausted" });
          return {};
        }
        rs.writeRoute(fbRoute);
      }
      return { decision: "block", reason: "[railyard] lfg_complete requires a feedback_resolved receipt. Dispatch ce-resolve-pr-feedback and record feedback_resolved before completing." };
    }
  }

  // Terminal states allow return.
  if (rs.TERMINAL_STATES.has(route.state)) return {};

  // Intermediate state: block and continue the carrier.
  var freshRoute = rs.readRoute(route.route_id);
  if (!freshRoute) return {};
  freshRoute.continuations = (freshRoute.continuations || 0) + 1;
  if (freshRoute.continuations > MAX_CONTINUATIONS) {
    rs.transition(route.route_id, "failed", { failure_reason: "continuation_budget_exhausted after " + MAX_CONTINUATIONS });
    return {};
  }
  rs.writeRoute(freshRoute);
  rs.recordReceipt(route.route_id, { event: "premature_stop", attempt: route.continuations, last_state: route.state });

  var reason = "[railyard] Route-carrier incomplete: current state is '" + route.state + "'.\n" +
    "The LFG pipeline requires completion through commit/push/PR and babysit\n" +
    "settlement before this subagent may terminate. Continue the pipeline.\n" +
    "Record your next receipt:\n" +
    "  node " + path.join(__dirname, "route-state.js") + " receipt " + route.route_id + " <event>\n" +
    "If genuinely blocked (not merely at a checkpoint), record:\n" +
    "  node " + path.join(__dirname, "route-state.js") + " transition " + route.route_id + " blocked\n" +
    "Then include the reason in your final message.";
  return { decision: "block", reason: reason };
}

// Find a route by agent_id including terminal states.
function findByAgentAnyState(agentId) {
  try {
    var dir = rs.stateDir();
    var files = require('fs').readdirSync(dir).filter(function(f) { return f.endsWith('.json') && !f.startsWith('candidate-'); });
    for (var i = 0; i < files.length; i++) {
      var r = rs.readRoute(files[i].replace('.json', ''));
      if (r && r.agent_id === agentId) return r;
    }
  } catch {}
  return null;
}


var input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", function(chunk) { input += chunk; });
process.stdin.on("end", function() {
  var payload = {};
  try { payload = JSON.parse(input) || {}; } catch {}
  var event = process.argv[2] || "";
  var result = {};
  try {
    if (event === "start") result = handleStart(payload);
    else if (event === "stop") result = handleStop(payload);
  } catch {}
  process.stdout.write(JSON.stringify(result));
});
