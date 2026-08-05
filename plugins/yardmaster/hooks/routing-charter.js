#!/usr/bin/env node
// SessionStart: inject the yardmaster routing charter as ambient context.
// Once per session, ~7 lines. Cross-platform, dependency-free, never blocks.
process.stdout.write(
  [
    "Yardmaster routing:",
    "- Software change requests (implement/fix/ship/'go do it') route through",
    "  yardmaster:deliver, starting with its read-only model-routing intake.",
    "  Done means authorized merge plus post-merge proof — not green CI.",
    "- Brainstorming, planning, spec, or debugging of software work — even",
    "  arising mid-conversation — routes through yardmaster:deliver to the",
    "  matching CE stage and stops at that artifact.",
    "- Several independent pieces of work, work meant for another machine, or",
    "  fleet-wide operations route through yardmaster:orchestrate (readiness",
    "  via roundhouse; never raw SSH pretending to be an agent).",
    "- Existing-PR watching/fixing/driving uses deliver's PR routes; a deep",
    "  pre-commit review is yardmaster:thermos.",
  ].join("\n") + "\n",
);
process.exit(0);
