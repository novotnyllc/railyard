#!/usr/bin/env node
// PreToolUse for native subagent dispatch: Claude Code Agent/Task and Codex
// spawn_agent. Records each allowed dispatch in the run log for
// railyard:audit. The tool schemas own model and effort validation; an omitted
// model or effort means inheritance and is logged, never refused.
//
// One refusal remains: a Codex full-history fork cannot honor model or
// reasoning_effort overrides, so the native tool would silently drop them.
const { record, clip } = require("./run-log.js");
const { readHookInput } = require("./hook-input.js");

// Codex 0.154+ emits agentsspawn_agent (V2); the V1 CLI emits spawn_agent.
// See docs/agents/native-dispatch.md in the source repository.
const CODEX_TOOLS = new Set(["spawn_agent", "agentsspawn_agent"]);
const CLAUDE_TOOLS = new Set(["Agent", "Task"]);

function codexForkRefusal(tool, args) {
  if (!Object.hasOwn(args, "model") && !Object.hasOwn(args, "reasoning_effort")) return null;
  const v2 = tool !== "spawn_agent" || Object.hasOwn(args, "task_name") || Object.hasOwn(args, "fork_turns");
  if (v2 && (args.fork_turns === undefined || args.fork_turns === "all")) {
    return 'a full-history fork (fork_turns "all" or omitted) ignores model and reasoning_effort. '
      + 'Omit both to inherit, or set fork_turns to "none" or a turn count and give a self-contained brief.';
  }
  if (!v2 && args.fork_context === true) {
    return "a full-history fork (fork_context true) ignores model and reasoning_effort. "
      + "Omit both to inherit, or set fork_context false and give a self-contained brief.";
  }
  return null;
}

function handlePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const codex = CODEX_TOOLS.has(tool);
  if (!codex && !CLAUDE_TOOLS.has(tool)) return;
  const args = input.tool_input && typeof input.tool_input === "object" && !Array.isArray(input.tool_input)
    ? input.tool_input : {};

  if (codex) {
    const refusal = codexForkRefusal(tool, args);
    if (refusal) {
      process.stderr.write("[railyard] Dispatch refused: " + refusal + "\n");
      process.exitCode = 2;
      return;
    }
  }

  const model = clip(args.model);
  const effort = codex ? clip(args.reasoning_effort, 20) : undefined;
  record({
    event: "dispatch",
    phase: "pre_tool_use",
    tool,
    harness: codex ? "codex" : "claude-code",
    session_id: clip(input.session_id),
    allocation: model || effort ? "explicit" : "inherit",
    // For inheritance, Codex reports the parent's model in the payload.
    model: model || (codex ? clip(input.model) : undefined),
    effort,
    reasoning_effort: effort,
    role: clip(codex ? args.agent_type : args.subagent_type, 60),
    label: clip(codex ? args.task_name : args.description),
    fork_turns: codex ? clip(args.fork_turns) : undefined,
  });
}

readHookInput(handlePayload);
