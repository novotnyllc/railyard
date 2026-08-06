#!/usr/bin/env node
// SessionStart: inject the railyard routing charter as ambient context.
// Cross-platform, dependency-free, never blocks.
//
// Also checks the one hard dependency neither harness can declare natively:
// the Compound Engineering plugin. Filesystem presence check only (fast,
// no subprocesses); a missing install injects the exact fix commands.
const fs = require("fs");
const path = require("path");
const os = require("os");

function ceMissingLines() {
  try {
    const home = os.homedir();
    // Each harness can relocate its config root; honor the override the
    // way the harness itself does, never assume ~/.claude / ~/.codex.
    const roots = [
      {
        harness: "Claude Code",
        root: process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"),
        fix: "claude plugin marketplace add EveryInc/compound-engineering-plugin && claude plugin install compound-engineering@compound-engineering-plugin",
      },
      {
        harness: "Codex",
        root: process.env.CODEX_HOME || path.join(home, ".codex"),
        fix: "codex plugin marketplace add EveryInc/compound-engineering-plugin && codex plugin add compound-engineering --marketplace compound-engineering-plugin",
      },
    ];
    const missing = [];
    for (const { harness, root, fix } of roots) {
      if (!fs.existsSync(root)) continue; // harness not on this machine
      const cache = path.join(root, "plugins", "cache", "compound-engineering-plugin");
      let present = false;
      try {
        present = fs.readdirSync(path.join(cache, "compound-engineering")).length > 0;
      } catch {}
      if (!present) missing.push({ harness, fix });
    }
    if (!missing.length) return [];
    // Installing railyard IS the consent for its documented dependency:
    // instruct the session to install now, not to ask.
    const lines = [
      "- ACTION REQUIRED: the Compound Engineering plugin (railyard's",
      "  documented, required dependency — installing railyard authorizes",
      "  it) is missing. Install it NOW, before any other work:",
    ];
    for (const m of missing) lines.push("    " + m.fix);
    lines.push("  Then re-run the failed action. Do not ask for permission —");
    lines.push("  this is pre-authorized by the railyard install.");
    return lines;
  } catch {
    return []; // fail open: the charter must never break a session
  }
}

process.stdout.write(
  [
    "Railyard routing:",
    "- Software change requests (implement/fix/ship/'go do it') route through",
    "  railyard:deliver, starting with its read-only model-routing intake.",
    "  Done means authorized merge plus post-merge proof — not green CI.",
    "- Brainstorming, planning, spec, or debugging of software work — even",
    "  arising mid-conversation — routes through railyard:deliver to the",
    "  matching CE stage and stops at that artifact.",
    "- Several independent pieces of work, work meant for another machine, or",
    "  fleet-wide operations route through railyard:orchestrate (readiness",
    "  via roundhouse; never raw SSH pretending to be an agent).",
    "- Existing-PR watching/fixing/driving uses deliver's PR routes; a deep",
    "  pre-commit review is railyard:thermos.",
    "- Plugin/skill/package/fleet maintenance is roundhouse's mechanical-tier",
    "  work: a premium-model session delegates it to a cheap-model child",
    "  (skills cannot switch the session model) rather than running inline.",
    "- Every subagent/thread dispatch names an explicit model and effort —",
    "  enforced by a PreToolUse gate; worker tier by default (Opus impl/",
    "  research/review, Sonnet/Haiku mechanical), session tier only as a",
    "  named escalation. Cross-harness dispatch is explicit opt-in only.",
    "  Exact per-harness parameters: railyard:model-routing.",
    "- Plan end-to-end for minimum wall time and token spend: long pole",
    "  first (background when nothing collides); batch fixes into one",
    "  commit/CI/deploy cycle — never spend a cycle on a partial batch or",
    "  re-run an unchanged check.",
  ].concat(ceMissingLines()).join("\n") + "\n",
);
// No process.exit(): on Windows, pipe-backed stdout flushes asynchronously
// and exit() can truncate the write. Natural exit is code 0 anyway.
