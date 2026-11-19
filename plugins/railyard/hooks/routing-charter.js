#!/usr/bin/env node
// SessionStart prints the publishing guide for the current repository.
const { repoConfig } = require("./repo-config.js");

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
  "- Load and invoke railyard:deliver for implementation, fix, and PR creation intent, even when the user does not name the skill. Trivial edits can run natively within Deliver and follow the same delivery gates.",
  "  For authorized repository work, a plain implementation or open-PR request includes review, CI, and confirmed merge via the repository’s normal process. Complete required release or deployment and verify the consumer. Honor approvals, holds, and explicit stops such as plan-only, local-only, PR-only, or no merge.",
  "- Use railyard:orchestrate for explicitly requested fleet or remote work that needs separate agents.",
];

process.stdout.write(config.off
  ? "Railyard is off in this repository (railyard.off): the startup guide is disabled here.\n"
  : lines.join("\n") + "\n");
