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
  "- Carry implementation and fixes through confirmed merge when the user or standing owner instructions authorize landing. Follow the repository’s merge policy and honor holds.",
  "  For ship or deliver requests, continue through required release or deployment and verification at the consumer.",
  "  Honor plan-only, local-only, and PR-only stops.",
  "- Use railyard:orchestrate for explicitly requested fleet or remote work that needs separate agents.",
];

process.stdout.write(config.off
  ? "Railyard is off in this repository (railyard.off): the startup guide is disabled here.\n"
  : lines.join("\n") + "\n");
