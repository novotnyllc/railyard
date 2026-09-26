#!/usr/bin/env node
// SessionStart: print a short route guide, then record a session anchor in
// the run log from the bounded hook payload.
const { readHookInput } = require("./hook-input.js");

const lines = [
  "Railyard routing:",
  "- Ordinary work uses native tools and subagents. Pick Compound Engineering stages when they help:",
  "  ce-debug, ce-plan, ce-code-review, or lfg. Open PRs with compound-engineering:ce-commit-push-pr.",
  "- CE owns review settlement and CI watching. An explicit Deliver request (railyard:deliver) runs",
  "  through merge, required release or deployment, and consumer verification unless narrowed; honor",
  "  plan-only, local-only, and PR-only stops. Merges go through deliver's CE snapshot handoff.",
  "- Choose model and effort per subagent. Claude Code: Opus 5.5 (`opus`) by default, Fable 5.1 for",
  "  frontier-hard work. Codex: GPT-6 Sol at medium, Luna for bounded work, Astra when hard.",
  "- Create visible user-owned tasks only when asked. Use railyard:orchestrate only for requested",
  "  fleet or remote work. Wait on completion events rather than polling.",
];
// Presence enables advice, not an inference call or a credential disclosure.
if (process.env.TYPESAFE_API_KEY?.trim()) {
  lines.push("- Jev is configured: use railyard:jev for model, effort, and workflow advice; explicit choices and privacy limits win.");
}
process.stdout.write(lines.join("\n") + "\n");

// The payload carries session_id and cwd. The process environment may belong
// to an ancestor, so an absent or malformed payload leaves the line unidentified.
function metadata(value, max) {
  return typeof value === "string" && value.trim() && value.length <= max ? value : undefined;
}

readHookInput((payload) => {
  const known = payload && typeof payload === "object" && !Array.isArray(payload)
    && payload.hook_event_name === "SessionStart";
  try {
    require("./run-log.js").record({
      event: "session",
      session_id: known ? metadata(payload.session_id, 120) : undefined,
      cwd: known ? metadata(payload.cwd, 4096) : undefined,
    });
  } catch {}
}, { timeoutMs: 250, maxBytes: 64 * 1024 });
