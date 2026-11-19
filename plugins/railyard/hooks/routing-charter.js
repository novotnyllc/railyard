#!/usr/bin/env node
// SessionStart: print a short publishing guide, then record a session anchor in
// the run log from the bounded hook payload.
const { readHookInput } = require("./hook-input.js");
const { repoConfig } = require("./repo-config.js");

// Startup prints before reading input, so it reads settings for the hook's own
// folder: both harnesses start this hook in the session folder.
const config = repoConfig();

const review = {
  full: "- Before every push, load Railyard's references/whole-candidate-review.md gate, including direct CE/LFG publishing calls.",
  light: "- Before every push, including direct CE/LFG publishing calls, apply the light policy in references/whole-candidate-review.md. Run repository checks, review the whole change independently before first publication, and review affected behavior for routine repair pushes.",
  checks: "- Before every push, run the repository's checks; no review passes (railyard.review checks).",
}[config.review];
const lines = [
  "Railyard publishing:",
  review,
  "- When CE coordinates a PR, it owns review settlement and CI watching. Give it references/review-feedback-settlement.md.",
  "- Carry implementation and fixes through confirmed merge when the user or standing owner instructions authorize landing. Use the repository’s merge queue and honor holds.",
  "  For ship or deliver requests, continue through required release or deployment and verification at the consumer.",
  "  Honor plan-only, local-only, and PR-only stops.",
  "- The merge guard accepts a live check for clean PRs with no unresolved threads, or the CE snapshot handoff.",
  "- Use railyard:orchestrate for explicitly requested fleet or remote work that needs separate agents.",
];

process.stdout.write(config.off
  ? "Railyard is off in this repository (railyard.off): its hooks stand down here.\n"
  : lines.join("\n") + "\n");
if (config.off) process.exit(0);

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
