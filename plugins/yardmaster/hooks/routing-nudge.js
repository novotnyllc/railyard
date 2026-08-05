#!/usr/bin/env node
// UserPromptSubmit: one-line just-in-time routing nudge when the prompt
// reads as delivery, planning, or orchestration intent — including when a
// conversation drifts into planning territory mid-stream ("update the
// plan", "our approach", "how should we structure this"). Silent otherwise.
// Cross-platform, dependency-free, never blocks (always exit 0).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let prompt = "";
  try {
    prompt = String(JSON.parse(raw).prompt || "");
  } catch {
    process.exit(0);
  }
  const p = prompt.trim();
  // Slash commands route themselves; very short prompts are conversation.
  if (!p || p.startsWith("/") || p.length < 12) process.exit(0);

  const orchestrate =
    /\b(orchestrate|across (my |the )?(machines|hosts|fleet)|all (the )?(macs|machines|hosts)|on (my|the) (other|remote) (mac|machine|host)|fleet-?wide)\b/i;
  // Explicit verbs plus drift signals: revising an existing plan/design,
  // weighing approaches, or requirements talk are planning territory even
  // when the conversation didn't start there.
  const planning =
    /\b(brainstorm|architect(ure)?|spec( out| for)?\b|(design|plan)\s+(a|an|the|for|out|this)\b|(update|revise|rework|refine|tweak|iterate on)\s+(the\s+|our\s+|this\s+)?(plan|design|spec|architecture)\b|(the|our|this)\s+(design|architecture|spec)\b|how (should|would|do) (we|this|it|i)\b|what'?s the (right|best) way\b|trade-?offs?\b|requirements?\s+(for|around|of)\b|approach(es)? (for|to|here)\b)/i;
  const deliver =
    /\b(implement|fix|ship|deliver|go do|build (a|the|an|me)\b|refactor|bug ?fix|deploy)\b/i;

  let line = "";
  if (orchestrate.test(p)) {
    line =
      "[yardmaster] Multi-machine/multi-task intent: route through yardmaster:orchestrate (it consults roundhouse readiness before placing work).";
  } else if (planning.test(p) && deliver.test(p)) {
    line =
      "[yardmaster] Software work intent: route through yardmaster:deliver — planning-only stops at the CE artifact; implementation runs to merge and proof.";
  } else if (planning.test(p)) {
    line =
      "[yardmaster] This is planning/brainstorming territory — even mid-conversation, load yardmaster:deliver and route to the matching CE stage (ce-brainstorm / ce-plan / ce-debug); stop at that artifact.";
  } else if (deliver.test(p)) {
    line =
      "[yardmaster] Delivery intent: route through yardmaster:deliver (model-routing intake first; ends at merge + post-merge proof unless a narrower stop is asked).";
  }
  if (line) process.stdout.write(line + "\n");
  process.exit(0);
});
